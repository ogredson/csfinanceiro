import { db } from '../supabaseClient.js';
import { showToast, formatCurrency, parseCurrency, formatDate, formatDateBR, setLoading, debounce, exportToCSV, sanitizeText } from '../utils.js';
import { createModal } from '../components/Modal.js';
import { renderTable } from '../components/Table.js';

async function fetchMovimentacoes(filters = {}) {
  const opts = { select: 'id, tipo, categoria_id, forma_pagamento_id, descricao, valor, data_transacao, beneficiario_manual, responsavel, observacoes, comprovante_url, created_at' };
  opts.eq = {};
  if (filters.tipo) opts.eq.tipo = filters.tipo;
  const dateCol = 'data_transacao';
  if (filters.de) opts.gte = { ...(opts.gte||{}), [dateCol]: filters.de };
  if (filters.ate) opts.lte = { ...(opts.lte||{}), [dateCol]: filters.ate };
  opts.orderBy = { column: 'data_transacao', ascending: false };
  const { data, error } = await db.select('movimentacoes_diarias', opts);
  if (error) { showToast(error.message || 'Erro ao carregar movimentações diárias', 'error'); return []; }
  return data || [];
}

// Lookups
let LOOKUPS = null;
async function ensureLookups() {
  if (LOOKUPS) return LOOKUPS;
  const [catRes, formaRes] = await Promise.all([
    db.select('categorias', { select: 'id, nome, tipo', orderBy: { column: 'nome', ascending: true } }),
    db.select('formas_pagamento', { select: 'id, nome', orderBy: { column: 'nome', ascending: true } }),
  ]);
  const categorias = catRes.data || [];
  const formas = formaRes.data || [];
  const mapCat = new Map(categorias.map(c => [c.id, c.nome]));
  const mapCatTipo = new Map(categorias.map(c => [c.id, (c.tipo || '')]));
  const mapForma = new Map(formas.map(f => [f.id, f.nome]));
  LOOKUPS = { categorias, formas, mapCat, mapCatTipo, mapForma };
  return LOOKUPS;
}

function movForm(initial = {}, lookups = { categorias: [], formas: [] }) {
  return `
    <form id="movForm">
      <div class="form-row">
        <div class="field sm"><label>Tipo</label>
          <select id="tipo">
            <option value="entrada" ${initial.tipo==='entrada'?'selected':''}>Entrada</option>
            <option value="saida" ${initial.tipo==='saida'?'selected':''}>Saída</option>
          </select>
        </div>
        <div class="field"><label>Categoria</label>
          <input id="categoria_nome" list="catOptions" value="${initial.categoria_nome||''}" placeholder="Selecione a categoria" />
          <datalist id="catOptions">${(lookups.categorias||[]).map(c => `<option value="${c.nome}"></option>`).join('')}</datalist>
        </div>
        <div class="field"><label>Forma de Pagamento</label>
          <input id="forma_nome" list="formaOptions" value="${initial.forma_pagamento_nome||''}" placeholder="Selecione a forma" />
          <datalist id="formaOptions">${(lookups.formas||[]).map(f => `<option value="${f.nome}"></option>`).join('')}</datalist>
        </div>
      </div>
      <div class="form-row" style="margin-top:12px">
        <div class="field"><label>Beneficiário</label><input id="beneficiario" value="${initial.beneficiario_manual||''}" /></div>
        <div class="field"><label>Responsável</label><input id="responsavel" value="${initial.responsavel||''}" /></div>
        <div class="field sm"><label>Data</label><input type="date" id="data_transacao" value="${initial.data_transacao||formatDate()}" /></div>
      </div>
      <div class="form-row" style="margin-top:12px">
        <div class="field sm"><label>Valor</label><input id="valor" value="${initial.valor||''}" /></div>
        <div class="field"><label>Comprovante URL</label><input id="comprovante_url" value="${initial.comprovante_url||''}" placeholder="https://..." /></div>
      </div>
      <div class="form-row" style="margin-top:12px">
        <div class="field full"><label>Descrição</label><input id="descricao" value="${initial.descricao||''}" /></div>
      </div>
      <div class="form-row" style="margin-top:12px">
        <div class="field full"><label>Observações</label><textarea id="observacoes" rows="3">${initial.observacoes||''}</textarea></div>
      </div>
    </form>`;
}

function getMovFormValues(modal, lookups) {
  const getVal = id => modal.querySelector(`#${id}`)?.value || '';
  const findIdByName = (arr, name) => (arr || []).find(x => (x.nome || '') === (name || ''))?.id || null;
  const categoria_nome = getVal('categoria_nome');
  const forma_nome = getVal('forma_nome');
  return {
    tipo: getVal('tipo') || 'entrada',
    categoria_id: findIdByName(lookups.categorias, categoria_nome),
    forma_pagamento_id: findIdByName(lookups.formas, forma_nome),
    descricao: getVal('descricao') || '',
    valor: parseCurrency(getVal('valor')),
    data_transacao: getVal('data_transacao') || formatDate(),
    beneficiario_manual: getVal('beneficiario') || '',
    responsavel: getVal('responsavel') || '',
    observacoes: getVal('observacoes') || null,
    comprovante_url: getVal('comprovante_url') || null,
  };
}

async function openCreate() {
  const lookups = await ensureLookups();
  const { modal, close } = createModal({ title: 'Nova Movimentação', content: movForm({}, lookups), actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: ({ close }) => close() },
    { label: 'Salvar', className: 'btn btn-primary', onClick: async ({ modal, close }) => {
      const v = getMovFormValues(modal, lookups);
      const catNome = modal.querySelector('#categoria_nome')?.value?.trim();
      const formaNome = modal.querySelector('#forma_nome')?.value?.trim();
      if (catNome && !v.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (formaNome && !v.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      const { error } = await db.insert('movimentacoes_diarias', v);
      if (error) { showToast(error.message||'Erro ao salvar', 'error'); return; }
      showToast('Movimentação criada', 'success'); close(); window.location.hash = '#/movimentacoes';
    } },
  ]});
}

async function openEdit(row) {
  const lookups = await ensureLookups();
  const initial = {
    ...row,
    categoria_nome: LOOKUPS?.mapCat?.get(row.categoria_id) || '',
    forma_pagamento_nome: LOOKUPS?.mapForma?.get(row.forma_pagamento_id) || '',
  };
  const { modal, close } = createModal({ title: 'Editar Movimentação', content: movForm(initial, lookups), actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: ({ close }) => close() },
    { label: 'Atualizar', className: 'btn btn-primary', onClick: async ({ modal, close }) => {
      const v = getMovFormValues(modal, lookups);
      const catNome = modal.querySelector('#categoria_nome')?.value?.trim();
      const formaNome = modal.querySelector('#forma_nome')?.value?.trim();
      if (catNome && !v.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (formaNome && !v.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      const { error } = await db.update('movimentacoes_diarias', row.id, v);
      if (error) { showToast(error.message||'Erro ao atualizar', 'error'); return; }
      showToast('Movimentação atualizada', 'success'); close(); window.location.hash = '#/movimentacoes';
    } },
  ]});
}

function ilike(hay, needle) { if (!needle) return true; return (hay || '').toString().toLowerCase().includes((needle||'').toLowerCase()); }

export async function renderMovimentacoes(app) {
  const lookups = await ensureLookups();
  app.innerHTML = `
    <div class="toolbar" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <details class="filters-panel" id="filtersPanel" style="flex:1;" open>
        <summary class="btn btn-outline" style="cursor:pointer;">Mostrar filtros</summary>
        <div class="filters" style="display:grid;grid-template-columns:repeat(3, minmax(220px, 1fr));gap:10px;padding:10px 0;">
          <fieldset style="border:1px solid #e5e7eb;border-radius:6px;padding:8px;">
            <legend style="font-size:12px;color:#374151;">Tipo</legend>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <select id="fTipo"><option value="">Todos</option><option value="entrada">Entrada</option><option value="saida">Saída</option></select>
            </div>
          </fieldset>

          <fieldset style="border:1px solid #e5e7eb;border-radius:6px;padding:8px;">
            <legend style="font-size:12px;color:#374151;">Período</legend>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <input type="date" id="fDe" />
              <input type="date" id="fAte" />
            </div>
          </fieldset>

          <fieldset style="border:1px solid #e5e7eb;border-radius:6px;padding:8px;">
            <legend style="font-size:12px;color:#374151;">Pesquisa</legend>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <input id="fBenef" placeholder="Beneficiário (texto)" />
              <input id="fResp" placeholder="Responsável (texto)" />
              <input id="fDesc" placeholder="Descrição (texto)" />
              <input id="fCategoriaNome" list="fCatOptions" placeholder="Categoria (nome)" />
              <datalist id="fCatOptions">${(lookups.categorias||[]).map(c => `<option value="${c.nome}"></option>`).join('')}</datalist>
              <input id="fFormaNome" list="fFormaOptions" placeholder="Forma (nome)" />
              <datalist id="fFormaOptions">${(lookups.formas||[]).map(f => `<option value="${f.nome}"></option>`).join('')}</datalist>
            </div>
          </fieldset>

          <fieldset style="border:1px solid #e5e7eb;border-radius:6px;padding:8px;">
            <legend style="font-size:12px;color:#374151;">Ordenação</legend>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <select id="sortField">
                <option value="data_transacao" selected>Ordenar por Data</option>
                <option value="valor">Ordenar por Valor</option>
                <option value="categoria_nome">Ordenar por Categoria</option>
                <option value="forma_pagamento_nome">Ordenar por Forma</option>
                <option value="beneficiario_manual">Ordenar por Beneficiário</option>
                <option value="responsavel">Ordenar por Responsável</option>
              </select>
              <select id="sortDir">
                <option value="desc" selected>Descendente</option>
                <option value="asc">Ascendente</option>
              </select>
            </div>
          </fieldset>

          <div style="grid-column:1/-1;display:flex;gap:8px;">
            <button id="applyFilters" class="btn btn-primary btn-prominent">🔎 Filtrar</button>
            <button id="clearFilters" class="btn btn-outline">Limpar filtros</button>
          </div>
        </div>
      </details>
      <div style="display:flex;align-items:center;gap:8px;">
        <div id="totalsMov" class="totals-box totals-mov">
          <div class="t-label">Entradas / Saídas</div>
          <div class="t-values">R$ 0,00 / R$ 0,00</div>
        </div>
        <button id="newMov" class="btn btn-primary">Novo</button>
        <button id="expMov" class="btn btn-outline">Exportar CSV</button>
      </div>
    </div>
    <div class="card" id="listCard"></div>
  `;

  const filters = {};
  // período padrão: mês atual
  try {
    const now = new Date();
    const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const lastDayDate = new Date(now.getFullYear(), now.getMonth()+1, 0);
    const lastDay = `${lastDayDate.getFullYear()}-${String(lastDayDate.getMonth()+1).padStart(2,'0')}-${String(lastDayDate.getDate()).padStart(2,'0')}`;
    document.getElementById('fDe').value = firstDay;
    document.getElementById('fAte').value = lastDay;
    filters.de = firstDay; filters.ate = lastDay;
  } catch {}

  const perPage = 20;
  let page = 1;
  let totalPages = 1;
  let qBenef = '', qResp = '', qDesc = '', qCat = '', qForma = '';
  let sortField = 'data_transacao';
  let sortDir = 'desc';
  let lastRows = [];

  async function load() {
    const cont = document.getElementById('listCard');
    setLoading(cont, true);
    let rows = await fetchMovimentacoes(filters);
    const enriched = rows.map(r => ({
      ...r,
      categoria_nome: LOOKUPS?.mapCat?.get(r.categoria_id) || '—',
      forma_pagamento_nome: LOOKUPS?.mapForma?.get(r.forma_pagamento_id) || '—',
    }));
    const filtered = enriched.filter(r =>
      ilike(r.beneficiario_manual, qBenef) &&
      ilike(r.responsavel, qResp) &&
      ilike(r.descricao, qDesc) &&
      ilike(r.categoria_nome, qCat) &&
      ilike(r.forma_pagamento_nome, qForma)
    );

    function getSortVal(obj, key) {
      const v = obj[key];
      if (v === undefined || v === null) return null;
      if (key === 'valor' || typeof v === 'number') return Number(v);
      return String(v);
    }
    const sorted = [...filtered].sort((a,b) => {
      const va = getSortVal(a, sortField);
      const vb = getSortVal(b, sortField);
      if (va === null && vb === null) return 0;
      if (va === null) return sortDir === 'asc' ? 1 : -1;
      if (vb === null) return sortDir === 'asc' ? -1 : 1;
      if (typeof va === 'string' && typeof vb === 'string') {
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const cmp = va > vb ? 1 : va < vb ? -1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    // totais
    const totalEntrada = sorted.reduce((acc, r) => acc + (r.tipo === 'entrada' ? Number(r.valor || 0) : 0), 0);
    const totalSaida = sorted.reduce((acc, r) => acc + (r.tipo === 'saida' ? Number(r.valor || 0) : 0), 0);
    const totalsEl = document.getElementById('totalsMov');
    if (totalsEl) {
      const valuesEl = totalsEl.querySelector('.t-values');
      if (valuesEl) valuesEl.textContent = `${formatCurrency(totalEntrada)} / ${formatCurrency(totalSaida)}`;
    }

    // paginação
    totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
    if (page > totalPages) page = totalPages;

    lastRows = sorted;
    cont.innerHTML = '';
    setLoading(cont, false);
    renderTable(cont, {
      columns: [
        { key: 'descricao', label: 'Descrição', render: (v, r) => {
          const desc = (v ?? '').toString();
          const hint = (r.observacoes ?? '').toString();
          if (hint) return `<span class="hint-hover" data-hint="${sanitizeText(hint)}">${sanitizeText(desc)} <span class="hint-icon" aria-hidden="true" title="Observação">ℹ️</span></span>`;
          return sanitizeText(desc);
        } },
        { key: 'tipo', label: 'Tipo', render: v => (v==='entrada'
          ? `<span class="status-pill" style="background:#DBEAFE;color:#1E40AF">Entrada</span>`
          : `<span class="status-pill" style="background:#FEE2E2;color:#991B1B">Saída</span>`) },
        { key: 'categoria_nome', label: 'Categoria' },
        { key: 'forma_pagamento_nome', label: 'Forma' },
        { key: 'beneficiario_manual', label: 'Beneficiário' },
        { key: 'responsavel', label: 'Responsável' },
        { key: 'valor', label: 'Valor', render: (v, r) => `<strong style="color:${r.tipo==='entrada'?'#1E40AF':'#991B1B'}">${formatCurrency(v)}</strong>` },
        { key: 'data_transacao', label: 'Data', render: v => formatDateBR(v) },
      ],
      rows: sorted,
      page,
      perPage,
      actions: [
        { label: '✏️ Editar', className: 'btn btn-primary btn-prominent', onClick: r => openEdit(r) },
        { label: '🧾 Comprovante', className: 'btn btn-outline', onClick: r => { const url = (r.comprovante_url||'').toString(); if (!url) { showToast('Sem URL de comprovante', 'warning'); return; } window.open(url, '_blank'); } },
        { label: 'Excluir', className: 'btn btn-danger', onClick: async r => {
          const desc = sanitizeText(r.descricao||'');
          const { modal, close } = createModal({ title: 'Confirmar exclusão', content: `<div class="card"><p>Deseja realmente excluir a movimentação <strong>${desc}</strong>? Esta ação não pode ser desfeita.</p></div>`, actions: [
            { label: 'Cancelar', className: 'btn btn-outline', onClick: ({ close }) => close() },
            { label: 'Excluir', className: 'btn btn-danger', onClick: async ({ close }) => { const { error } = await db.remove('movimentacoes_diarias', r.id); if (error) showToast(error.message||'Erro ao excluir', 'error'); else { showToast('Movimentação excluída', 'success'); close(); load(); } } },
          ]});
        } },
      ],
    });

    // controles de paginação
    const pager = document.createElement('div');
    pager.style.display = 'flex';
    pager.style.justifyContent = 'space-between';
    pager.style.marginTop = '8px';
    pager.innerHTML = `
      <div></div>
      <div>
        <button id="prevMov" class="btn btn-outline">Anterior</button>
        <span style="margin:0 8px;">Página ${page} de ${totalPages}</span>
        <button id="nextMov" class="btn btn-outline">Próxima</button>
      </div>
    `;
    cont.appendChild(pager);
    const prev = pager.querySelector('#prevMov');
    const next = pager.querySelector('#nextMov');
    prev.disabled = page <= 1;
    next.disabled = page >= totalPages;
    prev.addEventListener('click', () => { if (page > 1) { page--; load(); } });
    next.addEventListener('click', () => { if (page < totalPages) { page++; load(); } });
  }

  const debouncedLoad = debounce(() => load(), 250);
  document.getElementById('applyFilters').addEventListener('click', () => {
    filters.tipo = document.getElementById('fTipo').value || undefined;
    filters.de = document.getElementById('fDe').value || undefined;
    filters.ate = document.getElementById('fAte').value || undefined;
    page = 1;
    load();
  });
  document.getElementById('clearFilters').addEventListener('click', () => {
    const now = new Date();
    const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const lastDayDate = new Date(now.getFullYear(), now.getMonth()+1, 0);
    const lastDay = `${lastDayDate.getFullYear()}-${String(lastDayDate.getMonth()+1).padStart(2,'0')}-${String(lastDayDate.getDate()).padStart(2,'0')}`;
    document.getElementById('fTipo').value = '';
    document.getElementById('fDe').value = firstDay;
    document.getElementById('fAte').value = lastDay;
    document.getElementById('fBenef').value = '';
    document.getElementById('fResp').value = '';
    document.getElementById('fDesc').value = '';
    document.getElementById('fCategoriaNome').value = '';
    document.getElementById('fFormaNome').value = '';
    document.getElementById('sortField').value = 'data_transacao';
    document.getElementById('sortDir').value = 'desc';
    filters.tipo = undefined; filters.de = firstDay; filters.ate = lastDay;
    qBenef = qResp = qDesc = qCat = qForma = '';
    sortField = 'data_transacao'; sortDir = 'desc';
    page = 1;
    load();
  });
  document.getElementById('fBenef').addEventListener('input', (e) => { qBenef = e.target.value.trim(); debouncedLoad(); });
  document.getElementById('fResp').addEventListener('input', (e) => { qResp = e.target.value.trim(); debouncedLoad(); });
  document.getElementById('fDesc').addEventListener('input', (e) => { qDesc = e.target.value.trim(); debouncedLoad(); });
  document.getElementById('fCategoriaNome').addEventListener('input', (e) => { qCat = e.target.value.trim(); debouncedLoad(); });
  document.getElementById('fFormaNome').addEventListener('input', (e) => { qForma = e.target.value.trim(); debouncedLoad(); });
  document.getElementById('sortField').addEventListener('change', (e) => { sortField = e.target.value; load(); });
  document.getElementById('sortDir').addEventListener('change', (e) => { sortDir = e.target.value; load(); });
  document.getElementById('newMov').addEventListener('click', openCreate);
  document.getElementById('expMov').addEventListener('click', () => {
    if (!lastRows || !lastRows.length) { showToast('Nada para exportar', 'warning'); return; }
    exportToCSV(lastRows, 'movimentacoes_diarias');
  });

  await load();
}
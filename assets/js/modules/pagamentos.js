import { db } from '../supabaseClient.js';
import { showToast, formatCurrency, parseCurrency, formatDate, sum, setLoading, debounce } from '../utils.js';
import { createModal } from '../components/Modal.js';
import { renderTable } from '../components/Table.js';

async function fetchPagamentos(filters = {}) {
  const opts = { select: 'id, fornecedor_id, categoria_id, forma_pagamento_id, descricao, beneficiario, valor_esperado, valor_pago, data_emissao, data_vencimento, data_pagamento, status, tipo_pagamento, parcela_atual, total_parcelas, observacoes' };
  opts.eq = {};
  if (filters.status) opts.eq.status = filters.status;
  if (filters.categoria_id) opts.eq.categoria_id = filters.categoria_id;
  if (filters.tipo_pagamento) opts.eq.tipo_pagamento = filters.tipo_pagamento;
  if (filters.de) opts.gte = { ...(opts.gte||{}), data_vencimento: filters.de };
  if (filters.ate) opts.lte = { ...(opts.lte||{}), data_vencimento: filters.ate };
  opts.orderBy = { column: 'data_vencimento', ascending: true };
  const { data, error } = await db.select('pagamentos', opts);
  if (error) { showToast(error.message || 'Erro ao carregar pagamentos', 'error'); return []; }
  return data || [];
}

// Lookups para combobox
let LOOKUPS = null;
async function ensureLookups() {
  if (LOOKUPS) return LOOKUPS;
  const [forRes, catRes, formaRes] = await Promise.all([
    db.select('fornecedores', { select: 'id, nome', orderBy: { column: 'nome', ascending: true } }),
    db.select('categorias', { select: 'id, nome', orderBy: { column: 'nome', ascending: true } }),
    db.select('formas_pagamento', { select: 'id, nome', orderBy: { column: 'nome', ascending: true } }),
  ]);
  const fornecedores = forRes.data || [];
  const categorias = catRes.data || [];
  const formas = formaRes.data || [];
  const mapFor = new Map(fornecedores.map(f => [f.id, f.nome]));
  const mapCat = new Map(categorias.map(c => [c.id, c.nome]));
  const mapForma = new Map(formas.map(f => [f.id, f.nome]));
  LOOKUPS = { fornecedores, categorias, formas, mapFor, mapCat, mapForma };
  return LOOKUPS;
}

function pagamentoForm(initial = {}, lookups = { fornecedores: [], categorias: [], formas: [] }) {
  return `
    <form id="pagForm">
      <div class="form-row">
        <div class="field"><label>Descrição</label><input id="descricao" value="${initial.descricao||''}" required/></div>
        <div class="field"><label>Fornecedor</label>
          <input id="fornecedor_nome" list="forOptions" value="${initial.fornecedor_nome||''}" placeholder="Selecione o fornecedor"/>
          <datalist id="forOptions">${(lookups.fornecedores||[]).map(f => `<option value="${f.nome}"></option>`).join('')}</datalist>
        </div>
        <div class="field"><label>Categoria</label>
          <input id="categoria_nome" list="catOptions" value="${initial.categoria_nome||''}" placeholder="Selecione a categoria"/>
          <datalist id="catOptions">${(lookups.categorias||[]).map(c => `<option value="${c.nome}"></option>`).join('')}</datalist>
        </div>
        <div class="field"><label>Forma de Pagamento</label>
          <input id="forma_nome" list="formaOptions" value="${initial.forma_pagamento_nome||''}" placeholder="Selecione a forma"/>
          <datalist id="formaOptions">${(lookups.formas||[]).map(f => `<option value="${f.nome}"></option>`).join('')}</datalist>
        </div>
        <div class="field"><label>Beneficiário</label><input id="beneficiario" value="${initial.beneficiario||''}" /></div>
        <div class="field"><label>Valor Esperado</label><input id="valor_esperado" value="${initial.valor_esperado||''}" /></div>
        <div class="field highlight"><label>Valor Pago</label><input id="valor_pago" value="${initial.valor_pago||''}" /></div>
        <div class="field"><label>Data Emissão</label><input type="date" id="data_emissao" value="${initial.data_emissao||formatDate()}" /></div>
        <div class="field"><label>Data Vencimento</label><input type="date" id="data_vencimento" value="${initial.data_vencimento||formatDate()}" required/></div>
        <div class="field highlight"><label>Data Pagamento</label><input type="date" id="data_pagamento" value="${initial.data_pagamento||''}" /></div>
        <div class="field"><label>Status</label>
          <select id="status">
            <option value="pendente" ${initial.status==='pendente'?'selected':''}>Pendente</option>
            <option value="pago" ${initial.status==='pago'?'selected':''}>Pago</option>
            
            <option value="cancelado" ${initial.status==='cancelado'?'selected':''}>Cancelado</option>
          </select>
        </div>
        <div class="field"><label>Tipo</label>
          <select id="tipo_pagamento">
            <option value="variavel" ${initial.tipo_pagamento==='variavel'?'selected':''}>Variável</option>
            <option value="fixo" ${initial.tipo_pagamento==='fixo'?'selected':''}>Fixo</option>
            <option value="comissao" ${initial.tipo_pagamento==='comissao'?'selected':''}>Comissão</option>
          </select>
        </div>
        <div class="field"><label>Parcela Atual</label><input type="number" id="parcela_atual" value="${initial.parcela_atual||1}" /></div>
        <div class="field"><label>Total Parcelas</label><input type="number" id="total_parcelas" value="${initial.total_parcelas||1}" /></div>
        <div class="field full"><label>Observações</label><textarea id="observacoes">${initial.observacoes||''}</textarea></div>
      </div>
      <p class="muted">Para comissões, você pode definir o valor esperado com base em uma porcentagem manual.</p>
    </form>`;
}

function getPagFormValues(modal, lookups) {
  const getVal = id => modal.querySelector(`#${id}`).value;
  const findIdByName = (arr, name) => (arr || []).find(x => (x.nome || '').toString() === (name || '').toString())?.id || null;
  const fornecedor_nome = getVal('fornecedor_nome');
  const categoria_nome = getVal('categoria_nome');
  const forma_nome = getVal('forma_nome');
  return {
    descricao: getVal('descricao'),
    fornecedor_id: findIdByName(lookups.fornecedores, fornecedor_nome),
    categoria_id: findIdByName(lookups.categorias, categoria_nome),
    forma_pagamento_id: findIdByName(lookups.formas, forma_nome),
    beneficiario: getVal('beneficiario') || null,
    valor_esperado: parseCurrency(getVal('valor_esperado')),
    valor_pago: parseCurrency(getVal('valor_pago')),
    data_emissao: getVal('data_emissao') || formatDate(),
    data_vencimento: getVal('data_vencimento'),
    data_pagamento: getVal('data_pagamento') || null,
    status: getVal('status'),
    tipo_pagamento: getVal('tipo_pagamento'),
    parcela_atual: Number(getVal('parcela_atual')||1),
    total_parcelas: Number(getVal('total_parcelas')||1),
    observacoes: getVal('observacoes') || null,
  };
}

async function openCreate() {
  const lookups = await ensureLookups();
  const { modal, close } = createModal({ title: 'Novo Pagamento', content: pagamentoForm({}, lookups), actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Salvar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const values = getPagFormValues(modal, lookups);
      const nomeFor = modal.querySelector('#fornecedor_nome')?.value?.trim();
      const nomeCat = modal.querySelector('#categoria_nome')?.value?.trim();
      const nomeForma = modal.querySelector('#forma_nome')?.value?.trim();
      if (nomeFor && !values.fornecedor_id) { showToast('Selecione um fornecedor válido da lista', 'error'); return; }
      if (nomeCat && !values.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (nomeForma && !values.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      const { error } = await db.insert('pagamentos', values);
      if (error) showToast(error.message||'Erro ao salvar', 'error'); else { showToast('Pagamento criado', 'success'); close(); }
      window.location.hash = '#/pagamentos';
    }}
  ] });
}

async function openEdit(row) {
  const lookups = await ensureLookups();
  const initial = {
    ...row,
    fornecedor_nome: lookups.mapFor.get(row.fornecedor_id) || '',
    categoria_nome: lookups.mapCat.get(row.categoria_id) || '',
    forma_pagamento_nome: lookups.mapForma.get(row.forma_pagamento_id) || '',
  };
  const { modal, close } = createModal({ title: 'Editar Pagamento', content: pagamentoForm(initial, lookups), actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Atualizar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const values = getPagFormValues(modal, lookups);
      const nomeFor = modal.querySelector('#fornecedor_nome')?.value?.trim();
      const nomeCat = modal.querySelector('#categoria_nome')?.value?.trim();
      const nomeForma = modal.querySelector('#forma_nome')?.value?.trim();
      if (nomeFor && !values.fornecedor_id) { showToast('Selecione um fornecedor válido da lista', 'error'); return; }
      if (nomeCat && !values.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (nomeForma && !values.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      const { error } = await db.update('pagamentos', row.id, values);
      if (error) {
        showToast(error.message||'Erro ao atualizar', 'error');
      } else {
        showToast('Pagamento atualizado', 'success');
        close();
        window.location.hash = '#/pagamentos';
      }
    }}
  ] });
}

async function markPago(row) {
  const valor = row.valor_esperado;
  const { error } = await db.update('pagamentos', row.id, { status: 'pago', valor_pago: valor, data_pagamento: formatDate() });
  if (error) showToast(error.message || 'Erro ao marcar pago', 'error'); else showToast('Marcado como pago', 'success');
  window.location.hash = '#/pagamentos';
}

async function relatorioDespesas(rows) {
  const total = sum(rows.map(r => r.valor_pago || 0));
  showToast(`Despesas pagas (visíveis): ${formatCurrency(total)}`, 'info');
}

export async function renderPagamentos(app) {
  app.innerHTML = `
    <div class="toolbar">
      <div class="filters">
        <select id="fStatus"><option value="">Todos</option><option value="pendente">Pendente</option><option value="pago">Pago</option><option value="cancelado">Cancelado</option></select>
        <select id="fTipo"><option value="">Todos</option><option value="fixo">Fixo</option><option value="variavel">Variável</option><option value="parcelado">Parcelado</option></select>
        <input type="date" id="fDe" />
        <input type="date" id="fAte" />
        <input id="fForNome" placeholder="Fornecedor (nome)" />
        <input id="fCategoriaNome" placeholder="Categoria (nome)" />
        <input id="fFormaNome" placeholder="Forma de pagamento (nome)" />
        <label style="display:inline-flex;align-items:center;gap:6px;margin-left:8px;">
          <input type="checkbox" id="fOnlyOverdue" /> Somente em atraso
        </label>
        <button id="applyFilters" class="btn btn-outline">Filtrar</button>
        <select id="sortField" style="margin-left:8px;">
          <option value="data_vencimento" selected>Ordenar por Data Venc.</option>
          <option value="data_pagamento">Ordenar por Data Pag.</option>
          <option value="descricao">Ordenar por Descrição</option>
          <option value="valor_esperado">Ordenar por Valor Esperado</option>
          <option value="valor_pago">Ordenar por Valor Pago</option>
          <option value="fornecedor_nome">Ordenar por Fornecedor</option>
          <option value="categoria_nome">Ordenar por Categoria</option>
          <option value="forma_pagamento_nome">Ordenar por Forma</option>
        </select>
        <select id="sortDir" style="margin-left:8px;">
          <option value="asc" selected>Ascendente</option>
          <option value="desc">Descendente</option>
        </select>
      </div>
      <div>
        <button id="newPay" class="btn btn-primary">Novo</button>
      </div>
    </div>
    <div class="card" id="listCard"></div>
  `;

  const filters = {};
  let currentRows = [];
  let qFor = '';
  let qCat = '';
  let qForma = '';
  const perPage = 20;
  let page = 1;
  let sortField = 'data_vencimento';
  let sortDir = 'asc';
  let loadVersion = 0;

  function ilike(hay, needle) { if (!needle) return true; return (hay || '').toString().toLowerCase().includes((needle||'').toLowerCase()); }

  async function buildMaps(rows) {
    const idsFor = Array.from(new Set(rows.map(r => r.fornecedor_id).filter(Boolean)));
    const idsCat = Array.from(new Set(rows.map(r => r.categoria_id).filter(Boolean)));
    const idsForma = Array.from(new Set(rows.map(r => r.forma_pagamento_id).filter(Boolean)));
    const [forRes, catRes, formaRes] = await Promise.all([
      idsFor.length ? db.select('fornecedores', { select: 'id, nome', in: { id: idsFor } }) : Promise.resolve({ data: [] }),
      idsCat.length ? db.select('categorias', { select: 'id, nome', in: { id: idsCat } }) : Promise.resolve({ data: [] }),
      idsForma.length ? db.select('formas_pagamento', { select: 'id, nome', in: { id: idsForma } }) : Promise.resolve({ data: [] }),
    ]);
    const mapFor = new Map((forRes.data || []).map(f => [f.id, f.nome]));
    const mapCat = new Map((catRes.data || []).map(c => [c.id, c.nome]));
    const mapForma = new Map((formaRes.data || []).map(f => [f.id, f.nome]));
    return { mapFor, mapCat, mapForma };
  }

  async function load() {
    const cont = document.getElementById('listCard');
    const myVersion = ++loadVersion;
    setLoading(cont, true);
    const serverMode = !qFor && !qCat && !qForma;
    let rows = [];
    let totalPages = 1;

    if (serverMode) {
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;
      const opts = { select: 'id, fornecedor_id, categoria_id, forma_pagamento_id, descricao, valor_esperado, valor_pago, data_emissao, data_vencimento, data_pagamento, status, tipo_pagamento, parcela_atual, total_parcelas, observacoes' };
      opts.eq = {};
      if (filters.status) opts.eq.status = filters.status;
      if (filters.tipo_pagamento) opts.eq.tipo_pagamento = filters.tipo_pagamento;
      if (filters.fornecedor_id) opts.eq.fornecedor_id = filters.fornecedor_id;
      if (filters.de) opts.gte = { ...(opts.gte||{}), data_vencimento: filters.de };
      if (filters.ate) opts.lte = { ...(opts.lte||{}), data_vencimento: filters.ate };
      const serverSortable = new Set(['data_vencimento','data_pagamento','descricao','valor_esperado','valor_pago','status','tipo_pagamento','parcela_atual','total_parcelas','created_at']);
      const orderColumn = serverSortable.has(sortField) ? sortField : 'data_vencimento';
      const ascending = (sortDir !== 'desc');
      opts.orderBy = { column: orderColumn, ascending };
      opts.count = 'exact';
      opts.from = from; opts.to = to;
      const { data, error, count } = await db.select('pagamentos', opts);
      if (error) { showToast(error.message || 'Erro ao carregar pagamentos', 'error'); rows = []; }
      else { rows = data || []; }
      const totalCount = Number(count || (rows?.length || 0));
      totalPages = Math.max(1, Math.ceil(totalCount / perPage));
      if (page > totalPages) {
        page = totalPages;
        const from2 = (page - 1) * perPage;
        const to2 = from2 + perPage - 1;
        const { data: data2 } = await db.select('pagamentos', { ...opts, from: from2, to: to2 });
        rows = data2 || [];
      }
    } else {
      rows = await fetchPagamentos(filters);
    }

    if (myVersion !== loadVersion) return;

    currentRows = rows;
    const { mapFor, mapCat, mapForma } = await buildMaps(rows);

    if (myVersion !== loadVersion) return;

    const enriched = rows.map(r => ({
      ...r,
      fornecedor_nome: mapFor.get(r.fornecedor_id) || '—',
      categoria_nome: mapCat.get(r.categoria_id) || '—',
      forma_pagamento_nome: mapForma.get(r.forma_pagamento_id) || '—',
    }));

    // Helpers para atraso e rótulo de dias
    function diffDias(dateStr) {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const due = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const ms = due.getTime() - today.getTime();
      return Math.round(ms / 86400000);
    }
    function isOverdue(row) {
      if (row.status !== 'pendente') return false;
      const dd = diffDias(row.data_vencimento);
      return dd !== null && dd < 0;
    }
    function diasLabel(row) {
      if (!row.data_vencimento) return '—';
      if (row.status !== 'pendente') return '—';
      const dd = diffDias(row.data_vencimento);
      if (dd === null) return '—';
      if (dd < 0) return `${Math.abs(dd)} dias vencidos`;
      if (dd === 0) return `vence hoje`;
      return `${dd} dias a vencer`;
    }

    const nameFiltered = serverMode ? enriched : enriched.filter(r => ilike(r.fornecedor_nome, qFor) && ilike(r.categoria_nome, qCat) && ilike(r.forma_pagamento_nome, qForma));
    const filtered = (filters.onlyOverdue) ? nameFiltered.filter(r => isOverdue(r)) : nameFiltered;

    function getSortVal(obj, key) {
      const v = obj[key];
      if (v === undefined || v === null) return null;
      if (key.startsWith('valor') || typeof v === 'number') return Number(v);
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

    if (!serverMode) {
      totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
      if (page > totalPages) page = totalPages;
    }

    cont.innerHTML = '';
    setLoading(cont, false);

    renderTable(cont, {
      columns: [
        { key: 'descricao', label: 'Descrição' },
        { key: 'fornecedor_nome', label: 'Fornecedor' },
        { key: 'categoria_nome', label: 'Categoria' },
        { key: 'forma_pagamento_nome', label: 'Forma Pag.' },
        { key: 'valor_esperado', label: 'Esperado', render: v => `<strong>${formatCurrency(v)}</strong>` },
        { key: 'valor_pago', label: 'Pago', render: v => `${formatCurrency(v)}` },
        { key: 'data_pagamento', label: 'Pag.' },
        { key: 'data_vencimento', label: 'Venc.' },
        { key: 'dias_vencimento', label: 'Dias', render: (_v, r) => diasLabel(r) },
        { key: 'status', label: 'Status', render: v => `<span class="status-pill status-${v}">${v}</span>` },
        { key: 'tipo_pagamento', label: 'Tipo' },
      ],
      rows: sorted,
      page: serverMode ? 1 : page,
      perPage,
      actions: [
        { label: 'Editar', className: 'btn btn-outline', onClick: r => openEdit(r) },
        { label: 'Excluir', className: 'btn btn-danger', onClick: async r => { const ok = confirm(`Confirma a exclusão de "${r.descricao}"? Esta ação não pode ser desfeita.`); if (!ok) return; const { error } = await db.remove('pagamentos', r.id); if (error) showToast(error.message||'Erro ao excluir','error'); else { showToast('Excluído','success'); load(); } } },
        { label: 'Pago', className: 'btn btn-success', onClick: r => markPago(r) },
      ],
    });

    const pager = document.createElement('div');
    pager.style.display = 'flex';
    pager.style.justifyContent = 'space-between';
    pager.style.marginTop = '8px';
    pager.innerHTML = `
      <div></div>
      <div>
        <button id="prevPg" class="btn btn-outline">Anterior</button>
        <span style="margin:0 8px;">Página ${page} de ${totalPages}</span>
        <button id="nextPg" class="btn btn-outline">Próxima</button>
      </div>
    `;
    cont.appendChild(pager);
    const prev = pager.querySelector('#prevPg');
    const next = pager.querySelector('#nextPg');
    prev.disabled = page <= 1;
    next.disabled = page >= totalPages;
    prev.addEventListener('click', () => { if (page > 1) { page--; load(); } });
    next.addEventListener('click', () => { if (page < totalPages) { page++; load(); } });
  }

  const debouncedLoad = debounce(() => load(), 250);
  
  document.getElementById('applyFilters').addEventListener('click', () => {
    filters.status = document.getElementById('fStatus').value || undefined;
    filters.tipo_pagamento = document.getElementById('fTipo').value || undefined;
    filters.de = document.getElementById('fDe').value || undefined;
    filters.ate = document.getElementById('fAte').value || undefined;
    filters.onlyOverdue = document.getElementById('fOnlyOverdue').checked || undefined;
    page = 1;
    load();
  });
  document.getElementById('fForNome').addEventListener('input', (e) => { qFor = e.target.value.trim(); page = 1; debouncedLoad(); });
  document.getElementById('fCategoriaNome').addEventListener('input', (e) => { qCat = e.target.value.trim(); page = 1; debouncedLoad(); });
  document.getElementById('fFormaNome').addEventListener('input', (e) => { qForma = e.target.value.trim(); page = 1; debouncedLoad(); });
  document.getElementById('sortField').addEventListener('change', (e) => { sortField = e.target.value; page = 1; load(); });
  document.getElementById('sortDir').addEventListener('change', (e) => { sortDir = e.target.value; page = 1; load(); });
  document.getElementById('newPay').addEventListener('click', openCreate);
  await load();
}
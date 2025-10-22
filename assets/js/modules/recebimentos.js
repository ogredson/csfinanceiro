import { db } from '../supabaseClient.js';
import { showToast, formatCurrency, parseCurrency, formatDate, setLoading, debounce } from '../utils.js';
import { createModal } from '../components/Modal.js';
import { renderTable } from '../components/Table.js';

async function fetchRecebimentos(filters = {}) {
  const opts = { select: 'id, cliente_id, categoria_id, forma_pagamento_id, descricao, valor_esperado, valor_recebido, data_emissao, data_vencimento, data_recebimento, status, tipo_recebimento, parcela_atual, total_parcelas, observacoes' };
  opts.eq = {};
  if (filters.status) opts.eq.status = filters.status;
  if (filters.tipo_recebimento) opts.eq.tipo_recebimento = filters.tipo_recebimento;
  if (filters.cliente_id) opts.eq.cliente_id = filters.cliente_id;
  if (filters.de) opts.gte = { ...(opts.gte||{}), data_vencimento: filters.de };
  if (filters.ate) opts.lte = { ...(opts.lte||{}), data_vencimento: filters.ate };
  opts.orderBy = { column: 'data_vencimento', ascending: true };
  const { data, error } = await db.select('recebimentos', opts);
  if (error) { showToast(error.message || 'Erro ao carregar recebimentos', 'error'); return []; }
  return data || [];
}

// Lookups para combobox
let LOOKUPS = null;
async function ensureLookups() {
  if (LOOKUPS) return LOOKUPS;
  const [cliRes, catRes, formaRes] = await Promise.all([
    db.select('clientes', { select: 'id, nome', orderBy: { column: 'nome', ascending: true } }),
    db.select('categorias', { select: 'id, nome', orderBy: { column: 'nome', ascending: true } }),
    db.select('formas_pagamento', { select: 'id, nome', orderBy: { column: 'nome', ascending: true } }),
  ]);
  const clientes = cliRes.data || [];
  const categorias = catRes.data || [];
  const formas = formaRes.data || [];
  const mapCli = new Map(clientes.map(c => [c.id, c.nome]));
  const mapCat = new Map(categorias.map(c => [c.id, c.nome]));
  const mapForma = new Map(formas.map(f => [f.id, f.nome]));
  LOOKUPS = { clientes, categorias, formas, mapCli, mapCat, mapForma };
  return LOOKUPS;
}

function recebimentoForm(initial = {}, lookups = { clientes: [], categorias: [], formas: [] }) {
  return `
    <form id="recForm">
      <div class="form-row">
        <div class="field"><label>Descrição</label><input id="descricao" value="${initial.descricao||''}" required/></div>
        <div class="field"><label>Cliente</label>
          <input id="cliente_nome" list="cliOptions" value="${initial.cliente_nome||''}" placeholder="Selecione o cliente"/>
          <datalist id="cliOptions">${(lookups.clientes||[]).map(c => `<option value="${c.nome}"></option>`).join('')}</datalist>
        </div>
        <div class="field"><label>Categoria</label>
          <input id="categoria_nome" list="catOptions" value="${initial.categoria_nome||''}" placeholder="Selecione a categoria"/>
          <datalist id="catOptions">${(lookups.categorias||[]).map(c => `<option value="${c.nome}"></option>`).join('')}</datalist>
        </div>
        <div class="field"><label>Forma de Pagamento</label>
          <input id="forma_nome" list="formaOptions" value="${initial.forma_pagamento_nome||''}" placeholder="Selecione a forma"/>
          <datalist id="formaOptions">${(lookups.formas||[]).map(f => `<option value="${f.nome}"></option>`).join('')}</datalist>
        </div>
        <div class="field"><label>Valor Esperado</label><input id="valor_esperado" value="${initial.valor_esperado||''}" /></div>
        <div class="field highlight"><label>Valor Recebido</label><input id="valor_recebido" value="${initial.valor_recebido||''}" /></div>
        <div class="field"><label>Data Emissão</label><input type="date" id="data_emissao" value="${initial.data_emissao||formatDate()}" /></div>
        <div class="field"><label>Data Vencimento</label><input type="date" id="data_vencimento" value="${initial.data_vencimento||formatDate()}" required/></div>
        <div class="field highlight"><label>Data Recebimento</label><input type="date" id="data_recebimento" value="${initial.data_recebimento||''}" /></div>
        <div class="field"><label>Status</label>
          <select id="status">
            <option value="pendente" ${initial.status==='pendente'?'selected':''}>Pendente</option>
            <option value="recebido" ${initial.status==='recebido'?'selected':''}>Recebido</option>
            
            <option value="cancelado" ${initial.status==='cancelado'?'selected':''}>Cancelado</option>
          </select>
        </div>
        <div class="field"><label>Tipo</label>
          <select id="tipo_recebimento">
            <option value="mensal" ${initial.tipo_recebimento==='mensal'?'selected':''}>Mensal</option>
            <option value="avulso" ${initial.tipo_recebimento==='avulso'?'selected':''}>Avulso</option>
            <option value="projeto" ${initial.tipo_recebimento==='projeto'?'selected':''}>Projeto</option>
          </select>
        </div>
        <div class="field"><label>Parcela Atual</label><input type="number" id="parcela_atual" value="${initial.parcela_atual||1}" /></div>
        <div class="field"><label>Total Parcelas</label><input type="number" id="total_parcelas" value="${initial.total_parcelas||1}" /></div>
        <div class="field full"><label>Observações</label><textarea id="observacoes">${initial.observacoes||''}</textarea></div>
      </div>
    </form>`;
}

function getRecFormValues(modal, lookups) {
  const getVal = id => modal.querySelector(`#${id}`).value;
  const findIdByName = (arr, name) => (arr || []).find(x => (x.nome || '').toString() === (name || '').toString())?.id || null;
  const cliente_nome = getVal('cliente_nome');
  const categoria_nome = getVal('categoria_nome');
  const forma_nome = getVal('forma_nome');
  return {
    descricao: getVal('descricao'),
    cliente_id: findIdByName(lookups.clientes, cliente_nome),
    categoria_id: findIdByName(lookups.categorias, categoria_nome),
    forma_pagamento_id: findIdByName(lookups.formas, forma_nome),
    valor_esperado: parseCurrency(getVal('valor_esperado')),
    valor_recebido: parseCurrency(getVal('valor_recebido')),
    data_emissao: getVal('data_emissao') || formatDate(),
    data_vencimento: getVal('data_vencimento'),
    data_recebimento: getVal('data_recebimento') || null,
    status: getVal('status'),
    tipo_recebimento: getVal('tipo_recebimento'),
    parcela_atual: Number(getVal('parcela_atual')||1),
    total_parcelas: Number(getVal('total_parcelas')||1),
    observacoes: getVal('observacoes') || null,
  };
}

async function openCreate() {
  const lookups = await ensureLookups();
  const { modal, close } = createModal({ title: 'Novo Recebimento', content: recebimentoForm({}, lookups), actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Salvar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const values = getRecFormValues(modal, lookups);
      const nomeCli = modal.querySelector('#cliente_nome')?.value?.trim();
      const nomeCat = modal.querySelector('#categoria_nome')?.value?.trim();
      const nomeFor = modal.querySelector('#forma_nome')?.value?.trim();
      if (nomeCli && !values.cliente_id) { showToast('Selecione um cliente válido da lista', 'error'); return; }
      if (nomeCat && !values.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (nomeFor && !values.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      const { error } = await db.insert('recebimentos', values);
      if (error) showToast(error.message||'Erro ao salvar', 'error'); else { showToast('Recebimento criado', 'success'); close(); }
      window.location.hash = '#/recebimentos';
    }}
  ] });
}

async function openEdit(row) {
  const lookups = await ensureLookups();
  const initial = {
    ...row,
    cliente_nome: lookups.mapCli.get(row.cliente_id) || '',
    categoria_nome: lookups.mapCat.get(row.categoria_id) || '',
    forma_pagamento_nome: lookups.mapForma.get(row.forma_pagamento_id) || '',
  };
  const { modal, close } = createModal({ title: 'Editar Recebimento', content: recebimentoForm(initial, lookups), actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Atualizar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const values = getRecFormValues(modal, lookups);
      const nomeCli = modal.querySelector('#cliente_nome')?.value?.trim();
      const nomeCat = modal.querySelector('#categoria_nome')?.value?.trim();
      const nomeFor = modal.querySelector('#forma_nome')?.value?.trim();
      if (nomeCli && !values.cliente_id) { showToast('Selecione um cliente válido da lista', 'error'); return; }
      if (nomeCat && !values.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (nomeFor && !values.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      const { error } = await db.update('recebimentos', row.id, values);
      if (error) {
        showToast(error.message||'Erro ao atualizar', 'error');
      } else {
        showToast('Recebimento atualizado', 'success');
        close();
        window.location.hash = '#/recebimentos';
      }
    }}
  ] });
}

async function markRecebido(row) {
  const valor = row.valor_esperado;
  const { error } = await db.update('recebimentos', row.id, { status: 'recebido', valor_recebido: valor, data_recebimento: formatDate() });
  if (error) showToast(error.message || 'Erro ao marcar recebido', 'error'); else showToast('Marcado como recebido', 'success');
  window.location.hash = '#/recebimentos';
}

function gerarRecibo(row) {
  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>Recibo</title><style>body{font-family:Inter,Arial;padding:20px} .tag{padding:4px 8px;border:1px solid #666;border-radius:8px;display:inline-block;margin-bottom:8px}</style></head>
    <body>
      <h2>Recibo de Pagamento</h2>
      <div class="tag">${row.id}</div>
      <p><strong>Descrição:</strong> ${row.descricao}</p>
      <p><strong>Valor:</strong> ${formatCurrency(row.valor_recebido || row.valor_esperado)}</p>
      <p><strong>Data Recebimento:</strong> ${row.data_recebimento || formatDate()}</p>
      <hr/>
      <p>Emitido automaticamente pelo CS Financeiro.</p>
      <script>window.print()</script>
    </body></html>
  `);
  win.document.close();
}

async function gerarRecorrencia(baseRow, meses = 6) {
  const inserts = [];
  const start = new Date(baseRow.data_vencimento || formatDate());
  for (let i = 1; i <= meses; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, start.getDate());
    const venc = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    inserts.push({
      ...baseRow,
      id: undefined,
      valor_recebido: 0,
      data_recebimento: null,
      status: 'pendente',
      data_vencimento: venc,
      parcela_atual: (baseRow.parcela_atual||1) + i,
      total_parcelas: Math.max(baseRow.total_parcelas||1, (baseRow.parcela_atual||1)+i),
    });
  }
  const { error } = await db.insert('recebimentos', inserts);
  if (error) showToast(error.message||'Erro ao gerar recorrência', 'error'); else showToast('Recorrência criada', 'success');
}

export async function renderRecebimentos(app) {
  app.innerHTML = `
    <div class="toolbar">
      <div class="filters">
        <select id="fStatus"><option value="">Todos</option><option value="pendente">Pendente</option><option value="recebido">Recebido</option><option value="cancelado">Cancelado</option></select>
        <select id="fTipo"><option value="">Todos</option><option value="mensal">Mensal</option><option value="avulso">Avulso</option><option value="projeto">Projeto</option></select>
        <input type="date" id="fDe" />
        <input type="date" id="fAte" />
        <input id="fCliNome" placeholder="Cliente (nome)" />
        <input id="fCategoriaNome" placeholder="Categoria (nome)" />
        <input id="fFormaNome" placeholder="Forma de recebimento (nome)" />
        <label style="display:inline-flex;align-items:center;gap:6px;margin-left:8px;">
          <input type="checkbox" id="fOnlyOverdue" /> Somente em atraso
        </label>
        <button id="applyFilters" class="btn btn-outline">Filtrar</button>
        <select id="sortField" style="margin-left:8px;">
          <option value="data_vencimento" selected>Ordenar por Data Venc.</option>
          <option value="data_recebimento">Ordenar por Data Rec.</option>
          <option value="descricao">Ordenar por Descrição</option>
          <option value="valor_esperado">Ordenar por Valor Esperado</option>
          <option value="valor_recebido">Ordenar por Valor Recebido</option>
          <option value="cliente_nome">Ordenar por Cliente</option>
          <option value="categoria_nome">Ordenar por Categoria</option>
          <option value="forma_pagamento_nome">Ordenar por Forma</option>
        </select>
        <select id="sortDir" style="margin-left:8px;">
          <option value="asc" selected>Ascendente</option>
          <option value="desc">Descendente</option>
        </select>
      </div>
      <div>
        <button id="newRec" class="btn btn-primary">Novo</button>
        <button id="relatorio" class="btn btn-outline">Relatório de receitas</button>
      </div>
    </div>
    <div class="card" id="listCard"></div>
  `;

  const filters = {};
  let currentRows = [];
  let qCli = '';
  let qCat = '';
  let qForma = '';
  const perPage = 20;
  let page = 1;
  let sortField = 'data_vencimento';
  let sortDir = 'asc';
  let loadVersion = 0;

  function ilike(hay, needle) { if (!needle) return true; return (hay || '').toString().toLowerCase().includes((needle||'').toLowerCase()); }

  async function buildMaps(rows) {
    const idsCli = Array.from(new Set(rows.map(r => r.cliente_id).filter(Boolean)));
    const idsCat = Array.from(new Set(rows.map(r => r.categoria_id).filter(Boolean)));
    const idsForma = Array.from(new Set(rows.map(r => r.forma_pagamento_id).filter(Boolean)));
    const [cliRes, catRes, formaRes] = await Promise.all([
      idsCli.length ? db.select('clientes', { select: 'id, nome', in: { id: idsCli } }) : Promise.resolve({ data: [] }),
      idsCat.length ? db.select('categorias', { select: 'id, nome', in: { id: idsCat } }) : Promise.resolve({ data: [] }),
      idsForma.length ? db.select('formas_pagamento', { select: 'id, nome', in: { id: idsForma } }) : Promise.resolve({ data: [] }),
    ]);
    const mapCli = new Map((cliRes.data || []).map(c => [c.id, c.nome]));
    const mapCat = new Map((catRes.data || []).map(c => [c.id, c.nome]));
    const mapForma = new Map((formaRes.data || []).map(f => [f.id, f.nome]));
    return { mapCli, mapCat, mapForma };
  }

  async function load() {
    const cont = document.getElementById('listCard');
    const myVersion = ++loadVersion;
    setLoading(cont, true);
    // remove limpeza imediata para evitar race conditions
    const serverMode = !qCli && !qCat && !qForma;
    let rows = [];
    let totalPages = 1;
  
    if (serverMode) {
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;
      const opts = { select: 'id, cliente_id, categoria_id, forma_pagamento_id, descricao, valor_esperado, valor_recebido, data_emissao, data_vencimento, data_recebimento, status, tipo_recebimento, parcela_atual, total_parcelas, observacoes' };
      opts.eq = {};
      if (filters.status) opts.eq.status = filters.status;
      if (filters.tipo_recebimento) opts.eq.tipo_recebimento = filters.tipo_recebimento;
      if (filters.cliente_id) opts.eq.cliente_id = filters.cliente_id;
      if (filters.de) opts.gte = { ...(opts.gte||{}), data_vencimento: filters.de };
      if (filters.ate) opts.lte = { ...(opts.lte||{}), data_vencimento: filters.ate };
      const serverSortable = new Set(['data_vencimento','data_recebimento','descricao','valor_esperado','valor_recebido','status','tipo_recebimento','parcela_atual','total_parcelas','created_at']);
      const orderColumn = serverSortable.has(sortField) ? sortField : 'data_vencimento';
      const ascending = (sortDir !== 'desc');
      opts.orderBy = { column: orderColumn, ascending };
      opts.count = 'exact';
      opts.from = from; opts.to = to;
      const { data, error, count } = await db.select('recebimentos', opts);
      if (error) { showToast(error.message || 'Erro ao carregar recebimentos', 'error'); rows = []; }
      else { rows = data || []; }
      const totalCount = Number(count || (rows?.length || 0));
      totalPages = Math.max(1, Math.ceil(totalCount / perPage));
      if (page > totalPages) {
        page = totalPages;
        const from2 = (page - 1) * perPage;
        const to2 = from2 + perPage - 1;
        const { data: data2 } = await db.select('recebimentos', { ...opts, from: from2, to: to2 });
        rows = data2 || [];
      }
    } else {
      rows = await fetchRecebimentos(filters);
    }
  
    // se houve outra chamada mais recente, aborta render desta
    if (myVersion !== loadVersion) return;
  
    currentRows = rows;
    const { mapCli, mapCat, mapForma } = await buildMaps(rows);
  
    // checa novamente após lookups (também assíncrono)
    if (myVersion !== loadVersion) return;
  
    const enriched = rows.map(r => ({
      ...r,
      cliente_nome: mapCli.get(r.cliente_id) || '—',
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

    const nameFiltered = serverMode ? enriched : enriched.filter(r => ilike(r.cliente_nome, qCli) && ilike(r.categoria_nome, qCat) && ilike(r.forma_pagamento_nome, qForma));
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
  
    // só agora limpa e renderiza
    cont.innerHTML = '';
    setLoading(cont, false);
  
    renderTable(cont, {
      columns: [
        { key: 'descricao', label: 'Descrição' },
        { key: 'cliente_nome', label: 'Cliente' },
        { key: 'categoria_nome', label: 'Categoria' },
        { key: 'forma_pagamento_nome', label: 'Forma Rec.' },
        { key: 'valor_esperado', label: 'Esperado', render: v => `<strong>${formatCurrency(v)}</strong>` },
        { key: 'valor_recebido', label: 'Recebido', render: v => `${formatCurrency(v)}` },
        { key: 'data_recebimento', label: 'Rec.' },
        { key: 'data_vencimento', label: 'Venc.' },
        { key: 'dias_vencimento', label: 'Dias', render: (_v, r) => diasLabel(r) },
        { key: 'status', label: 'Status', render: v => `<span class="status-pill status-${v}">${v}</span>` },
        { key: 'tipo_recebimento', label: 'Tipo' },
      ],
      rows: sorted,
      page: serverMode ? 1 : page,
      perPage,
      actions: [
        { label: 'Editar', className: 'btn btn-outline', onClick: r => openEdit(r) },
        { label: 'Excluir', className: 'btn btn-danger', onClick: async r => { const ok = confirm(`Confirma a exclusão de "${r.descricao}"? Esta ação não pode ser desfeita.`); if (!ok) return; const { error } = await db.remove('recebimentos', r.id); if (error) showToast(error.message||'Erro ao excluir','error'); else { showToast('Excluído','success'); load(); } } },
        { label: 'Recebido', className: 'btn btn-success', onClick: r => markRecebido(r) },
      ],
    });
  
    const pager = document.createElement('div');
    pager.style.display = 'flex';
    pager.style.justifyContent = 'space-between';
    pager.style.marginTop = '8px';
    pager.innerHTML = `
      <div></div>
      <div>
        <button id="prevRec" class="btn btn-outline">Anterior</button>
        <span style="margin:0 8px;">Página ${page} de ${totalPages}</span>
        <button id="nextRec" class="btn btn-outline">Próxima</button>
      </div>
    `;
    cont.appendChild(pager);
    const prev = pager.querySelector('#prevRec');
    const next = pager.querySelector('#nextRec');
    prev.disabled = page <= 1;
    next.disabled = page >= totalPages;
    prev.addEventListener('click', () => { if (page > 1) { page--; load(); } });
    next.addEventListener('click', () => { if (page < totalPages) { page++; load(); } });
  }

  const debouncedLoad = debounce(() => load(), 250);
  
  document.getElementById('applyFilters').addEventListener('click', () => {
    filters.status = document.getElementById('fStatus').value || undefined;
    filters.tipo_recebimento = document.getElementById('fTipo').value || undefined;
    filters.de = document.getElementById('fDe').value || undefined;
    filters.ate = document.getElementById('fAte').value || undefined;
    filters.onlyOverdue = document.getElementById('fOnlyOverdue').checked || undefined;
    page = 1;
    load();
  });
  document.getElementById('fCliNome').addEventListener('input', (e) => { qCli = e.target.value.trim(); page = 1; debouncedLoad(); });
  document.getElementById('fCategoriaNome').addEventListener('input', (e) => { qCat = e.target.value.trim(); page = 1; debouncedLoad(); });
  document.getElementById('fFormaNome').addEventListener('input', (e) => { qForma = e.target.value.trim(); page = 1; debouncedLoad(); });
  document.getElementById('sortField').addEventListener('change', (e) => { sortField = e.target.value; page = 1; load(); });
  document.getElementById('sortDir').addEventListener('change', (e) => { sortDir = e.target.value; page = 1; load(); });
  document.getElementById('newRec').addEventListener('click', openCreate);
  document.getElementById('relatorio').addEventListener('click', () => relatorioReceitas(currentRows));
  await load();
}
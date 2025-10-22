import { db } from '../supabaseClient.js';
import { showToast, formatCurrency } from '../utils.js';
import { createModal } from '../components/Modal.js';
import { renderTable } from '../components/Table.js';

async function fetchFornecedores() {
  const { data, error } = await db.select('fornecedores', { select: 'id, nome, email, telefone, documento, ativo, created_at', orderBy: { column: 'created_at', ascending: false } });
  if (error) { showToast(error.message || 'Erro ao carregar fornecedores', 'error'); return []; }
  return data || [];
}

function fornecedorForm(initial = {}) {
  return `
    <form id="fornForm">
      <div class="form-row">
        <div class="field"><label>Nome</label><input id="nome" value="${initial.nome||''}" required/></div>
        <div class="field"><label>Email</label><input type="email" id="email" value="${initial.email||''}"/></div>
        <div class="field"><label>Telefone</label><input id="telefone" value="${initial.telefone||''}"/></div>
        <div class="field"><label>Documento</label><input id="documento" value="${initial.documento||''}"/></div>
        <div class="field"><label>Ativo</label><select id="ativo"><option value="true">Ativo</option><option value="false">Inativo</option></select></div>
      </div>
    </form>`;
}

function getFornFormValues(modal) {
  const getVal = id => modal.querySelector(`#${id}`).value;
  return {
    nome: getVal('nome'),
    email: getVal('email') || null,
    telefone: getVal('telefone') || null,
    documento: getVal('documento') || null,
    ativo: getVal('ativo') === 'true',
  };
}

async function openCreate() {
  const { modal, close } = createModal({ title: 'Novo Fornecedor', content: fornecedorForm(), actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Salvar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const values = getFornFormValues(modal);
      const { error } = await db.insert('fornecedores', values);
      if (error) showToast(error.message||'Erro ao salvar', 'error'); else { showToast('Fornecedor criado', 'success'); close(); }
      window.location.hash = '#/fornecedores';
    }}
  ] });
}

async function openEdit(row) {
  const { modal, close } = createModal({ title: 'Editar Fornecedor', content: fornecedorForm(row), actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Atualizar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const values = getFornFormValues(modal);
      const { error } = await db.update('fornecedores', row.id, values);
      if (error) {
        showToast(error.message||'Erro ao atualizar', 'error');
      } else {
        showToast('Fornecedor atualizado', 'success');
        close();
        window.dispatchEvent(new Event('hashchange'));
      }
    }}
  ] });
}

async function historicoPagamentos(fornecedorId) {
  const { data, error } = await db.select('pagamentos', { eq: { fornecedor_id: fornecedorId }, select: 'descricao, valor_pago, valor_esperado, status, data_vencimento, data_pagamento' });
  if (error) { showToast(error.message || 'Erro ao carregar histórico', 'error'); return; }
  const { modal } = createModal({ title: 'Histórico do Fornecedor', content: `
    <div class="card">
      ${(data||[]).map(p => `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #1F2937;padding:8px 0;">
        <div>${p.descricao} <span class="status-pill status-${p.status}" style="margin-left:8px;">${p.status}</span></div>
        <div>${formatCurrency(p.valor_pago || p.valor_esperado)}</div>
      </div>`).join('') || '<div class="empty-state">Sem histórico</div>'}
    </div>
  `, actions: [ { label: 'Fechar', className: 'btn btn-outline', onClick: ({ close }) => close() } ] });
}

export async function renderFornecedores(app) {
  app.innerHTML = `
    <div class="toolbar">
      <div class="filters">
        <input id="qForn" placeholder="Pesquisar (nome, email, telefone, documento)" />
        <button id="applySearchForn" class="btn btn-outline">Pesquisar</button>
      </div>
      <div><button id="newForn" class="btn btn-primary">Novo Fornecedor</button></div>
    </div>
    <div class="card" id="listCard"></div>
  `;
  const perPage = 20;
  let page = 1;
  let q = '';
  let allRows = [];

  function applyFilter(rows = []) {
    if (!q) return rows;
    const term = q.toLowerCase();
    return rows.filter(r => [r.nome, r.email, r.telefone, r.documento]
      .some(v => (v || '').toString().toLowerCase().includes(term))
    );
  }

  function renderList() {
    const cont = document.getElementById('listCard');
    cont.innerHTML = '';
    const filtered = applyFilter(allRows);
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    if (page > totalPages) page = totalPages;

    renderTable(cont, {
      columns: [
        { key: 'nome', label: 'Nome' },
        { key: 'email', label: 'Email' },
        { key: 'telefone', label: 'Telefone' },
        { key: 'documento', label: 'Documento' },
        { key: 'ativo', label: 'Status', render: v => `<span class="status-pill ${v?'status-recebido':'status-cancelado'}">${v?'Ativo':'Inativo'}</span>` },
      ],
      rows: filtered,
      page,
      perPage,
      actions: [
        { label: 'Editar', className: 'btn btn-outline', onClick: r => openEdit(r) },
        { label: 'Excluir', className: 'btn btn-danger', onClick: async r => { const { error } = await db.remove('fornecedores', r.id); if (error) showToast(error.message||'Erro ao excluir','error'); else { showToast('Excluído','success'); await load(); } } },
        { label: 'Histórico', className: 'btn btn-outline', onClick: r => historicoPagamentos(r.id) },
      ],
    });

    const pager = document.createElement('div');
    pager.style.display = 'flex';
    pager.style.justifyContent = 'space-between';
    pager.style.marginTop = '8px';
    pager.innerHTML = `
      <div></div>
      <div>
        <button id="prevForn" class="btn btn-outline">Anterior</button>
        <span style="margin:0 8px;">Página ${page} de ${totalPages}</span>
        <button id="nextForn" class="btn btn-outline">Próxima</button>
      </div>
    `;
    cont.appendChild(pager);
    const prev = pager.querySelector('#prevForn');
    const next = pager.querySelector('#nextForn');
    prev.disabled = page <= 1;
    next.disabled = page >= totalPages;
    prev.addEventListener('click', () => { if (page > 1) { page--; renderList(); } });
    next.addEventListener('click', () => { if (page < totalPages) { page++; renderList(); } });
  }

  async function load() {
    allRows = await fetchFornecedores();
    page = 1; // reset ao carregar
    renderList();
  }

  document.getElementById('newForn').addEventListener('click', openCreate);
  document.getElementById('applySearchForn').addEventListener('click', async () => { q = document.getElementById('qForn').value.trim(); page = 1; await load(); });
  document.getElementById('qForn').addEventListener('input', (e) => { q = e.target.value.trim(); page = 1; renderList(); });
  await load();
}
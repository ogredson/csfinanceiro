import { db } from '../supabaseClient.js';
import { showToast, exportToCSV } from '../utils.js';
import { renderTable } from '../components/Table.js';
import { createModal } from '../components/Modal.js';

async function fetchCategorias() {
  const { data, error } = await db.select('categorias', { select: 'id, nome, tipo, cor, created_at', orderBy: { column: 'created_at', ascending: false } });
  if (error) { showToast(error.message || 'Erro ao carregar categorias', 'error'); return []; }
  return data || [];
}

async function fetchFormas() {
  const { data, error } = await db.select('formas_pagamento', { select: 'id, nome, ativo, created_at', orderBy: { column: 'created_at', ascending: false } });
  if (error) { showToast(error.message || 'Erro ao carregar formas de pagamento', 'error'); return []; }
  return data || [];
}

function categoriaForm(initial={}) {
  return `
    <form id="catForm">
      <div class="form-row">
        <div class="field"><label>Nome</label><input id="nome" value="${initial.nome||''}" required/></div>
        <div class="field"><label>Tipo</label><select id="tipo"><option value="entrada">Entrada</option><option value="saida">Saída</option></select></div>
        <div class="field"><label>Cor</label><input id="cor" value="${initial.cor||'#6B7280'}" /></div>
      </div>
    </form>`;
}

function formaForm(initial={}) {
  return `
    <form id="fpForm">
      <div class="form-row">
        <div class="field"><label>Nome</label><input id="nome" value="${initial.nome||''}" required/></div>
        <div class="field"><label>Ativo</label><select id="ativo"><option value="true">Ativo</option><option value="false">Inativo</option></select></div>
      </div>
    </form>`;
}

export async function renderConfig(app) {
  app.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <div class="toolbar"><h3>Categorias</h3><div><button id="newCat" class="btn btn-primary">Nova</button> <button id="expCat" class="btn btn-outline">Exportar CSV</button></div></div>
        <div id="catList"></div>
      </div>
      <div class="card">
        <div class="toolbar"><h3>Formas de Pagamento</h3><div><button id="newFp" class="btn btn-primary">Nova</button> <button id="expFp" class="btn btn-outline">Exportar CSV</button></div></div>
        <div id="fpList"></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <h3>Backup de dados</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="backupRec" class="btn btn-outline">Exportar Recebimentos</button>
        <button id="backupPag" class="btn btn-outline">Exportar Pagamentos</button>
        <button id="backupCli" class="btn btn-outline">Exportar Clientes</button>
        <button id="backupForn" class="btn btn-outline">Exportar Fornecedores</button>
      </div>
    </div>
  `;

  async function loadCats() {
    const cats = await fetchCategorias();
    const cont = document.getElementById('catList'); cont.innerHTML='';
    renderTable(cont, {
      columns: [ { key: 'nome', label: 'Nome' }, { key: 'tipo', label: 'Tipo' }, { key: 'cor', label: 'Cor' } ],
      rows: cats,
      actions: [
        { label: 'Editar', className: 'btn btn-outline', onClick: c => {
          const { modal, close } = createModal({ title: 'Editar Categoria', content: categoriaForm(c), actions: [
            { label: 'Cancelar', className: 'btn btn-outline', onClick: ({ close }) => close() },
            { label: 'Salvar', className: 'btn btn-primary', onClick: async ({ modal, close }) => {
              const v = { nome: modal.querySelector('#nome').value, tipo: modal.querySelector('#tipo').value, cor: modal.querySelector('#cor').value };
              const { error } = await db.update('categorias', c.id, v); if (error) showToast(error.message||'Erro', 'error'); else { showToast('Categoria atualizada', 'success'); close(); loadCats(); }
            }},
          ] });
        } },
        { label: 'Excluir', className: 'btn btn-danger', onClick: async c => { const { error } = await db.remove('categorias', c.id); if (error) showToast(error.message||'Erro','error'); else { showToast('Excluída','success'); loadCats(); } } },
      ],
    });
    document.getElementById('expCat').onclick = () => exportToCSV('categorias.csv', cats);
  }

  async function loadFp() {
    const fps = await fetchFormas();
    const cont = document.getElementById('fpList'); cont.innerHTML='';
    renderTable(cont, {
      columns: [ { key: 'nome', label: 'Nome' }, { key: 'ativo', label: 'Ativo' } ],
      rows: fps,
      actions: [
        { label: 'Editar', className: 'btn btn-outline', onClick: f => {
          const { modal, close } = createModal({ title: 'Editar Forma', content: formaForm(f), actions: [
            { label: 'Cancelar', className: 'btn btn-outline', onClick: ({ close }) => close() },
            { label: 'Salvar', className: 'btn btn-primary', onClick: async ({ modal, close }) => {
              const v = { nome: modal.querySelector('#nome').value, ativo: modal.querySelector('#ativo').value === 'true' };
              const { error } = await db.update('formas_pagamento', f.id, v); if (error) showToast(error.message||'Erro', 'error'); else { showToast('Forma atualizada', 'success'); close(); loadFp(); }
            }},
          ] });
        } },
        { label: 'Excluir', className: 'btn btn-danger', onClick: async f => { const { error } = await db.remove('formas_pagamento', f.id); if (error) showToast(error.message||'Erro','error'); else { showToast('Excluída','success'); loadFp(); } } },
      ],
    });
    document.getElementById('expFp').onclick = () => exportToCSV('formas_pagamento.csv', fps);
  }

  document.getElementById('newCat').onclick = () => {
    const { modal, close } = createModal({ title: 'Nova Categoria', content: categoriaForm(), actions: [
      { label: 'Cancelar', className: 'btn btn-outline', onClick: ({ close }) => close() },
      { label: 'Salvar', className: 'btn btn-primary', onClick: async ({ modal, close }) => {
        const v = { nome: modal.querySelector('#nome').value, tipo: modal.querySelector('#tipo').value, cor: modal.querySelector('#cor').value };
        const { error } = await db.insert('categorias', v); if (error) showToast(error.message||'Erro', 'error'); else { showToast('Categoria criada', 'success'); close(); loadCats(); }
      }},
    ] });
  };

  document.getElementById('newFp').onclick = () => {
    const { modal, close } = createModal({ title: 'Nova Forma de Pagamento', content: formaForm(), actions: [
      { label: 'Cancelar', className: 'btn btn-outline', onClick: ({ close }) => close() },
      { label: 'Salvar', className: 'btn btn-primary', onClick: async ({ modal, close }) => {
        const v = { nome: modal.querySelector('#nome').value, ativo: modal.querySelector('#ativo').value === 'true' };
        const { error } = await db.insert('formas_pagamento', v); if (error) showToast(error.message||'Erro', 'error'); else { showToast('Forma criada', 'success'); close(); loadFp(); }
      }},
    ] });
  };

  document.getElementById('backupRec').onclick = async () => { const { data } = await db.select('recebimentos', { select: '*' }); exportToCSV('recebimentos.csv', data||[]); };
  document.getElementById('backupPag').onclick = async () => { const { data } = await db.select('pagamentos', { select: '*' }); exportToCSV('pagamentos.csv', data||[]); };
  document.getElementById('backupCli').onclick = async () => { const { data } = await db.select('clientes', { select: '*' }); exportToCSV('clientes.csv', data||[]); };
  document.getElementById('backupForn').onclick = async () => { const { data } = await db.select('fornecedores', { select: '*' }); exportToCSV('fornecedores.csv', data||[]); };

  await loadCats();
  await loadFp();
}
import { db } from '../supabaseClient.js';
import { showToast, formatCurrency, sanitizeText } from '../utils.js';
import { createModal } from '../components/Modal.js';
import { renderTable } from '../components/Table.js';

async function fetchClientes() {
  const { data, error } = await db.select('clientes', { select: [
    'id, nome, email, telefone, documento, grupo_cliente, tipo_empresa, regime_tributario, observacao, ativo, created_at',
    // novos campos
    'nome_fantasia, ie, im, cnae, logradouro, numero, complemento, bairro, cep, cidade, uf, tipo_unidade'
  ].join(', '), orderBy: { column: 'created_at', ascending: false } });
  if (error) { showToast(error.message || 'Erro ao carregar clientes', 'error'); return []; }
  return data || [];
}

function clienteForm(initial = {}) {
  return `
    <form id="cliForm">
      <div class="card">
        <h3>Identificação e Contato</h3>
        <div class="form-row">
          <div class="field"><label>Nome</label><input id="nome" value="${initial.nome||''}" required/></div>
          <div class="field"><label>Nome Fantasia</label><input id="nome_fantasia" value="${initial.nome_fantasia||''}"/></div>
          <div class="field"><label>Email</label><input type="email" id="email" value="${initial.email||''}"/></div>
          <div class="field"><label>Telefone</label><input id="telefone" value="${initial.telefone||''}"/></div>
        </div>
      </div>

      <div class="card" style="margin-top:12px;">
        <h3>Documentos</h3>
        <div class="form-row">
          <div class="field"><label>Documento (CPF/CNPJ)</label><input id="documento" value="${initial.documento||''}"/></div>
          <div class="field"><label>Inscrição Estadual (IE)</label><input id="ie" value="${initial.ie||''}"/></div>
          <div class="field"><label>Inscrição Municipal (IM)</label><input id="im" value="${initial.im||''}"/></div>
          <div class="field"><label>CNAE</label><input id="cnae" value="${initial.cnae||''}" placeholder="Ex.: 4741-5/00"/></div>
        </div>
      </div>

      <div class="card" style="margin-top:12px;">
        <h3>Empresa</h3>
        <div class="form-row">
          <div class="field"><label>Grupo do Cliente</label><input id="grupo_cliente" value="${initial.grupo_cliente||''}" placeholder="Ex.: VIP, Atacado, Revenda"/></div>
          <div class="field"><label>Tipo de Empresa</label>
            <select id="tipo_empresa">
              <option value="comercio" ${initial.tipo_empresa==='comercio'?'selected':''}>Comércio</option>
              <option value="servico" ${initial.tipo_empresa==='servico'?'selected':''}>Serviço</option>
              <option value="comercio e servico" ${initial.tipo_empresa==='comercio e servico'?'selected':''}>Comércio e Serviço</option>
              <option value="industria" ${initial.tipo_empresa==='industria'?'selected':''}>Indústria</option>
            </select>
          </div>
          <div class="field"><label>Regime Tributário</label>
            <select id="regime_tributario">
              <option value="simples nacional" ${initial.regime_tributario==='simples nacional'?'selected':''}>Simples Nacional</option>
              <option value="lucro real" ${initial.regime_tributario==='lucro real'?'selected':''}>Lucro Real</option>
              <option value="lucro presumido" ${initial.regime_tributario==='lucro presumido'?'selected':''}>Lucro Presumido</option>
              <option value="outro" ${initial.regime_tributario==='outro'?'selected':''}>Outro</option>
            </select>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:12px;">
        <h3>Endereço</h3>
        <div class="form-row">
          <div class="field"><label>Logradouro</label><input id="logradouro" value="${initial.logradouro||''}"/></div>
          <div class="field"><label>Número</label><input id="numero" value="${initial.numero||''}"/></div>
          <div class="field"><label>Complemento</label><input id="complemento" value="${initial.complemento||''}"/></div>
          <div class="field"><label>Bairro</label><input id="bairro" value="${initial.bairro||''}"/></div>
          <div class="field"><label>CEP</label><input id="cep" value="${initial.cep||''}" placeholder="Ex.: 00000-000"/></div>
          <div class="field"><label>Cidade</label><input id="cidade" value="${initial.cidade||''}"/></div>
          <div class="field"><label>UF</label><input id="uf" value="${initial.uf||''}" maxlength="2" placeholder="Ex.: CE"/></div>
        </div>
      </div>

      <div class="card" style="margin-top:12px;">
        <h3>Unidade e Status</h3>
        <div class="form-row">
          <div class="field"><label>Tipo de Unidade</label>
            <select id="tipo_unidade">
              <option value="matriz" ${initial.tipo_unidade==='matriz'?'selected':''}>Matriz</option>
              <option value="filial" ${initial.tipo_unidade==='filial'?'selected':''}>Filial</option>
            </select>
          </div>
          <div class="field"><label>Ativo</label>
            <select id="ativo">
              <option value="true" ${initial.ativo===true?'selected':''}>Ativo</option>
              <option value="false" ${initial.ativo===false?'selected':''}>Inativo</option>
            </select>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:12px;">
        <h3>Observação</h3>
        <div class="form-row">
          <div class="field full"><label>Observação</label><textarea id="observacao" rows="3">${initial.observacao||''}</textarea></div>
        </div>
      </div>
    </form>`;
}

function getCliFormValues(modal) {
  const getVal = id => modal.querySelector(`#${id}`).value;
  return {
    nome: getVal('nome'),
    nome_fantasia: getVal('nome_fantasia') || null,
    email: getVal('email') || null,
    telefone: getVal('telefone') || null,
    documento: getVal('documento') || null,
    ie: getVal('ie') || null,
    im: getVal('im') || null,
    cnae: getVal('cnae') || null,
    grupo_cliente: getVal('grupo_cliente') || null,
    tipo_empresa: getVal('tipo_empresa') || null,
    regime_tributario: getVal('regime_tributario') || null,
    logradouro: getVal('logradouro') || null,
    numero: getVal('numero') || null,
    complemento: getVal('complemento') || null,
    bairro: getVal('bairro') || null,
    cep: getVal('cep') || null,
    cidade: getVal('cidade') || null,
    uf: getVal('uf') || null,
    tipo_unidade: getVal('tipo_unidade') || 'matriz',
    observacao: getVal('observacao') || null,
    ativo: getVal('ativo') === 'true',
  };
}

async function openCreate() {
  const { modal, close } = createModal({ title: 'Novo Cliente', content: clienteForm(), actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Salvar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const values = getCliFormValues(modal);
      const { error } = await db.insert('clientes', values);
      if (error) showToast(error.message||'Erro ao salvar', 'error'); else { showToast('Cliente criado', 'success'); close(); }
      window.location.hash = '#/clientes';
    }}
  ] });
}

async function openEdit(row) {
  const { modal, close } = createModal({ title: 'Editar Cliente', content: clienteForm(row), actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Atualizar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const values = getCliFormValues(modal);
      const { error } = await db.update('clientes', row.id, values);
      if (error) {
        showToast(error.message||'Erro ao atualizar', 'error');
      } else {
        showToast('Cliente atualizado', 'success');
        close();
        window.dispatchEvent(new Event('hashchange'));
      }
    }}
  ] });
}

async function historicoRecebimentos(clienteId) {
  const { data, error } = await db.select('recebimentos', { eq: { cliente_id: clienteId }, select: 'descricao, valor_recebido, valor_esperado, status, data_vencimento, data_recebimento' });
  if (error) { showToast(error.message || 'Erro ao carregar histórico', 'error'); return; }
  const { modal } = createModal({ title: 'Histórico do Cliente', content: `
    <div class="card">
      ${(data||[]).map(r => `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #1F2937;padding:8px 0;">
        <div>${r.descricao} <span class="status-pill status-${r.status}" style="margin-left:8px;">${r.status}</span></div>
        <div>${formatCurrency(r.valor_recebido || r.valor_esperado)}</div>
      </div>`).join('') || '<div class="empty-state">Sem histórico</div>'}
    </div>
  `, actions: [ { label: 'Fechar', className: 'btn btn-outline', onClick: ({ close }) => close() } ] });
}

export async function renderClientes(app) {
  app.innerHTML = `
    <div class="toolbar">
      <div class="filters">
        <input id="qCli" placeholder="Pesquisar (nome, email, telefone, documento)" />
        <select id="fGrupoCli" style="margin-left:8px">
          <option value="">Todos os grupos</option>
        </select>
        <button id="applySearchCli" class="btn btn-primary btn-prominent">🔎 Pesquisar</button>
      </div>
      <div><button id="newCli" class="btn btn-primary">Novo Cliente</button></div>
    </div>
    <div class="card" id="listCard"></div>
  `;
  const perPage = 20;
  let page = 1;
  let q = '';
  let fGrupo = '';
  let allRows = [];

  function applyFilter(rows = []) {
    // texto livre
    const base = (() => {
      if (!q) return rows;
      const term = q.toLowerCase();
      return rows.filter(r => [r.nome, r.email, r.telefone, r.documento, r.grupo_cliente, r.tipo_empresa, r.regime_tributario]
        .some(v => (v || '').toString().toLowerCase().includes(term))
      );
    })();
    // filtro por grupo
    if (!fGrupo) return base;
    return base.filter(r => (r.grupo_cliente || '') === fGrupo);
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
        { key: 'grupo_cliente', label: 'Grupo' },
        { key: 'tipo_empresa', label: 'Tipo de Empresa' },
        { key: 'regime_tributario', label: 'Regime Tributário' },
        { key: 'ativo', label: 'Status', render: v => `<span class="status-pill ${v?'status-recebido':'status-cancelado'}">${v?'Ativo':'Inativo'}</span>` },
      ],
      rows: filtered,
      page,
      perPage,
      actions: [
        { label: '✏️ Editar', className: 'btn btn-primary btn-prominent', onClick: r => openEdit(r) },
        { label: 'Excluir', className: 'btn btn-danger', onClick: async r => {
          const nome = sanitizeText(r.nome || '');
          const { modal, close } = createModal({
            title: 'Confirmar exclusão',
            content: `<div class="card"><p>Deseja realmente excluir o cliente <strong>${nome}</strong>? Esta ação não pode ser desfeita.</p></div>`,
            actions: [
              { label: 'Cancelar', className: 'btn btn-outline', onClick: ({ close }) => close() },
              { label: 'Excluir', className: 'btn btn-danger', onClick: async ({ close }) => {
                const { error } = await db.remove('clientes', r.id);
                if (error) showToast(error.message||'Erro ao excluir','error');
                else { showToast('Cliente excluído','success'); await load(); }
                close();
              } }
            ]
          });
        } },
        { label: 'Histórico', className: 'btn btn-outline', onClick: r => historicoRecebimentos(r.id) },
      ],
    });

    const pager = document.createElement('div');
    pager.style.display = 'flex';
    pager.style.justifyContent = 'space-between';
    pager.style.marginTop = '8px';
    pager.innerHTML = `
      <div></div>
      <div>
        <button id="prevCli" class="btn btn-outline">Anterior</button>
        <span style="margin:0 8px;">Página ${page} de ${totalPages}</span>
        <button id="nextCli" class="btn btn-outline">Próxima</button>
      </div>
    `;
    cont.appendChild(pager);
    const prev = pager.querySelector('#prevCli');
    const next = pager.querySelector('#nextCli');
    prev.disabled = page <= 1;
    next.disabled = page >= totalPages;
    prev.addEventListener('click', () => { if (page > 1) { page--; renderList(); } });
    next.addEventListener('click', () => { if (page < totalPages) { page++; renderList(); } });
  }

  async function load() {
    allRows = await fetchClientes();
    // popular opções do filtro de grupo
    const sel = document.getElementById('fGrupoCli');
    if (sel) {
      const uniq = Array.from(new Set((allRows||[]).map(r => r.grupo_cliente).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
      // mantém primeira opção e recria demais
      sel.innerHTML = `<option value="">Todos os grupos</option>` + uniq.map(g => `<option value="${g}">${g}</option>`).join('');
      // se o grupo selecionado não existe mais, limpa
      const exists = uniq.includes(fGrupo);
      if (!exists) fGrupo = '';
    }
    page = 1; // reset ao carregar
    renderList();
  }

  document.getElementById('newCli').addEventListener('click', openCreate);
  document.getElementById('applySearchCli').addEventListener('click', async () => { q = document.getElementById('qCli').value.trim(); page = 1; await load(); });
  document.getElementById('qCli').addEventListener('input', (e) => { q = e.target.value.trim(); page = 1; renderList(); });
  document.getElementById('fGrupoCli').addEventListener('change', (e) => { fGrupo = e.target.value; page = 1; renderList(); });
  await load();
}
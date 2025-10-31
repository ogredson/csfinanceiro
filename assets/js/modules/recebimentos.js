import { db } from '../supabaseClient.js';
import { showToast, formatCurrency, parseCurrency, formatDate, formatDateBR, setLoading, debounce, exportToCSV, sanitizeText } from '../utils.js';
import { createModal } from '../components/Modal.js';
import { renderTable } from '../components/Table.js';

async function fetchRecebimentos(filters = {}) {
  const opts = { select: 'id, cliente_id, categoria_id, forma_pagamento_id, descricao, valor_esperado, valor_recebido, data_emissao, data_vencimento, data_recebimento, dia_recebimento, status, tipo_recebimento, parcela_atual, total_parcelas, observacoes' };
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
    db.select('clientes', { select: 'id, nome, documento, observacao', orderBy: { column: 'nome', ascending: true } }),
    db.select('categorias', { select: 'id, nome', orderBy: { column: 'nome', ascending: true } }),
    db.select('formas_pagamento', { select: 'id, nome', orderBy: { column: 'nome', ascending: true } }),
  ]);
  const clientes = cliRes.data || [];
  const categorias = catRes.data || [];
  const formas = formaRes.data || [];
  const mapCli = new Map(clientes.map(c => [c.id, c.nome]));
  const mapCliDoc = new Map(clientes.map(c => [c.id, c.documento || '']));
  const mapCliObs = new Map(clientes.map(c => [c.id, (c.observacao || '')]));
  const mapCat = new Map(categorias.map(c => [c.id, c.nome]));
  const mapForma = new Map(formas.map(f => [f.id, f.nome]));
  LOOKUPS = { clientes, categorias, formas, mapCli, mapCliDoc, mapCliObs, mapCat, mapForma };
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
      </div>
      <div class="form-inline" style="margin-top:12px">
        <div class="field sm"><label>Valor Esperado</label><input id="valor_esperado" value="${initial.valor_esperado||''}" /></div>
        <div class="field sm highlight"><label>Valor Recebido</label><input id="valor_recebido" value="${initial.valor_recebido||''}" /></div>
        <div class="field sm"><label>Data Emissão</label><input type="date" id="data_emissao" value="${initial.data_emissao||formatDate()}" /></div>
        <div class="field sm"><label>Data Vencimento</label><input type="date" id="data_vencimento" value="${initial.data_vencimento||formatDate()}" required/></div>
        <div class="field sm highlight"><label>Data Recebimento</label><input type="date" id="data_recebimento" value="${initial.data_recebimento||''}" /></div>
        <div class="field sm"><label>Dia do Recebimento</label><input type="number" min="1" max="31" id="dia_recebimento" value="${initial.dia_recebimento||''}" /></div>
        <div class="field sm"><label>Status</label>
          <select id="status">
            <option value="pendente" ${initial.status==='pendente'?'selected':''}>Pendente</option>
            <option value="recebido" ${initial.status==='recebido'?'selected':''}>Recebido</option>
            <option value="cancelado" ${initial.status==='cancelado'?'selected':''}>Cancelado</option>
          </select>
        </div>
        <div class="field sm"><label>Tipo</label>
          <select id="tipo_recebimento">
            <option value="mensal" ${initial.tipo_recebimento==='mensal'?'selected':''}>Mensal</option>
            <option value="avulso" ${initial.tipo_recebimento==='avulso'?'selected':''}>Avulso</option>
            <option value="parcelado" ${initial.tipo_recebimento==='parcelado'?'selected':''}>Parcelado</option>
          </select>
        </div>
        <div class="field sm"><label>Parcela Atual</label><input type="number" id="parcela_atual" value="${initial.parcela_atual||1}" /></div>
        <div class="field sm"><label>Total Parcelas</label><input type="number" id="total_parcelas" value="${initial.total_parcelas||1}" /></div>
      </div>
      <div class="form-row" style="margin-top:12px">
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
    dia_recebimento: (() => { const n = Number(getVal('dia_recebimento')); return (!n || n < 1 || n > 31) ? null : n; })(),
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
    { label: 'Gerar Parcelamento', className: 'btn btn-success', onClick: async ({ close }) => {
      const values = getRecFormValues(modal, lookups);
      const nomeCli = modal.querySelector('#cliente_nome')?.value?.trim();
      const nomeCat = modal.querySelector('#categoria_nome')?.value?.trim();
      const nomeFor = modal.querySelector('#forma_nome')?.value?.trim();
      if (nomeCli && !values.cliente_id) { showToast('Selecione um cliente válido da lista', 'error'); return; }
      if (nomeCat && !values.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (nomeFor && !values.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      // validações de parcelamento
      if (values.tipo_recebimento !== 'parcelado') { showToast('Tipo de recebimento precisa ser "parcelado" para gerar parcelas.', 'warning'); return; }
      if (!values.total_parcelas || values.total_parcelas <= 1) { showToast('Total de parcelas deve ser maior que 1 para gerar parcelamento.', 'warning'); return; }
      if (!values.parcela_atual || values.parcela_atual !== 1) { showToast('Para gerar parcelamento, informe Parcela Atual = 1.', 'warning'); return; }
      if (!values.dia_recebimento || values.dia_recebimento < 1 || values.dia_recebimento > 31) { showToast('Informe o dia de pagamento/recebimento (1-31).', 'error'); return; }
      if (!values.data_vencimento) { showToast('Informe a data de vencimento da primeira parcela.', 'error'); return; }

      // helper para obter o último dia do mês
      const daysInMonth = (y, mZeroBased) => new Date(y, mZeroBased + 1, 0).getDate();
      const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

      const base = new Date(values.data_vencimento);
      const diaPag = Number(values.dia_recebimento);

      const inserts = [];
      for (let i = 1; i <= values.total_parcelas; i++) {
        let vencDate;
        if (i === 1) {
          // primeira parcela usa a data informada
          vencDate = new Date(base.getFullYear(), base.getMonth(), base.getDate());
        } else {
          // parcelas seguintes: meses consecutivos usando o dia do pagamento
          const y = base.getFullYear();
          const m = base.getMonth() + (i - 1); // avança meses
          const dim = daysInMonth(y + Math.floor(m/12), (m % 12 + 12) % 12);
          const day = Math.min(diaPag, dim);
          vencDate = new Date(y, m, day);
        }

        inserts.push({
          descricao: values.descricao,
          cliente_id: values.cliente_id,
          categoria_id: values.categoria_id,
          forma_pagamento_id: values.forma_pagamento_id,
          valor_esperado: values.valor_esperado,
          valor_recebido: 0,
          data_emissao: values.data_emissao || formatDate(),
          data_vencimento: toISO(vencDate),
          data_recebimento: null,
          dia_recebimento: values.dia_recebimento,
          status: values.status || 'pendente',
          tipo_recebimento: 'parcelado',
          parcela_atual: i,
          total_parcelas: values.total_parcelas,
          observacoes: values.observacoes || null,
        });
      }

      const { error } = await db.insert('recebimentos', inserts);
      if (error) { showToast(error.message||'Erro ao gerar parcelamento', 'error'); return; }
      showToast(`Parcelas geradas: ${values.total_parcelas}`, 'success');
      close();
      window.location.hash = '#/recebimentos';
    }},
    { label: 'Salvar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const values = getRecFormValues(modal, lookups);
      const nomeCli = modal.querySelector('#cliente_nome')?.value?.trim();
      const nomeCat = modal.querySelector('#categoria_nome')?.value?.trim();
      const nomeFor = modal.querySelector('#forma_nome')?.value?.trim();
      if (nomeCli && !values.cliente_id) { showToast('Selecione um cliente válido da lista', 'error'); return; }
      if (nomeCat && !values.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (nomeFor && !values.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      if (values.tipo_recebimento === 'mensal' && !values.dia_recebimento) { showToast('Para tipo "mensal", informe o Dia do Recebimento.', 'error'); return; }
      // informação quando não há parcelamento
      if (values.tipo_recebimento === 'parcelado' && values.parcela_atual === 1 && values.total_parcelas === 1) {
        showToast('Parcela atual 1 de 1: crie um recebimento padrão (sem parcelamento).', 'info');
      }
      const { error } = await db.insert('recebimentos', values);
      if (error) showToast(error.message||'Erro ao salvar', 'error'); else { showToast('Recebimento criado', 'success'); close(); }
      window.location.hash = '#/recebimentos';
    }}
  ] });
}

async function openClone(row) {
  const lookups = await ensureLookups();
  const initial = {
    ...row,
    cliente_nome: lookups.mapCli.get(row.cliente_id) || '',
    categoria_nome: lookups.mapCat.get(row.categoria_id) || '',
    forma_pagamento_nome: lookups.mapForma.get(row.forma_pagamento_id) || '',
    valor_esperado: '',
    valor_recebido: '',
    data_emissao: formatDate(),
    data_vencimento: '',
    data_recebimento: '',
  };
  const { modal, close } = createModal({ title: 'Clonar Recebimento', content: recebimentoForm(initial, lookups), actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Criar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const values = getRecFormValues(modal, lookups);
      const nomeCli = modal.querySelector('#cliente_nome')?.value?.trim();
      const nomeCat = modal.querySelector('#categoria_nome')?.value?.trim();
      const nomeFor = modal.querySelector('#forma_nome')?.value?.trim();
      if (nomeCli && !values.cliente_id) { showToast('Selecione um cliente válido da lista', 'error'); return; }
      if (nomeCat && !values.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (nomeFor && !values.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      const { error } = await db.insert('recebimentos', values);
      if (error) { showToast(error.message||'Erro ao clonar', 'error'); }
      else { showToast('Recebimento clonado', 'success'); close(); window.location.hash = '#/recebimentos'; }
    } }
  ]});
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
      if (values.tipo_recebimento === 'mensal' && !values.dia_recebimento) { showToast('Para tipo "mensal", informe o Dia do Recebimento.', 'error'); return; }
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

function gerarRecibo(row, extra = {}) {
  const win = window.open('', '_blank');
  const fmtDMY = (s) => {
    if (!s) return '';
    const [y,m,d] = (s||'').slice(0,10).split('-');
    return `${d}/${m}/${y}`;
  };
  const formatDocumento = (doc) => {
    const only = (doc||'').replace(/\D+/g,'');
    if (only.length === 11) {
      return `${only.slice(0,3)}.${only.slice(3,6)}.${only.slice(6,9)}-${only.slice(9,11)}`;
    }
    if (only.length === 14) {
      return `${only.slice(0,2)}.${only.slice(2,5)}.${only.slice(5,8)}/${only.slice(8,12)}-${only.slice(12,14)}`;
    }
    return doc || '';
  };
  const clienteNome = extra.cliente_nome || row.cliente_nome || '';
  const clienteDoc = formatDocumento(extra.cliente_documento || '');
  const formaNome = extra.forma_pagamento_nome || row.forma_pagamento_nome || '';
  const valorFinal = extra.valor_recebido != null ? extra.valor_recebido : (row.valor_recebido || row.valor_esperado);
  const dataRecISO = extra.data_recebimento || row.data_recebimento || formatDate();
  const dataRec = fmtDMY(dataRecISO);
  const descRecibo = extra.descricao_recibo || '';
  const descricaoPrincipal = row.descricao || '';
  win.document.write(`
    <html>
      <head>
        <meta charset=\"utf-8\" />
        <title>Recibo</title>
        <style>
          body{font-family:Inter,Arial,'Segoe UI',sans-serif;color:#333;}
          .container{max-width:900px;margin:0 auto;padding:24px 28px;}
          .header{text-align:center;margin-bottom:18px;}
          .header h1{font-size:20px;margin:6px 0 0 0;}
          .header .company{font-weight:600;}
          .header .small{font-size:12px;color:#444;}
          .divider{height:1px;background:#e5e7eb;margin:16px 0;}
          .id{font-size:12px;color:#666;margin:6px 0 12px 0;text-align:left}
          h2{font-size:20px;color:#1f2937;margin:10px 0}
          h3{font-size:18px;color:#1f2937;margin:12px 0}
          .section{margin-top:12px}
          .block{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-top:8px}
          table{width:100%;border-collapse:collapse;margin-top:8px}
          th,td{border:1px solid #e5e7eb;padding:12px;text-align:left;vertical-align:top}
          th{background:#f3f4f6;font-weight:600}
          .right{text-align:right}
          .footer{text-align:center;margin-top:28px;color:#4b5563;font-size:12px}
          .footer .paydate{font-size:16px;color:#111;font-weight:600}
        </style>
      </head>
      <body>
        <div class=\"container\">
          <div class=\"header\">
            <div class=\"company\">CONNECT SOFT SERVIÇOS LTDA</div>
            <div class=\"small\">Rua D (Lot Centro Sul), 81 – Sala 01 Parangaba – Fortaleza – CE – Cep: 60.740-145</div>
            <div class=\"small\">CNPJ: 03.609.246/0001-53</div>
            <h1>RECIBO DE PAGAMENTO</h1>
          </div>
          <div class=\"id\"><strong>ID:</strong> ${row.id}</div>
          <div class=\"divider\"></div>

          <div class=\"section\">
            <h3>Dados do Cliente</h3>
            <div class=\"block\">
              <p><strong>${clienteNome}</strong></p>
              <p><strong>CNPJ/CPF:</strong> ${clienteDoc || '—'}</p>
            </div>
          </div>

          <div class=\"section\">
            <h3>Descrição:</h3>
            <div class=\"block\">${descricaoPrincipal || ''}</div>
          </div>

          <div class=\"section\">
            <h3>Detalhes do Pagamento</h3>
            <table>
              <thead>
                <tr>
                  <th>Observação</th>
                  <th>Forma de Pagamento</th>
                  <th class=\"right\">Valor (R$)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>${descRecibo || ''}</td>
                  <td>${formaNome || ''}</td>
                  <td class=\"right\">${formatCurrency(valorFinal)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class=\"footer\">
            <div class=\"paydate\"><strong>Data do Pagamento:</strong> ${dataRec}</div>
            <div class=\"divider\"></div>
            <div>Connect Soft Serviços Ltda | CNPJ: 03.609.246/0001-53 | +55 (85) 3055.1739 | financeiro@connectsoft.com.br</div>
          </div>
        </div>
        <script>window.print()</script>
      </body>
    </html>
  `);
  win.document.close();
}

async function openRecebido(row) {
  const lookups = await ensureLookups();
  const initial = {
    cliente_nome: lookups.mapCli.get(row.cliente_id) || '',
    descricao: row.descricao || '',
    data_vencimento: row.data_vencimento || '',
    forma_pagamento_nome: lookups.mapForma.get(row.forma_pagamento_id) || '',
    valor_esperado: row.valor_esperado || 0,
    data_recebimento: row.data_recebimento || formatDate(),
    valor_recebido: row.valor_recebido || row.valor_esperado || 0,
    observacoes: row.observacoes || ''
  };
  const content = `
    <form id=\"recbForm\">
      <div class=\"form-row\">
        <div class=\"field\"><label>Nome</label><input id=\"cliente_nome\" value=\"${initial.cliente_nome}\" disabled/></div>
        <div class=\"field\"><label>Descrição</label><input id=\"descricao\" value=\"${initial.descricao}\" disabled/></div>
        <div class=\"field\"><label>Data do Vencimento</label><input type=\"date\" id=\"data_vencimento\" value=\"${initial.data_vencimento}\" disabled/></div>
        <div class=\"field\"><label>Forma de Pagamento</label>
          <input id=\"forma_nome\" list=\"recFormaOptions\" value=\"${initial.forma_pagamento_nome}\" placeholder=\"Selecione a forma\" />
          <datalist id=\"recFormaOptions\">${(lookups.formas||[]).map(f => `<option value=\"${f.nome}\"></option>`).join('')}</datalist>
        </div>
        <div class=\"field\"><label>Valor a Receber</label><input id=\"valor_esperado\" value=\"${formatCurrency(initial.valor_esperado)}\" disabled/></div>
        <div class=\"field\"><label>Data do Recebimento</label><input type=\"date\" id=\"data_recebimento\" value=\"${initial.data_recebimento}\" /></div>
        <div class=\"field\"><label>Valor Recebido</label><input id=\"valor_recebido\" value=\"${formatCurrency(initial.valor_recebido)}\" /></div>
        <div class=\"field\" style=\"grid-column:1/-1\"><label>Descrição para o Recibo</label><textarea id=\"descricao_recibo\" rows=\"3\">${initial.observacoes}</textarea></div>
      </div>
    </form>
  `;
  const { modal, close } = createModal({ title: 'Dar baixa no recebimento', content, actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Atualizar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const formaNome = modal.querySelector('#forma_nome')?.value?.trim();
      const formaId = (lookups.formas||[]).find(f => f.nome === formaNome)?.id || null;
      if (formaNome && !formaId) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      const dataRec = modal.querySelector('#data_recebimento')?.value || formatDate();
      const valorRecStr = modal.querySelector('#valor_recebido')?.value || '0';
      const valorRec = parseCurrency(valorRecStr);
      const descRecibo = modal.querySelector('#descricao_recibo')?.value || null;
      const payload = { status: 'recebido', data_recebimento: dataRec, valor_recebido: valorRec, observacoes: descRecibo };
      if (formaId) payload.forma_pagamento_id = formaId;
      const { error } = await db.update('recebimentos', row.id, payload);
      if (error) { showToast(error.message||'Erro ao atualizar recebimento', 'error'); return; }
      showToast('Recebimento atualizado como "recebido"', 'success');
      close();
      window.location.hash = '#/recebimentos';
    }},
    { label: 'Emitir Recibo', className: 'btn btn-success', onClick: () => {
      const formaNome = modal.querySelector('#forma_nome')?.value?.trim() || (lookups.mapForma.get(row.forma_pagamento_id)||'');
      const dataRec = modal.querySelector('#data_recebimento')?.value || formatDate();
      const valorRecStr = modal.querySelector('#valor_recebido')?.value || '0';
      const valorRec = parseCurrency(valorRecStr);
      const descRecibo = modal.querySelector('#descricao_recibo')?.value || '';
      gerarRecibo(row, { cliente_nome: lookups.mapCli.get(row.cliente_id)||'', cliente_documento: lookups.mapCliDoc.get(row.cliente_id)||'', forma_pagamento_nome: formaNome, valor_recebido: valorRec, data_recebimento: dataRec, descricao_recibo: descRecibo });
    }}
  ]});
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
  const lookups = await ensureLookups();
  app.innerHTML = `
    <div class="toolbar">
      <div class="filters">
        <select id="fStatus"><option value="">Todos</option><option value="pendente">Pendente</option><option value="recebido">Recebido</option><option value="cancelado">Cancelado</option></select>
        <select id="fTipo"><option value="">Todos</option><option value="mensal">Mensal</option><option value="avulso">Avulso</option><option value="parcelado">Parcelado</option></select>
        <input type="date" id="fDe" />
        <input type="date" id="fAte" />
        <input id="fCliNome" list="fCliOptions" placeholder="Cliente (nome)" />
        <datalist id="fCliOptions">${(lookups.clientes||[]).map(c => `<option value="${c.nome}"></option>`).join('')}</datalist>
        <input id="fDescricao" placeholder="Descrição (texto)" />
        <input id="fCategoriaNome" list="fCatOptions" placeholder="Categoria (nome)" />
        <datalist id="fCatOptions">${(lookups.categorias||[]).map(c => `<option value="${c.nome}"></option>`).join('')}</datalist>
        <label style="display:inline-flex;align-items:center;gap:6px;margin-left:8px;">
          <input type="checkbox" id="fOnlyOverdue" /> Somente em atraso
        </label>
        <button id="applyFilters" class="btn btn-primary btn-prominent">🔎 Filtrar</button>
        <select id="sortField" style="margin-left:8px;">
          <option value="data_vencimento" selected>Ordenar por Data Venc.</option>
          <option value="data_recebimento">Ordenar por Data Rec.</option>
          <option value="descricao">Ordenar por Descrição</option>
          <option value="valor_esperado">Ordenar por Valor Esperado</option>
          <option value="valor_recebido">Ordenar por Valor Recebido</option>
        </select>
        <select id="sortDir" style="margin-left:8px;">
          <option value="asc" selected>Ascendente</option>
          <option value="desc">Descendente</option>
        </select>
        <select id="fCliRegime" style="margin-left:8px;">
          <option value="">Regime Tributário (todos)</option>
          <option value="simples nacional">Simples Nacional</option>
          <option value="lucro real">Lucro Real</option>
          <option value="lucro presumido">Lucro Presumido</option>
          <option value="outro">Outro</option>
        </select>
        <select id="fCliTipoEmpresa" style="margin-left:8px;">
          <option value="">Tipo de Empresa (todos)</option>
          <option value="comercio">Comércio</option>
          <option value="servico">Serviço</option>
          <option value="comercio e servico">Comércio e Serviço</option>
          <option value="industria">Indústria</option>
        </select>
      </div>
      <div>
        <div id="totalsRec" class="totals-box totals-rec">
          <div class="t-label">Recebido / A Receber</div>
          <div class="t-values">R$ 0,00 / R$ 0,00</div>
        </div>
        <button id="newRec" class="btn btn-primary">Novo</button>
        <button id="genRec" class="btn btn-success">Gerar Recebimentos</button>
        <button id="relatorio" class="btn btn-outline">Exportar CSV</button>
      </div>
    </div>
    <div class="card" id="listCard"></div>
  `;

  const filters = {};
  // Inicializa filtros de data com o período do mês atual
  try {
    const now = new Date();
    const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const lastDayDate = new Date(now.getFullYear(), now.getMonth()+1, 0);
    const lastDay = `${lastDayDate.getFullYear()}-${String(lastDayDate.getMonth()+1).padStart(2,'0')}-${String(lastDayDate.getDate()).padStart(2,'0')}`;
    const fDeEl = document.getElementById('fDe');
    const fAteEl = document.getElementById('fAte');
    if (fDeEl) fDeEl.value = firstDay;
    if (fAteEl) fAteEl.value = lastDay;
    filters.de = firstDay;
    filters.ate = lastDay;
  } catch (e) {
    // ignora falha de inicialização silenciosamente
    console.warn('Falha ao definir período padrão (Recebimentos):', e);
  }
  let currentRows = [];
  let qCli = '';
  let qCat = '';
  let qDesc = '';
  let fRegime = '';
  let fTipoEmp = '';
  const perPage = 20;
  let page = 1;
  let sortField = 'data_vencimento';
  let sortDir = 'asc';
  let loadVersion = 0;
  let lastExportRows = [];

  function ilike(hay, needle) { if (!needle) return true; return (hay || '').toString().toLowerCase().includes((needle||'').toLowerCase()); }

  async function buildMaps(rows) {
    const idsCli = Array.from(new Set(rows.map(r => r.cliente_id).filter(Boolean)));
    const idsCat = Array.from(new Set(rows.map(r => r.categoria_id).filter(Boolean)));
    const idsForma = Array.from(new Set(rows.map(r => r.forma_pagamento_id).filter(Boolean)));
    const [cliRes, catRes, formaRes] = await Promise.all([
      idsCli.length ? db.select('clientes', { select: 'id, nome, regime_tributario, tipo_empresa, observacao', in: { id: idsCli } }) : Promise.resolve({ data: [] }),
      idsCat.length ? db.select('categorias', { select: 'id, nome', in: { id: idsCat } }) : Promise.resolve({ data: [] }),
      idsForma.length ? db.select('formas_pagamento', { select: 'id, nome', in: { id: idsForma } }) : Promise.resolve({ data: [] }),
    ]);
    const cliRows = cliRes.data || [];
    const mapCli = new Map(cliRows.map(c => [c.id, c.nome]));
    const mapCliRegime = new Map(cliRows.map(c => [c.id, c.regime_tributario || '']));
    const mapCliTipo = new Map(cliRows.map(c => [c.id, c.tipo_empresa || '']));
    const mapCliObs = new Map(cliRows.map(c => [c.id, (c.observacao || '')]));
    const mapCat = new Map((catRes.data || []).map(c => [c.id, c.nome]));
    const mapForma = new Map((formaRes.data || []).map(f => [f.id, f.nome]));
    return { mapCli, mapCliRegime, mapCliTipo, mapCliObs, mapCat, mapForma };
  }

  async function load() {
    const cont = document.getElementById('listCard');
    const myVersion = ++loadVersion;
    setLoading(cont, true);
    // remove limpeza imediata para evitar race conditions
    const serverMode = !qCli && !qCat && !qDesc && !fRegime && !fTipoEmp;
    let rows = [];
    let totalPages = 1;
  
    if (serverMode) {
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;
      const opts = { select: 'id, cliente_id, categoria_id, forma_pagamento_id, descricao, valor_esperado, valor_recebido, data_emissao, data_vencimento, data_recebimento, dia_recebimento, status, tipo_recebimento, parcela_atual, total_parcelas, observacoes' };
      opts.eq = {};
      if (filters.status) opts.eq.status = filters.status;
      if (filters.tipo_recebimento) opts.eq.tipo_recebimento = filters.tipo_recebimento;
      if (filters.cliente_id) opts.eq.cliente_id = filters.cliente_id;
      if (filters.de) opts.gte = { ...(opts.gte||{}), data_vencimento: filters.de };
      if (filters.ate) opts.lte = { ...(opts.lte||{}), data_vencimento: filters.ate };
      opts.orderBy = { column: 'data_vencimento', ascending: true };
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
    const { mapCli, mapCliRegime, mapCliTipo, mapCliObs, mapCat, mapForma } = await buildMaps(rows);
  
    // checa novamente após lookups (também assíncrono)
    if (myVersion !== loadVersion) return;
  
    const enriched = rows.map(r => ({
      ...r,
      cliente_nome: mapCli.get(r.cliente_id) || '—',
      cliente_regime_tributario: mapCliRegime.get(r.cliente_id) || '',
      cliente_tipo_empresa: mapCliTipo.get(r.cliente_id) || '',
      cliente_observacao: mapCliObs.get(r.cliente_id) || '',
      categoria_nome: mapCat.get(r.categoria_id) || '—',
      forma_pagamento_nome: mapForma.get(r.forma_pagamento_id) || '—',
    }));
  
    // Helpers para atraso e rótulo de dias
    function diffDias(dateStr) {
      if (!dateStr) return null;
      const parts = (dateStr || '').split('-').map(Number);
      const [y, m, d] = parts;
      if (!y || !m || !d) return null;
      const due = new Date(y, m - 1, d); // local midnight
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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

    function diasMarkup(row) {
      if (!row.data_vencimento || row.status !== 'pendente') return '—';
      const dd = diffDias(row.data_vencimento);
      if (dd === null) return '—';
      let text = '';
      let hue = 30; // base quente
      let sat = 75;
      let light = 42;
      let highlight = false;
      if (dd < 0) {
        const overdue = Math.abs(dd);
        text = `${overdue} dias vencidos`;
        hue = Math.max(0, 15 - Math.min(15, overdue));
        sat = 85;
        light = 40;
        if (overdue >= 10) highlight = true;
      } else if (dd === 0) {
        text = 'vence hoje';
        hue = 10; sat = 85; light = 38;
        highlight = true;
      } else {
        text = `${dd} dias a vencer`;
        hue = Math.max(20, 45 - Math.min(25, dd));
        sat = 70;
        light = 42;
        if (dd > 30) highlight = true;
      }
      const style = `color: hsl(${hue}, ${sat}%, ${light}%);`;
      const cls = `days-text${highlight ? ' days-highlight' : ''}`;
      return `<span class="${cls}" style="${style}">${text}</span>`;
    }
    const baseFiltered = serverMode ? enriched : enriched.filter(r => ilike(r.cliente_nome, qCli) && ilike(r.descricao, qDesc) && ilike(r.categoria_nome, qCat));
    const regimeFiltered = baseFiltered.filter(r => !fRegime || (r.cliente_regime_tributario || '') === fRegime);
    const tipoEmpFiltered = regimeFiltered.filter(r => !fTipoEmp || (r.cliente_tipo_empresa || '') === fTipoEmp);
    const nameFiltered = tipoEmpFiltered;
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
    
    // atualiza conjunto para exportação (resultado visível)
    lastExportRows = sorted;

    // totais gerais (todas as linhas que atendem aos filtros/pesquisas)
    let totalRecebido = 0, totalAReceber = 0;
    if (serverMode) {
      // Busca todas as linhas que atendem aos filtros base (sem paginação) e aplica "Somente em atraso" no cliente
      const tOpts = { select: 'status, valor_esperado, valor_recebido' };
      tOpts.eq = {};
      if (filters.status) tOpts.eq.status = filters.status;
      if (filters.tipo_recebimento) tOpts.eq.tipo_recebimento = filters.tipo_recebimento;
      if (filters.cliente_id) tOpts.eq.cliente_id = filters.cliente_id;
      if (filters.de) tOpts.gte = { ...(tOpts.gte||{}), data_vencimento: filters.de };
      if (filters.ate) tOpts.lte = { ...(tOpts.lte||{}), data_vencimento: filters.ate };
      const { data: allForTotals } = await db.select('recebimentos', tOpts);
      const applied = (filters.onlyOverdue ? (allForTotals||[]).filter(r => isOverdue(r)) : (allForTotals||[]));
      totalRecebido = applied.reduce((acc, r) => acc + (r.status === 'recebido' ? Number(r.valor_recebido || 0) : 0), 0);
      totalAReceber = applied.reduce((acc, r) => acc + (r.status === 'pendente' ? Number(r.valor_esperado || 0) : 0), 0);
    } else {
      // Quando há filtros por nome, "filtered" já representa todas as linhas após pesquisa e atraso
      totalRecebido = filtered.reduce((acc, r) => acc + (r.status === 'recebido' ? Number(r.valor_recebido || 0) : 0), 0);
      totalAReceber = filtered.reduce((acc, r) => acc + (r.status === 'pendente' ? Number(r.valor_esperado || 0) : 0), 0);
    }
    const grandTotal = totalRecebido + totalAReceber;
    const totalsEl = document.getElementById('totalsRec');
    if (totalsEl) {
      const valuesEl = totalsEl.querySelector('.t-values');
      if (valuesEl) valuesEl.textContent = `${formatCurrency(totalRecebido)} / ${formatCurrency(totalAReceber)}`;
    }
  
    if (!serverMode) {
      totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
      if (page > totalPages) page = totalPages;
    }
  
    // só agora limpa e renderiza
    cont.innerHTML = '';
    setLoading(cont, false);
  
    renderTable(cont, {
      columns: [
        { key: 'descricao', label: 'Descrição', render: (v, r) => {
          const desc = (v ?? '').toString();
          const hint = (r.observacoes ?? '').toString();
          if (hint) {
            return `<span class="hint-hover" data-hint="${sanitizeText(hint)}">${sanitizeText(desc)} <span class="hint-icon" aria-hidden="true" title="Observação disponível">ℹ️</span></span>`;
          }
          return sanitizeText(desc);
        } },
        { key: 'cliente_nome', label: 'Cliente', render: (v, r) => {
          const nome = (v ?? '').toString();
          const hint = (r.cliente_observacao ?? LOOKUPS?.mapCliObs?.get(r.cliente_id) ?? '').toString();
          if (hint) {
            return `<span class="hint-hover" data-hint="${sanitizeText(hint)}">${sanitizeText(nome)} <span class="hint-icon" aria-hidden="true" title="Observação do cliente">ℹ️</span></span>`;
          }
          return sanitizeText(nome);
        } },
        { key: 'categoria_nome', label: 'Categoria' },
        { key: 'forma_pagamento_nome', label: 'Forma Rec.' },
        { key: 'valor_esperado', label: 'Esperado', render: v => `<strong>${formatCurrency(v)}</strong>` },
        { key: 'valor_recebido', label: 'Recebido', render: v => `${formatCurrency(v)}` },
        { key: 'data_recebimento', label: 'Rec.', render: v => formatDateBR(v) },
        { key: 'data_vencimento', label: 'Venc.', render: v => formatDateBR(v) },
        { key: 'dias_vencimento', label: 'Dias', render: (_v, r) => diasMarkup(r) },
        { key: 'status', label: 'Status', render: v => `<span class="status-pill status-${v}">${v}</span>` },
        { key: 'tipo_recebimento', label: 'Tipo' },
      ],
      rows: sorted,
      page: serverMode ? 1 : page,
      perPage,
      actions: [
        { label: '✏️ Editar', className: 'btn btn-primary btn-prominent', onClick: r => openEdit(r) },
        { label: 'Clonar', className: 'btn btn-outline', onClick: r => openClone(r) },
        { label: '🗑️', className: 'btn btn-danger', onClick: async r => { const ok = confirm(`Confirma a exclusão de \"${r.descricao}\"? Esta ação não pode ser desfeita.`); if (!ok) return; const { error } = await db.remove('recebimentos', r.id); if (error) showToast(error.message||'Erro ao excluir', 'error'); else { showToast('Recebimento excluído', 'success'); window.location.hash = '#/recebimentos'; } } },
        { label: 'Recebido', className: 'btn btn-success', onClick: r => openRecebido(r) },
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
  document.getElementById('fDescricao').addEventListener('input', (e) => { qDesc = e.target.value.trim(); page = 1; debouncedLoad(); });
  document.getElementById('fCategoriaNome').addEventListener('input', (e) => { qCat = e.target.value.trim(); page = 1; debouncedLoad(); });
  document.getElementById('sortField').addEventListener('change', (e) => { sortField = e.target.value; page = 1; load(); });
  document.getElementById('sortDir').addEventListener('change', (e) => { sortDir = e.target.value; page = 1; load(); });
  document.getElementById('fCliRegime').addEventListener('change', (e) => { fRegime = (e.target.value||'').trim(); page = 1; load(); });
  document.getElementById('fCliTipoEmpresa').addEventListener('change', (e) => { fTipoEmp = (e.target.value||'').trim(); page = 1; load(); });
  document.getElementById('newRec').addEventListener('click', openCreate);
  document.getElementById('genRec').addEventListener('click', openGenerateRecebimentos);
  document.getElementById('relatorio').addEventListener('click', () => {
    // gera CSV do resultado atual do grid
    try {
      if (!lastExportRows || !lastExportRows.length) {
        showToast('Nada para exportar no resultado atual', 'warning');
        return;
      }
      // helpers locais para coluna Dias
      function diffDiasLocal(dateStr) {
        if (!dateStr) return null;
        const parts = (dateStr || '').split('-').map(Number);
        const [y, m, d] = parts;
        if (!y || !m || !d) return null;
        const due = new Date(y, m - 1, d);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const ms = due.getTime() - today.getTime();
        return Math.round(ms / 86400000);
      }
      function diasTextLocal(row) {
        if (!row.data_vencimento || row.status !== 'pendente') return '—';
        const dd = diffDiasLocal(row.data_vencimento);
        if (dd === null) return '—';
        if (dd < 0) return `${Math.abs(dd)} dias vencidos`;
        if (dd === 0) return 'vence hoje';
        return `${dd} dias a vencer`;
      }
      const rowsOut = lastExportRows.map(r => ({
        descricao: r.descricao,
        cliente: r.cliente_nome,
        categoria: r.categoria_nome,
        forma: r.forma_pagamento_nome,
        valor_esperado: r.valor_esperado,
        valor_recebido: r.valor_recebido,
        data_recebimento: r.data_recebimento || '',
        data_vencimento: r.data_vencimento || '',
        dias: diasTextLocal(r),
        status: r.status,
        tipo: r.tipo_recebimento,
      }));
      const ts = new Date();
      const stamp = `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}-${String(ts.getDate()).padStart(2,'0')}_${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}`;
      exportToCSV(`relatorio_receitas_${stamp}.csv`, rowsOut);
      showToast('Relatório exportado (CSV) com sucesso', 'success');
    } catch (e) {
      console.error(e);
      showToast('Falha ao gerar relatório', 'error');
    }
  });
  await load();
}

function monthNamePT(m) {
  const nomes = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  return nomes[m-1] || '';
}

async function openGenerateRecebimentos() {
  const lookups = await ensureLookups();
  const now = new Date();
  const anoAtual = now.getFullYear();
  const mesAtual = now.getMonth() + 1;
  const anos = [anoAtual-1, anoAtual, anoAtual+1];
  const mesesOptions = Array.from({length:12}, (_,i)=>`<option value="${i+1}" ${i+1===mesAtual?'selected':''}>${monthNamePT(i+1)}</option>`).join('');
  const content = `
    <form id="genRecForm">
      <div id="genBusy" class="progress-info" style="display:none;"><span class="spinner"></span><span id="genBusyText">Processando...</span></div>
      <div class="form-row">
        <div class="field sm"><label>Ano Base *</label>
          <select id="ano_base">${anos.map(a=>`<option value="${a}" ${a===anoAtual?'selected':''}>${a}</option>`).join('')}</select>
        </div>
        <div class="field sm"><label>Mês Base</label>
          <select id="mes_base">${mesesOptions}</select>
        </div>
      </div>
      <div class="form-row" style="margin-top:12px">
        <div class="field sm"><label>Ano a Gerar *</label>
          <select id="ano_gerar">${anos.map(a=>`<option value="${a}" ${a===anoAtual?'selected':''}>${a}</option>`).join('')}</select>
        </div>
        <div class="field sm"><label>Mês a Gerar *</label>
          <select id="mes_gerar">${mesesOptions}</select>
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="info" style="font-size:13px; color:#374151;">
          <strong>Informação:</strong> Serão gerados apenas para clientes <strong>Ativo</strong> com recebimentos do tipo <strong>mensal</strong>. O <em>Dia do Recebimento</em> será tomado do registro-base do mês/ano selecionados (template). Se algum cliente não tiver <em>Dia do Recebimento</em> informado no registro-base, ele será ignorado e você será avisado. Todos serão criados como <strong>Pendente</strong>. Registros com status <em>cancelado</em> serão ignorados.
        </div>
      </div>
    </form>
  `;
  const { modal, close } = createModal({ title: 'Selecionar Ano para Geração Recebimentos', content, actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Gerar', className: 'btn btn-primary', onClick: async ({ close }) => {
      // indicador visual de processamento
      const showBusy = (text = 'Processando...') => {
        const info = modal.querySelector('#genBusy'); const txt = modal.querySelector('#genBusyText');
        if (info) { info.style.display = 'flex'; if (txt) txt.textContent = text; }
        setLoading(modal, true);
        modal.querySelector('footer')?.querySelectorAll('button')?.forEach(b => b.disabled = true);
      };
      const hideBusy = () => {
        const info = modal.querySelector('#genBusy'); if (info) info.style.display = 'none';
        setLoading(modal, false);
        modal.querySelector('footer')?.querySelectorAll('button')?.forEach(b => b.disabled = false);
      };
      showBusy('Preparando geração...');
      const anoBase = Number(modal.querySelector('#ano_base').value);
      const mesBase = Number(modal.querySelector('#mes_base').value);
      const anoGerar = Number(modal.querySelector('#ano_gerar').value);
      const mesGerar = Number(modal.querySelector('#mes_gerar').value);
      const mesesGerar = [mesGerar];
      if (!mesGerar || mesGerar < 1 || mesGerar > 12) { showToast('Selecione o mês a gerar.', 'warning'); hideBusy(); return; }

      // Clientes ativos
      showBusy('Carregando clientes ativos...');
      const { data: clientes } = await db.select('clientes', { select: 'id, nome, ativo' });
      const ativos = (clientes||[]).filter(c => !!c.ativo);
      const ativosIds = ativos.map(c => c.id);

      // Base: recebimentos mensais não cancelados (inclui dia_recebimento)
      showBusy('Lendo base mensal do mês/ano selecionados...');
      const { data: baseRecs } = await db.select('recebimentos', { select: 'id, cliente_id, categoria_id, forma_pagamento_id, descricao, valor_esperado, status, tipo_recebimento, data_vencimento, observacoes, dia_recebimento', eq: { tipo_recebimento: 'mensal' } });
      const baseValidos = (baseRecs||[]).filter(r => r.status !== 'cancelado' && ativosIds.includes(r.cliente_id));

      // Templates: todos os registros do mês/ano base informado (gera para cada registro)
      const templates = baseValidos.filter(r => {
        const dv = r.data_vencimento || '';
        const parts = dv.split('-').map(Number);
        const y = parts[0]; const m = parts[1];
        return y === anoBase && m === mesBase;
      });

      // Montar inserções e checar duplicidades
      const toInsert = [];
      const possibleDupes = [];
      const missingDay = [];
      for (const tpl of templates) {
        const clienteId = tpl.cliente_id;
        const catId = tpl.categoria_id; const formaId = tpl.forma_pagamento_id;
        const valor = Number(tpl.valor_esperado || 0);
        const desc = tpl.descricao || '';
        const obs = tpl.observacoes || null;
        for (const m of mesesGerar) {
          const diaFixTpl = Number(tpl.dia_recebimento || 0);
          if (!diaFixTpl || diaFixTpl < 1 || diaFixTpl > 31) { missingDay.push({ cliente_id: clienteId, month: m }); continue; }
          const dv = `${anoGerar}-${String(m).padStart(2,'0')}-${String(diaFixTpl).padStart(2,'0')}`;
          // checar duplicidade
          const { data: exists } = await db.select('recebimentos', { select: 'id', eq: { cliente_id: clienteId, categoria_id: catId, data_vencimento: dv, valor_esperado: valor } });
          if (exists && exists.length) {
            possibleDupes.push({ cliente_id: clienteId, data_vencimento: dv, valor_esperado: valor, categoria_id: catId, descricao: desc });
          }
          toInsert.push({
            descricao: desc,
            cliente_id: clienteId,
            categoria_id: catId,
            forma_pagamento_id: formaId,
            valor_esperado: valor,
            valor_recebido: 0,
            data_emissao: formatDate(),
            data_vencimento: dv,
            data_recebimento: null,
            dia_recebimento: diaFixTpl,
            status: 'pendente',
            tipo_recebimento: 'mensal',
            parcela_atual: 1,
            total_parcelas: 1,
            observacoes: obs,
          });
        }
      }

      // Antes: exibir clientes ignorados por falta de dia
      const missClientIds = Array.from(new Set(missingDay.map(m => m.cliente_id)));
      const missListHTML = missClientIds.map(id => `<li>${lookups.mapCli.get(id) || '—'}</li>`).join('') || '<li>Nenhum</li>';
      async function goNext() {
        if (possibleDupes.length) {
          const { modal: confirmModal, close: closeConfirm } = createModal({
            title: 'Possível Duplicidade',
            content: `<div class="card"><p>Encontramos ${possibleDupes.length} registro(s) que já existem com o mesmo cliente, vencimento, valor e categoria.</p><p>Deseja criar mesmo assim ou pular os duplicados?</p></div>`,
            actions: [
              { label: 'Pular duplicados', className: 'btn btn-outline', onClick: ({ close }) => { close(); closeConfirm(); proceedInsert(true); } },
              { label: 'Criar mesmo assim', className: 'btn btn-danger', onClick: ({ close }) => { close(); closeConfirm(); proceedInsert(false); } },
            ]
          });
        } else {
          await proceedInsert(true);
        }
      }

      hideBusy();
      if (missClientIds.length) {
        const { modal: missModal, close: closeMiss } = createModal({
          title: 'Clientes ignorados (sem Dia do Recebimento no template)',
          content: `<div class="card"><p>Os seguintes clientes serão ignorados na geração por não possuírem <em>Dia do Recebimento</em> informado no registro-base selecionado:</p><ul style="margin-top:8px;">${missListHTML}</ul></div>`,
          actions: [
            { label: 'Cancelar', className: 'btn btn-outline', onClick: ({ close }) => { close(); closeMiss(); } },
            { label: 'Continuar', className: 'btn btn-primary', onClick: ({ close }) => { close(); closeMiss(); goNext(); } },
          ]
        });
      } else {
        await goNext();
      }

      async function proceedInsert(skipDupes) {
        showBusy('Inserindo registros...');
        const finalInserts = skipDupes ? toInsert.filter(ins => !possibleDupes.some(d => d.cliente_id===ins.cliente_id && d.categoria_id===ins.categoria_id && d.data_vencimento===ins.data_vencimento && d.valor_esperado===ins.valor_esperado)) : toInsert;
        if (!finalInserts.length) { showToast('Nada para gerar no período escolhido', 'warning'); hideBusy(); return; }
        const { error } = await db.insert('recebimentos', finalInserts);
        if (error) { showToast(error.message||'Erro ao gerar recebimentos', 'error'); hideBusy(); return; }
        const missCount = missingDay.length;
        showToast(`Gerados ${finalInserts.length} recebimento(s). Ignorados por falta de dia: ${missCount}.`, 'success');
        hideBusy();
        close();
        window.location.hash = '#/recebimentos';
      }
    }}
  ]});

  // Sem opções de intervalo: geração usa mês/ano selecionados explicitamente
}
import { db } from '../supabaseClient.js';
import { showToast, formatCurrency, parseCurrency, formatDate, formatDateBR, setLoading, debounce, exportToCSV, sanitizeText } from '../utils.js';
import { createModal } from '../components/Modal.js';
import { renderTable } from '../components/Table.js';

// Seleção em massa (persistente durante a navegação)
const selectedPagIds = new Set();
function updateBatchButtonPag() {
  const btn = document.getElementById('baixarSelecionadosPag');
  if (!btn) return;
  const count = selectedPagIds.size;
  btn.textContent = count > 0 ? `Baixar selecionados (${count})` : 'Baixar selecionados';
  btn.disabled = count === 0;
}

async function fetchPagamentos(filters = {}) {
  const opts = { select: 'id, fornecedor_id, categoria_id, forma_pagamento_id, descricao, beneficiario, valor_esperado, valor_pago, data_emissao, data_vencimento, data_pagamento, dia_pagamento, status, tipo_pagamento, parcela_atual, total_parcelas, observacoes' };
  opts.eq = {};
  if (filters.status) opts.eq.status = filters.status;
  if (filters.categoria_id) opts.eq.categoria_id = filters.categoria_id;
  if (filters.tipo_pagamento) opts.eq.tipo_pagamento = filters.tipo_pagamento;
  const dateCol = filters.date_field || 'data_vencimento';
  if (filters.de) opts.gte = { ...(opts.gte||{}), [dateCol]: filters.de };
  if (filters.ate) opts.lte = { ...(opts.lte||{}), [dateCol]: filters.ate };
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
    db.select('fornecedores', { select: 'id, nome, documento, observacao', orderBy: { column: 'nome', ascending: true } }),
    db.select('categorias', { select: 'id, nome', orderBy: { column: 'nome', ascending: true } }),
    db.select('formas_pagamento', { select: 'id, nome', orderBy: { column: 'nome', ascending: true } }),
  ]);
  const fornecedores = forRes.data || [];
  const categorias = catRes.data || [];
  const formas = formaRes.data || [];
  const mapFor = new Map(fornecedores.map(f => [f.id, f.nome]));
  const mapForDoc = new Map(fornecedores.map(f => [f.id, (f.documento || '')]));
  const mapForObs = new Map(fornecedores.map(f => [f.id, (f.observacao || '')]));
  const mapCat = new Map(categorias.map(c => [c.id, c.nome]));
  const mapForma = new Map(formas.map(f => [f.id, f.nome]));
  LOOKUPS = { fornecedores, categorias, formas, mapFor, mapForDoc, mapForObs, mapCat, mapForma };
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
      </div>
      <div class="form-inline" style="margin-top:12px">
        <div class="field md"><label>Beneficiário</label><input id="beneficiario" value="${initial.beneficiario||''}" /></div>
        <div class="field sm"><label>Valor Esperado <span style="color:#b91c1c">(obrigatório)</span></label><input id="valor_esperado" value="${initial.valor_esperado||''}" required/></div>
        <div class="field sm highlight"><label>Valor Pago</label><input id="valor_pago" value="${initial.valor_pago||''}" /></div>
        <div class="field sm"><label>Data Emissão</label><input type="date" id="data_emissao" value="${initial.data_emissao||formatDate()}" /></div>
        <div class="field sm"><label>Data Vencimento</label><input type="date" id="data_vencimento" value="${initial.data_vencimento||formatDate()}" required/></div>
        <div class="field sm highlight"><label>Data Pagamento</label><input type="date" id="data_pagamento" value="${initial.data_pagamento||''}" /></div>
        <div class="field sm"><label>Dia do Pagamento</label><input type="number" min="1" max="31" id="dia_pagamento" value="${initial.dia_pagamento||''}" /></div>
        <div class="field sm"><label>Status</label>
          <select id="status">
            <option value="pendente" ${initial.status==='pendente'?'selected':''}>Pendente</option>
            <option value="pago" ${initial.status==='pago'?'selected':''}>Pago</option>
            <option value="cancelado" ${initial.status==='cancelado'?'selected':''}>Cancelado</option>
          </select>
        </div>
        <div class="field sm"><label>Tipo</label>
          <select id="tipo_pagamento">
            <option value="avulso" ${initial.tipo_pagamento==='avulso'?'selected':''}>Avulso</option>
            <option value="fixo" ${initial.tipo_pagamento==='fixo'?'selected':''}>Fixo</option>
            <option value="parcelado" ${initial.tipo_pagamento==='parcelado'?'selected':''}>Parcelado</option>
          </select>
        </div>
        <div class="field sm"><label>Parcela Atual</label><input type="number" id="parcela_atual" value="${initial.parcela_atual||1}" /></div>
        <div class="field sm"><label>Total Parcelas</label><input type="number" id="total_parcelas" value="${initial.total_parcelas||1}" /></div>
      </div>
      <div class="form-row" style="margin-top:12px">
        <div class="field full"><label>Observações</label><textarea id="observacoes">${initial.observacoes||''}</textarea></div>
      </div>
      <p class="muted">Você pode definir o valor esperado com base em uma porcentagem manual, se necessário.</p>
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
    dia_pagamento: (() => { const n = Number(getVal('dia_pagamento')); return (!n || n < 1 || n > 31) ? null : n; })(),
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
    { label: 'Gerar Parcelamento', className: 'btn btn-success', onClick: async ({ close }) => {
      const values = getPagFormValues(modal, lookups);
      const nomeFor = modal.querySelector('#fornecedor_nome')?.value?.trim();
      const nomeCat = modal.querySelector('#categoria_nome')?.value?.trim();
      const nomeForma = modal.querySelector('#forma_nome')?.value?.trim();
      if (nomeFor && !values.fornecedor_id) { showToast('Selecione um fornecedor válido da lista', 'error'); return; }
      if (nomeCat && !values.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (nomeForma && !values.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      // validações de parcelamento
      if (values.tipo_pagamento !== 'parcelado') { showToast('Tipo de pagamento precisa ser "parcelado" para gerar parcelas.', 'warning'); return; }
      if (!values.total_parcelas || values.total_parcelas <= 1) { showToast('Total de parcelas deve ser maior que 1 para gerar parcelamento.', 'warning'); return; }
      if (!values.parcela_atual || values.parcela_atual !== 1) { showToast('Para gerar parcelamento, informe Parcela Atual = 1.', 'warning'); return; }
      if (!values.dia_pagamento || values.dia_pagamento < 1 || values.dia_pagamento > 31) { showToast('Informe o dia do pagamento (1-31).', 'error'); return; }
      if (!values.data_vencimento) { showToast('Informe a data de vencimento da primeira parcela.', 'error'); return; }

      const addDays = (dateObj, days) => new Date(dateObj.getTime() + days*86400000);
      const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const base = new Date(values.data_vencimento);

      const inserts = [];
      for (let i = 1; i <= values.total_parcelas; i++) {
        const vencDate = (i === 1) ? new Date(base.getFullYear(), base.getMonth(), base.getDate()) : addDays(base, 30*(i-1));
        inserts.push({
          descricao: values.descricao,
          fornecedor_id: values.fornecedor_id,
          categoria_id: values.categoria_id,
          forma_pagamento_id: values.forma_pagamento_id,
          beneficiario: values.beneficiario || null,
          valor_esperado: values.valor_esperado,
          valor_pago: 0,
          data_emissao: values.data_emissao || formatDate(),
          data_vencimento: toISO(vencDate),
          data_pagamento: null,
          dia_pagamento: values.dia_pagamento,
          status: values.status || 'pendente',
          tipo_pagamento: 'parcelado',
          parcela_atual: i,
          total_parcelas: values.total_parcelas,
          observacoes: values.observacoes || null,
        });
      }

      const { error } = await db.insert('pagamentos', inserts);
      if (error) { showToast(error.message||'Erro ao gerar parcelamento', 'error'); return; }
      showToast(`Parcelas geradas: ${values.total_parcelas}`, 'success');
      close();
      window.location.hash = '#/pagamentos';
    }},
    { label: 'Salvar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const values = getPagFormValues(modal, lookups);
      // validação: valor esperado obrigatório e maior que zero
      const valEsperadoEl = modal.querySelector('#valor_esperado');
      if (!values.valor_esperado || values.valor_esperado <= 0) {
        if (valEsperadoEl) { valEsperadoEl.style.outline = '2px solid var(--danger)'; valEsperadoEl.style.background = '#fff5f5'; valEsperadoEl.focus(); }
        showToast('Informe o Valor Esperado (obrigatório).', 'error');
        return;
      } else { if (valEsperadoEl) { valEsperadoEl.style.outline = ''; valEsperadoEl.style.background = ''; } }
      // validação: fornecedor obrigatório
      const fornEl = modal.querySelector('#fornecedor_nome');
      if (!values.fornecedor_id) {
        if (fornEl) { fornEl.style.outline = '2px solid var(--danger)'; fornEl.style.background = '#fff5f5'; fornEl.focus(); }
        showToast('Selecione um Fornecedor da lista (obrigatório).', 'error');
        return;
      } else { if (fornEl) { fornEl.style.outline = ''; fornEl.style.background = ''; } }
      // validação: data de vencimento obrigatória
      const vencEl = modal.querySelector('#data_vencimento');
      if (!values.data_vencimento) {
        if (vencEl) { vencEl.style.outline = '2px solid var(--danger)'; vencEl.style.background = '#fff5f5'; vencEl.focus(); }
        showToast('Informe a Data de Vencimento (obrigatório).', 'error');
        return;
      } else { if (vencEl) { vencEl.style.outline = ''; vencEl.style.background = ''; } }
      const nomeFor = modal.querySelector('#fornecedor_nome')?.value?.trim();
      const nomeCat = modal.querySelector('#categoria_nome')?.value?.trim();
      const nomeForma = modal.querySelector('#forma_nome')?.value?.trim();
      if (nomeFor && !values.fornecedor_id) { showToast('Selecione um fornecedor válido da lista', 'error'); return; }
      if (nomeCat && !values.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (nomeForma && !values.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      // obrigatoriedade de dia para tipos fixo/mensal
      if ((values.tipo_pagamento === 'fixo' || values.tipo_pagamento === 'mensal') && !values.dia_pagamento) {
        showToast('Para tipo "fixo" ou "mensal", informe o Dia do Pagamento.', 'error');
        return;
      }
      // faixa válida do dia (1-31)
      if (values.dia_pagamento != null && (values.dia_pagamento < 1 || values.dia_pagamento > 31)) {
        showToast('Dia do Pagamento deve estar entre 1 e 31.', 'error');
        return;
      }
      if (values.tipo_pagamento === 'parcelado' && values.parcela_atual === 1 && values.total_parcelas === 1) {
        showToast('Parcela atual 1 de 1: crie um pagamento padrão (sem parcelamento).', 'info');
      }
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
      // validação: valor esperado obrigatório e maior que zero
      const valEsperadoEl = modal.querySelector('#valor_esperado');
      if (!values.valor_esperado || values.valor_esperado <= 0) {
        if (valEsperadoEl) { valEsperadoEl.style.outline = '2px solid var(--danger)'; valEsperadoEl.style.background = '#fff5f5'; valEsperadoEl.focus(); }
        showToast('Informe o Valor Esperado (obrigatório).', 'error');
        return;
      } else { if (valEsperadoEl) { valEsperadoEl.style.outline = ''; valEsperadoEl.style.background = ''; } }
      // validação: fornecedor obrigatório
      const fornEl = modal.querySelector('#fornecedor_nome');
      if (!values.fornecedor_id) {
        if (fornEl) { fornEl.style.outline = '2px solid var(--danger)'; fornEl.style.background = '#fff5f5'; fornEl.focus(); }
        showToast('Selecione um Fornecedor da lista (obrigatório).', 'error');
        return;
      } else { if (fornEl) { fornEl.style.outline = ''; fornEl.style.background = ''; } }
      // validação: data de vencimento obrigatória
      const vencEl = modal.querySelector('#data_vencimento');
      if (!values.data_vencimento) {
        if (vencEl) { vencEl.style.outline = '2px solid var(--danger)'; vencEl.style.background = '#fff5f5'; vencEl.focus(); }
        showToast('Informe a Data de Vencimento (obrigatório).', 'error');
        return;
      } else { if (vencEl) { vencEl.style.outline = ''; vencEl.style.background = ''; } }
      const nomeFor = modal.querySelector('#fornecedor_nome')?.value?.trim();
      const nomeCat = modal.querySelector('#categoria_nome')?.value?.trim();
      const nomeForma = modal.querySelector('#forma_nome')?.value?.trim();
      if (nomeFor && !values.fornecedor_id) { showToast('Selecione um fornecedor válido da lista', 'error'); return; }
      if (nomeCat && !values.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (nomeForma && !values.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      // obrigatoriedade de dia para tipos fixo/mensal
      if ((values.tipo_pagamento === 'fixo' || values.tipo_pagamento === 'mensal') && !values.dia_pagamento) {
        showToast('Para tipo "fixo" ou "mensal", informe o Dia do Pagamento.', 'error');
        return;
      }
      // faixa válida do dia (1-31)
      if (values.dia_pagamento != null && (values.dia_pagamento < 1 || values.dia_pagamento > 31)) {
        showToast('Dia do Pagamento deve estar entre 1 e 31.', 'error');
        return;
      }
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

async function openClone(row) {
  const lookups = await ensureLookups();
  const initial = {
    ...row,
    fornecedor_nome: lookups.mapFor.get(row.fornecedor_id) || '',
    categoria_nome: lookups.mapCat.get(row.categoria_id) || '',
    forma_pagamento_nome: lookups.mapForma.get(row.forma_pagamento_id) || '',
    valor_esperado: '',
    valor_pago: '',
    data_emissao: formatDate(),
    data_vencimento: '',
    data_pagamento: '',
  };
  const { modal, close } = createModal({ title: 'Clonar Pagamento', content: pagamentoForm(initial, lookups), actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Criar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const values = getPagFormValues(modal, lookups);
      const nomeFor = modal.querySelector('#fornecedor_nome')?.value?.trim();
      const nomeCat = modal.querySelector('#categoria_nome')?.value?.trim();
      const nomeForma = modal.querySelector('#forma_nome')?.value?.trim();
      if (nomeFor && !values.fornecedor_id) { showToast('Selecione um fornecedor válido da lista', 'error'); return; }
      if (nomeCat && !values.categoria_id) { showToast('Selecione uma categoria válida da lista', 'error'); return; }
      if (nomeForma && !values.forma_pagamento_id) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      const { error } = await db.insert('pagamentos', values);
      if (error) { showToast(error.message||'Erro ao clonar', 'error'); }
      else { showToast('Pagamento clonado', 'success'); close(); window.location.hash = '#/pagamentos'; }
    } }
  ]});
}

async function markPago(row) {
  const valor = row.valor_esperado;
  const { error } = await db.update('pagamentos', row.id, { status: 'pago', valor_pago: valor, data_pagamento: formatDate() });
  if (error) showToast(error.message || 'Erro ao marcar pago', 'error'); else showToast('Marcado como pago', 'success');
  window.location.hash = '#/pagamentos';
}

function gerarComprovantePagamento(row, extra = {}) {
  const lookups = LOOKUPS || {};
  const fornecedorNome = extra.fornecedor_nome || lookups.mapFor?.get?.(row.fornecedor_id) || '—';
  const fornecedorDoc = extra.fornecedor_documento || lookups.mapForDoc?.get?.(row.fornecedor_id) || '';
  const formaNome = extra.forma_pagamento_nome || lookups.mapForma?.get?.(row.forma_pagamento_id) || '—';
  const valorPago = Number(extra.valor_pago ?? row.valor_pago ?? row.valor_esperado ?? 0);
  const dataPag = extra.data_pagamento || row.data_pagamento || formatDate();
  const descricaoPrincipal = (row.descricao || '').toString();
  const descComprovante = (extra.descricao_comprovante || row.observacoes || '').toString();

  const w = window.open('', '_blank');
  if (!w) { showToast('Não foi possível abrir a janela do comprovante', 'error'); return; }
  w.document.write(`
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Comprovante</title>
        <style>
          body{font-family:Arial, sans-serif;color:#111;margin:0;padding:24px}
          .container{max-width:820px;margin:0 auto}
          .header{border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}
          .company{font-size:14px;font-weight:600}
          .small{font-size:12px;color:#4b5563}
          h1{font-size:20px;margin:12px 0}
          .id{margin:8px 0;font-size:12px;color:#374151}
          .divider{border-top:1px dashed #9ca3af;margin:10px 0}
          .section{margin:14px 0}
          .section h3{margin:0 0 6px 0;font-size:14px}
          .block{padding:8px;border:1px solid #e5e7eb;border-radius:6px}
          table{width:100%;border-collapse:collapse;margin-top:8px}
          th,td{border:1px solid #e5e7eb;padding:12px;text-align:left;vertical-align:top}
          th{background:#f3f4f6;font-weight:600}
          .right{text-align:right}
          .footer{text-align:center;margin-top:28px;color:#4b5563;font-size:12px}
          .footer .paydate{font-size:16px;color:#111;font-weight:600}
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="company">CONNECT SOFT SERVIÇOS LTDA</div>
            <div class="small">Rua D (Lot Centro Sul), 81 – Sala 01 Parangaba – Fortaleza – CE – Cep: 60.740-145</div>
            <div class="small">CNPJ: 03.609.246/0001-53</div>
            <h1>COMPROVANTE DE PAGAMENTO</h1>
          </div>
          <div class="id"><strong>ID:</strong> ${row.id}</div>
          <div class="divider"></div>

          <div class="section">
            <h3>Dados do Fornecedor</h3>
            <div class="block">
              <p><strong>${fornecedorNome}</strong></p>
              <p><strong>CNPJ/CPF:</strong> ${fornecedorDoc || '—'}</p>
            </div>
          </div>

          <div class="section">
            <h3>Descrição:</h3>
            <div class="block">${descricaoPrincipal || ''}</div>
          </div>

          <div class="section">
            <h3>Detalhes do Pagamento</h3>
            <table>
              <thead>
                <tr>
                  <th>Forma</th>
                  <th>Data</th>
                  <th class="right">Valor</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>${formaNome}</td>
                  <td>${dataPag}</td>
                  <td class="right">${formatCurrency(valorPago)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="section">
            <h3>Observações</h3>
            <div class="block">${descComprovante || ''}</div>
          </div>

          <div class="footer">
            <div class="paydate">Pagamento realizado em ${dataPag}</div>
            <div>Documento gerado automaticamente pelo sistema financeiro.</div>
          </div>
        </div>
        <script>window.print();</script>
      </body>
    </html>
  `);
  w.document.close();
}

async function openPago(row) {
  const lookups = await ensureLookups();
  const initial = {
    fornecedor_nome: lookups.mapFor.get(row.fornecedor_id) || '',
    descricao: row.descricao || '',
    data_vencimento: row.data_vencimento || '',
    forma_pagamento_nome: lookups.mapForma.get(row.forma_pagamento_id) || '',
    valor_esperado: row.valor_esperado || 0,
    data_pagamento: row.data_pagamento || formatDate(),
    valor_pago: row.valor_pago || row.valor_esperado || 0,
    observacoes: row.observacoes || ''
  };
  const content = `
    <form id="pagbForm">
      <div class="form-row">
        <div class="field"><label>Fornecedor</label><input id="fornecedor_nome" value="${initial.fornecedor_nome}" disabled/></div>
        <div class="field"><label>Descrição</label><input id="descricao" value="${initial.descricao}" disabled/></div>
        <div class="field"><label>Data do Vencimento</label><input type="date" id="data_vencimento" value="${initial.data_vencimento}" disabled/></div>
        <div class="field"><label>Forma de Pagamento</label>
          <input id="forma_nome" list="pagFormaOptions" value="${initial.forma_pagamento_nome}" placeholder="Selecione a forma" />
          <datalist id="pagFormaOptions">${(lookups.formas||[]).map(f => `<option value="${f.nome}"></option>`).join('')}</datalist>
        </div>
        <div class="field"><label>Valor a Pagar</label><input id="valor_esperado" value="${formatCurrency(initial.valor_esperado)}" disabled/></div>
        <div class="field"><label>Data do Pagamento</label><input type="date" id="data_pagamento" value="${initial.data_pagamento}" /></div>
        <div class="field"><label>Valor Pago</label><input id="valor_pago" value="${formatCurrency(initial.valor_pago)}" /></div>
        <div class="field" style="grid-column:1/-1"><label>Descrição para o Comprovante</label><textarea id="descricao_comprovante" rows="3">${initial.observacoes}</textarea></div>
      </div>
    </form>
  `;
  const { modal, close } = createModal({ title: 'Dar baixa no pagamento', content, actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Atualizar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const formaNome = modal.querySelector('#forma_nome')?.value?.trim();
      const formaId = (lookups.formas||[]).find(f => f.nome === formaNome)?.id || null;
      if (formaNome && !formaId) { showToast('Selecione uma forma de pagamento válida da lista', 'error'); return; }
      const dataPag = modal.querySelector('#data_pagamento')?.value || formatDate();
      const valorPagStr = modal.querySelector('#valor_pago')?.value || '0';
      const valorPag = parseCurrency(valorPagStr);
      const descComp = modal.querySelector('#descricao_comprovante')?.value || null;
      const payload = { status: 'pago', data_pagamento: dataPag, valor_pago: valorPag, observacoes: descComp };
      if (formaId) payload.forma_pagamento_id = formaId;
      const { error } = await db.update('pagamentos', row.id, payload);
      if (error) { showToast(error.message||'Erro ao atualizar pagamento', 'error'); return; }
      showToast('Pagamento atualizado como "pago"', 'success');
      close();
      window.location.hash = '#/pagamentos';
    }},
    { label: 'Emitir Comprovante', className: 'btn btn-success', onClick: () => {
      const formaNome = modal.querySelector('#forma_nome')?.value?.trim() || (lookups.mapForma.get(row.forma_pagamento_id)||'');
      const dataPag = modal.querySelector('#data_pagamento')?.value || formatDate();
      const valorPagStr = modal.querySelector('#valor_pago')?.value || '0';
      const valorPag = parseCurrency(valorPagStr);
      const descComp = modal.querySelector('#descricao_comprovante')?.value || '';
      gerarComprovantePagamento(row, { fornecedor_nome: lookups.mapFor.get(row.fornecedor_id)||'', fornecedor_documento: lookups.mapForDoc.get(row.fornecedor_id)||'', forma_pagamento_nome: formaNome, valor_pago: valorPag, data_pagamento: dataPag, descricao_comprovante: descComp });
    }}
  ]});
}

async function relatorioDespesas(rows) {
  const total = sum(rows.map(r => r.valor_pago || 0));
  showToast(`Despesas pagas (visíveis): ${formatCurrency(total)}`, 'info');
}

function monthNamePT(m) {
  const names = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return names[m - 1] || '';
}

async function openGeneratePagamentos() {
  const lookups = await ensureLookups();
  const now = new Date();
  const anoAtual = now.getFullYear();
  const mesAtual = now.getMonth() + 1;
  const anos = [anoAtual-1, anoAtual, anoAtual+1];
  const mesesOptions = Array.from({length:12}, (_,i)=>`<option value="${i+1}" ${i+1===mesAtual?'selected':''}>${monthNamePT(i+1)}</option>`).join('');
  const content = `
    <form id="genPagForm">
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
           <strong>Informação:</strong> Serão gerados apenas para fornecedores <strong>Ativo</strong> com pagamentos do tipo <strong>fixo</strong>. O <em>Dia do Pagamento</em> será tomado do registro-base do mês/ano selecionados (template). Se algum fornecedor não tiver <em>Dia do Pagamento</em> informado no registro-base, ele será ignorado e você será avisado. Todos serão criados como <strong>Pendente</strong>. Registros com status <em>cancelado</em> serão ignorados.
         </div>
       </div>
       <div id="genBusy" class="progress-info" style="display:none;">
         <div class="spinner"></div>
         <span>Processando...</span>
       </div>
    </form>
  `;
  
  const { modal, close } = createModal({ title: 'Selecionar Ano para Geração Pagamentos', content, actions: [
    { label: 'Cancelar', className: 'btn btn-outline', onClick: () => close() },
    { label: 'Gerar', className: 'btn btn-primary', onClick: async ({ close }) => {
      const anoBase = Number(modal.querySelector('#ano_base').value);
      const mesBase = Number(modal.querySelector('#mes_base').value);
      const anoGerar = Number(modal.querySelector('#ano_gerar').value);
      const mesGerar = Number(modal.querySelector('#mes_gerar').value);
      
      if (!mesGerar || mesGerar < 1 || mesGerar > 12) { 
        showToast('Selecione o mês a gerar.', 'warning'); 
        return; 
      }

      const showBusy = (text = 'Processando...') => {
        const busyEl = modal.querySelector('#genBusy');
        const textEl = busyEl.querySelector('span');
        if (textEl) textEl.textContent = text;
        busyEl.style.display = 'flex';
        setLoading(modal, true);
        modal.querySelectorAll('.modal-actions button').forEach(btn => btn.disabled = true);
      };
      
      const hideBusy = () => {
        const busyEl = modal.querySelector('#genBusy');
        busyEl.style.display = 'none';
        setLoading(modal, false);
        modal.querySelectorAll('.modal-actions button').forEach(btn => btn.disabled = false);
      };

      try {
        showBusy('Preparando geração...');

        // Fornecedores ativos
        showBusy('Carregando fornecedores ativos...');
        const { data: fornecedores } = await db.select('fornecedores', { select: 'id, nome, ativo' });
        const ativos = (fornecedores||[]).filter(f => !!f.ativo);
        const ativosIds = ativos.map(f => f.id);

        // Base: pagamentos mensais não cancelados (inclui dia_pagamento)
        showBusy('Carregando base mensal...');
         const { data: basePags } = await db.select('pagamentos', { 
           select: 'id, fornecedor_id, categoria_id, forma_pagamento_id, descricao, valor_esperado, status, tipo_pagamento, data_vencimento, observacoes, dia_pagamento' 
         });
         const baseValidos = (basePags||[]).filter(p => p.status !== 'cancelado' && ativosIds.includes(p.fornecedor_id) && p.tipo_pagamento === 'fixo');

        // Templates: todos os registros do mês/ano base informado (gera para cada registro)
        const templates = baseValidos.filter(p => {
          const dv = p.data_vencimento || '';
          const parts = dv.split('-').map(Number);
          const y = parts[0]; const m = parts[1];
          return y === anoBase && m === mesBase;
        });

        // Montar inserções e checar duplicidades
        showBusy('Processando templates...');
        const toInsert = [];
        const possibleDupes = [];
        const missingDay = [];
        
        for (const tpl of templates) {
          const fornecedorId = tpl.fornecedor_id;
          const catId = tpl.categoria_id; 
          const formaId = tpl.forma_pagamento_id;
          const valor = Number(tpl.valor_esperado || 0);
          const desc = tpl.descricao || '';
          const obs = tpl.observacoes || null;
          const diaPag = tpl.dia_pagamento;
          
          if (!diaPag || diaPag < 1 || diaPag > 31) {
            const fornecedor = ativos.find(f => f.id === fornecedorId);
            missingDay.push(fornecedor?.nome || `ID ${fornecedorId}`);
            continue;
          }
          
          const dataVenc = `${anoGerar}-${String(mesGerar).padStart(2,'0')}-${String(diaPag).padStart(2,'0')}`;
          
          // Verificar duplicidade
          const { data: existing } = await db.select('pagamentos', {
            select: 'id',
            eq: { fornecedor_id: fornecedorId, data_vencimento: dataVenc, status: 'pendente' }
          });
          
          if (existing && existing.length > 0) {
            const fornecedor = ativos.find(f => f.id === fornecedorId);
            possibleDupes.push(`${fornecedor?.nome || `ID ${fornecedorId}`} (${diaPag}/${mesGerar})`);
            continue;
          }
          
           toInsert.push({
             fornecedor_id: fornecedorId,
             categoria_id: catId,
             forma_pagamento_id: formaId,
             descricao: desc,
             valor_esperado: valor,
             valor_pago: 0,
             data_emissao: formatDate(),
             data_vencimento: dataVenc,
             data_pagamento: null,
             dia_pagamento: diaPag,
             status: 'pendente',
             tipo_pagamento: 'fixo',
             parcela_atual: 1,
             total_parcelas: 1,
             observacoes: obs,
           });
        }

        hideBusy();

        if (missingDay.length > 0) {
          const lista = missingDay.slice(0, 10).join(', ') + (missingDay.length > 10 ? ` e mais ${missingDay.length - 10}` : '');
          showToast(`Fornecedores ignorados (sem dia do pagamento): ${lista}`, 'warning');
        }
        
        if (possibleDupes.length > 0) {
          const lista = possibleDupes.slice(0, 5).join(', ') + (possibleDupes.length > 5 ? ` e mais ${possibleDupes.length - 5}` : '');
          showToast(`Possíveis duplicatas ignoradas: ${lista}`, 'info');
        }
        
        if (toInsert.length === 0) {
          showToast('Nenhum pagamento foi gerado.', 'info');
          return;
        }

        showBusy('Inserindo pagamentos...');
        const { error } = await db.insert('pagamentos', toInsert);
        hideBusy();
        
        if (error) {
          showToast(error.message || 'Erro ao gerar pagamentos', 'error');
          return;
        }
        
        showToast(`${toInsert.length} pagamento(s) gerado(s) com sucesso!`, 'success');
        close();
        window.location.hash = '#/pagamentos';
        
      } catch (err) {
        hideBusy();
        console.error('Erro na geração:', err);
        showToast('Erro inesperado na geração de pagamentos', 'error');
      }
    }}
  ] });
}

export async function renderPagamentos(app) {
  const lookups = await ensureLookups();
  app.innerHTML = `
    <div class="toolbar" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <details class="filters-panel" id="filtersPanel" style="flex:1;" open>
        <summary class="btn btn-outline" style="cursor:pointer;">Mostrar filtros</summary>
        <div class="filters" style="display:grid;grid-template-columns:repeat(3, minmax(220px, 1fr));gap:10px;padding:10px 0;">
          <fieldset style="border:1px solid #e5e7eb;border-radius:6px;padding:8px;">
            <legend style="font-size:12px;color:#374151;">Status e Tipo</legend>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <select id="fStatus"><option value="">Todos</option><option value="pendente">Pendente</option><option value="pago">Pago</option><option value="cancelado">Cancelado</option></select>
              <select id="fTipo"><option value="">Todos</option><option value="fixo">Fixo</option><option value="avulso">Avulso</option><option value="parcelado">Parcelado</option></select>
            </div>
          </fieldset>

          <fieldset style="border:1px solid #e5e7eb;border-radius:6px;padding:8px;">
            <legend style="font-size:12px;color:#374151;">Período</legend>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <input type="date" id="fDe" />
              <input type="date" id="fAte" />
              <label style="display:inline-flex;align-items:center;gap:6px;">
                <span>Campo de data</span>
                <select id="fDateField">
                  <option value="data_vencimento" selected>Por Vencimento</option>
                  <option value="data_pagamento">Por Pagamento</option>
                </select>
              </label>
              <label style="display:inline-flex;align-items:center;gap:6px;margin-left:8px;">
                <input type="checkbox" id="fOnlyOverdue" /> Somente em atraso
              </label>
            </div>
          </fieldset>

          <fieldset style="border:1px solid #e5e7eb;border-radius:6px;padding:8px;">
            <legend style="font-size:12px;color:#374151;">Pesquisa</legend>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <input id="fForNome" list="fForOptions" placeholder="Fornecedor (nome)" />
              <datalist id="fForOptions">${(lookups.fornecedores||[]).map(f => `<option value="${f.nome}"></option>`).join('')}</datalist>
              <input id="fDescricao" placeholder="Descrição (texto)" />
              <input id="fCategoriaNome" list="fCatOptions" placeholder="Categoria (nome)" />
              <datalist id="fCatOptions">${(lookups.categorias||[]).map(c => `<option value="${c.nome}"></option>`).join('')}</datalist>
              <input id="fFormaNome" list="fFormaOptions" placeholder="Forma de pagamento (nome)" />
              <datalist id="fFormaOptions">${(lookups.formas||[]).map(f => `<option value="${f.nome}"></option>`).join('')}</datalist>
            </div>
          </fieldset>

          <fieldset style="border:1px solid #e5e7eb;border-radius:6px;padding:8px;">
            <legend style="font-size:12px;color:#374151;">Ordenação</legend>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <select id="sortField">
                <option value="data_vencimento" selected>Ordenar por Data Venc.</option>
                <option value="data_pagamento">Ordenar por Data Pag.</option>
                <option value="descricao">Ordenar por Descrição</option>
                <option value="valor_esperado">Ordenar por Valor Esperado</option>
                <option value="valor_pago">Ordenar por Valor Pago</option>
                <option value="fornecedor_nome">Ordenar por Fornecedor</option>
                <option value="categoria_nome">Ordenar por Categoria</option>
                <option value="forma_pagamento_nome">Ordenar por Forma</option>
              </select>
              <select id="sortDir">
                <option value="asc" selected>Ascendente</option>
                <option value="desc">Descendente</option>
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
        <div id="totalsPag" class="totals-box totals-pag">
          <div class="t-label">Pago / A Pagar</div>
          <div class="t-values">R$ 0,00 / R$ 0,00</div>
        </div>
        <button id="newPay" class="btn btn-primary">Novo</button>
        <button id="gerarPagamentos" class="btn btn-success">Gerar Pagamentos</button>
        <button id="baixarSelecionadosPag" class="btn btn-success" disabled>Baixar selecionados</button>
        <button id="relatorioDespesas" class="btn btn-outline">Relatório de despesas</button>
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
    const fDateFieldEl = document.getElementById('fDateField');
    if (fDeEl) fDeEl.value = firstDay;
    if (fAteEl) fAteEl.value = lastDay;
    if (fDateFieldEl) fDateFieldEl.value = 'data_vencimento';
    filters.de = firstDay;
    filters.ate = lastDay;
    filters.date_field = 'data_vencimento';
  } catch (e) {
    // ignora falha de inicialização silenciosamente
    console.warn('Falha ao definir período padrão (Pagamentos):', e);
  }
  let currentRows = [];
  let qFor = '';
  let qCat = '';
  let qForma = '';
  let qDesc = '';
  const perPage = 20;
  let page = 1;
  let sortField = 'data_vencimento';
  let sortDir = 'asc';
  let loadVersion = 0;
  let lastExportRows = [];

  function ilike(hay, needle) { if (!needle) return true; return (hay || '').toString().toLowerCase().includes((needle||'').toLowerCase()); }

  async function buildMaps(rows) {
    const idsFor = Array.from(new Set(rows.map(r => r.fornecedor_id).filter(Boolean)));
    const idsCat = Array.from(new Set(rows.map(r => r.categoria_id).filter(Boolean)));
    const idsForma = Array.from(new Set(rows.map(r => r.forma_pagamento_id).filter(Boolean)));
    const [forRes, catRes, formaRes] = await Promise.all([
      idsFor.length ? db.select('fornecedores', { select: 'id, nome, observacao', in: { id: idsFor } }) : Promise.resolve({ data: [] }),
      idsCat.length ? db.select('categorias', { select: 'id, nome', in: { id: idsCat } }) : Promise.resolve({ data: [] }),
      idsForma.length ? db.select('formas_pagamento', { select: 'id, nome', in: { id: idsForma } }) : Promise.resolve({ data: [] }),
    ]);
    const forRows = forRes.data || [];
    const mapFor = new Map(forRows.map(f => [f.id, f.nome]));
    const mapForObs = new Map(forRows.map(f => [f.id, (f.observacao || '')]));
    const mapCat = new Map((catRes.data || []).map(c => [c.id, c.nome]));
    const mapForma = new Map((formaRes.data || []).map(f => [f.id, f.nome]));
    return { mapFor, mapForObs, mapCat, mapForma };
  }

  async function load() {
    const cont = document.getElementById('listCard');
    const myVersion = ++loadVersion;
    setLoading(cont, true);
    const serverMode = !qFor && !qCat && !qForma && !qDesc;
    let rows = [];
    let totalPages = 1;

    if (serverMode) {
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;
      const opts = { select: 'id, fornecedor_id, categoria_id, forma_pagamento_id, descricao, valor_esperado, valor_pago, data_emissao, data_vencimento, data_pagamento, dia_pagamento, status, tipo_pagamento, parcela_atual, total_parcelas, observacoes' };
      opts.eq = {};
      if (filters.status) opts.eq.status = filters.status;
      if (filters.tipo_pagamento) opts.eq.tipo_pagamento = filters.tipo_pagamento;
      if (filters.fornecedor_id) opts.eq.fornecedor_id = filters.fornecedor_id;
      const dateColServer = filters.date_field || 'data_vencimento';
      if (filters.de) opts.gte = { ...(opts.gte||{}), [dateColServer]: filters.de };
      if (filters.ate) opts.lte = { ...(opts.lte||{}), [dateColServer]: filters.ate };
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
    const { mapFor, mapForObs, mapCat, mapForma } = await buildMaps(rows);

    if (myVersion !== loadVersion) return;

    const enriched = rows.map(r => ({
      ...r,
      fornecedor_nome: mapFor.get(r.fornecedor_id) || '—',
      fornecedor_observacao: mapForObs.get(r.fornecedor_id) || '',
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
      // retorna span com estilo de cor dinâmico conforme regra
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
        // quanto mais vencido, mais próximo do vermelho (0)
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
        // quanto mais distante, mais quente (amarelo -> laranja)
        hue = Math.max(20, 45 - Math.min(25, dd));
        sat = 70;
        light = 42;
        if (dd > 30) highlight = true;
      }
      const style = `color: hsl(${hue}, ${sat}%, ${light}%);`;
      const cls = `days-text${highlight ? ' days-highlight' : ''}`;
      return `<span class="${cls}" style="${style}">${text}</span>`;
    }
    const nameFiltered = serverMode ? enriched : enriched.filter(r => ilike(r.fornecedor_nome, qFor) && ilike(r.categoria_nome, qCat) && ilike(r.forma_pagamento_nome, qForma) && ilike(r.descricao, qDesc));
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

    lastExportRows = sorted;

    // totais gerais (todas as linhas que atendem aos filtros/pesquisas)
    let totalPago = 0, totalAPagar = 0;
    let countPago = 0, countAPagar = 0;
    if (serverMode) {
      // Busca todas as linhas que atendem aos filtros base (sem paginação) e aplica "Somente em atraso" no cliente
      const tOpts = { select: 'status, valor_esperado, valor_pago' };
      tOpts.eq = {};
      if (filters.status) tOpts.eq.status = filters.status;
      if (filters.tipo_pagamento) tOpts.eq.tipo_pagamento = filters.tipo_pagamento;
      if (filters.fornecedor_id) tOpts.eq.fornecedor_id = filters.fornecedor_id;
      const dateColTotals = filters.date_field || 'data_vencimento';
      if (filters.de) tOpts.gte = { ...(tOpts.gte||{}), [dateColTotals]: filters.de };
      if (filters.ate) tOpts.lte = { ...(tOpts.lte||{}), [dateColTotals]: filters.ate };
      const { data: allForTotals } = await db.select('pagamentos', tOpts);
      const applied = (filters.onlyOverdue ? (allForTotals||[]).filter(r => isOverdue(r)) : (allForTotals||[]));
      totalPago = applied.reduce((acc, r) => acc + (r.status === 'pago' ? Number(r.valor_pago || 0) : 0), 0);
      totalAPagar = applied.reduce((acc, r) => acc + (r.status === 'pendente' ? Number(r.valor_esperado || 0) : 0), 0);
      countPago = applied.filter(r => r.status === 'pago').length;
      countAPagar = applied.filter(r => r.status === 'pendente').length;
    } else {
      // Quando há filtros por nome, "filtered" já representa todas as linhas após pesquisa e atraso
      totalPago = filtered.reduce((acc, r) => acc + (r.status === 'pago' ? Number(r.valor_pago || 0) : 0), 0);
      totalAPagar = filtered.reduce((acc, r) => acc + (r.status === 'pendente' ? Number(r.valor_esperado || 0) : 0), 0);
      countPago = filtered.filter(r => r.status === 'pago').length;
      countAPagar = filtered.filter(r => r.status === 'pendente').length;
    }
    const totalsEl = document.getElementById('totalsPag');
    if (totalsEl) {
      const valuesEl = totalsEl.querySelector('.t-values');
      if (valuesEl) valuesEl.textContent = `${formatCurrency(totalPago)} / ${formatCurrency(totalAPagar)}`;
      const labelEl = totalsEl.querySelector('.t-label');
      if (labelEl) labelEl.textContent = `Pago (${countPago}) / A Pagar (${countAPagar})`;
    }

    if (!serverMode) {
      totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
      if (page > totalPages) page = totalPages;
    }

    cont.innerHTML = '';
    setLoading(cont, false);

    renderTable(cont, {
      columns: [
        { key: 'id', label: '', headerRender: () => `<input type="checkbox" class="select-all select-all-pag" title="Marcar todos visíveis" />`, render: (_v, r) => `<input type="checkbox" class="row-select row-select-pag" data-id="${r.id}" ${selectedPagIds.has(String(r.id))?'checked':''} />` },
        { key: 'descricao', label: 'Descrição', render: (v, r) => {
          const desc = (v ?? '').toString();
          const hint = (r.observacoes ?? '').toString();
          if (hint) {
            return `<span class="hint-hover" data-hint="${sanitizeText(hint)}">${sanitizeText(desc)} <span class="hint-icon" aria-hidden="true" title="Observação disponível">ℹ️</span></span>`;
          }
          return sanitizeText(desc);
        } },
        { key: 'fornecedor_nome', label: 'Fornecedor', render: (v, r) => {
          const nome = (v ?? '').toString();
          const hint = (r.fornecedor_observacao ?? LOOKUPS?.mapForObs?.get(r.fornecedor_id) ?? '').toString();
          if (hint) {
            return `<span class="hint-hover" data-hint="${sanitizeText(hint)}">${sanitizeText(nome)} <span class="hint-icon" aria-hidden="true" title="Observação do fornecedor">ℹ️</span></span>`;
          }
          return sanitizeText(nome);
        } },
        { key: 'categoria_nome', label: 'Categoria' },
        { key: 'forma_pagamento_nome', label: 'Forma Pag.' },
        { key: 'valor_esperado', label: 'Esperado', render: v => `<strong>${formatCurrency(v)}</strong>` },
        { key: 'valor_pago', label: 'Pago', render: v => `${formatCurrency(v)}` },
        { key: 'data_pagamento', label: 'Pag.', render: v => formatDateBR(v) },
        { key: 'data_vencimento', label: 'Venc.', render: v => formatDateBR(v) },
        { key: 'dias_vencimento', label: 'Dias', render: (_v, r) => diasMarkup(r) },
        { key: 'status', label: 'Status', render: v => `<span class="status-pill status-${v}">${v}</span>` },
        { key: 'tipo_pagamento', label: 'Tipo' },
      ],
      rows: sorted,
      page: serverMode ? 1 : page,
      perPage,
      actions: [
        { label: '✏️ Editar', className: 'btn btn-primary btn-prominent', onClick: r => openEdit(r) },
        { label: 'Clonar', className: 'btn btn-outline', onClick: r => openClone(r) },
        { label: 'Excluir', className: 'btn btn-danger', onClick: async r => { const ok = confirm(`Confirma a exclusão de "${r.descricao}"? Esta ação não pode ser desfeita.`); if (!ok) return; const { error } = await db.remove('pagamentos', r.id); if (error) showToast(error.message||'Erro ao excluir','error'); else { showToast('Excluído','success'); load(); } } },
        { label: 'Pago', className: 'btn btn-success', onClick: r => openPago(r) },
      ],
    });

    // Wiring dos checkboxes de seleção
    cont.querySelectorAll('.row-select-pag').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.id || cb.getAttribute('data-id') || '';
        if (!id) return;
        const key = String(id);
        if (cb.checked) selectedPagIds.add(key); else selectedPagIds.delete(key);
        updateBatchButtonPag();
        updateHeaderSelectAllPag();
      });
    });
    updateBatchButtonPag();

    function updateHeaderSelectAllPag() {
      const headerCb = cont.querySelector('.select-all-pag');
      if (!headerCb) return;
      const vis = Array.from(cont.querySelectorAll('.row-select-pag'));
      const total = vis.length;
      const checked = vis.filter(c => c.checked).length;
      headerCb.indeterminate = checked > 0 && checked < total;
      headerCb.checked = total > 0 && checked === total;
    }
    updateHeaderSelectAllPag();

    const headerCb = cont.querySelector('.select-all-pag');
    headerCb?.addEventListener('change', () => {
      const vis = Array.from(cont.querySelectorAll('.row-select-pag'));
      vis.forEach(cb => {
        cb.checked = headerCb.checked;
        const id = cb.dataset.id || cb.getAttribute('data-id') || '';
        const key = String(id);
        if (headerCb.checked) selectedPagIds.add(key); else selectedPagIds.delete(key);
      });
      updateBatchButtonPag();
      updateHeaderSelectAllPag();
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
    filters.date_field = document.getElementById('fDateField').value || 'data_vencimento';
    filters.onlyOverdue = document.getElementById('fOnlyOverdue').checked || undefined;
    page = 1;
    load();
  });
  const clearBtnPag = document.getElementById('clearFilters');
  if (clearBtnPag) clearBtnPag.addEventListener('click', () => {
    // período padrão (mês atual)
    const now = new Date();
    const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const lastDayDate = new Date(now.getFullYear(), now.getMonth()+1, 0);
    const lastDay = `${lastDayDate.getFullYear()}-${String(lastDayDate.getMonth()+1).padStart(2,'0')}-${String(lastDayDate.getDate()).padStart(2,'0')}`;

    // reset campos
    document.getElementById('fStatus').value = '';
    document.getElementById('fTipo').value = '';
    document.getElementById('fDe').value = firstDay;
    document.getElementById('fAte').value = lastDay;
    document.getElementById('fDateField').value = 'data_vencimento';
    document.getElementById('fOnlyOverdue').checked = false;
    document.getElementById('fForNome').value = '';
    document.getElementById('fDescricao').value = '';
    document.getElementById('fCategoriaNome').value = '';
    document.getElementById('fFormaNome').value = '';
    document.getElementById('sortField').value = 'data_vencimento';
    document.getElementById('sortDir').value = 'asc';

    // reset variáveis de busca e ordenação
    qFor = '';
    qDesc = '';
    qCat = '';
    qForma = '';
    sortField = 'data_vencimento';
    sortDir = 'asc';

    // reset filtros
    filters.status = undefined;
    filters.tipo_pagamento = undefined;
    filters.de = firstDay;
    filters.ate = lastDay;
    filters.date_field = 'data_vencimento';
    filters.onlyOverdue = undefined;
    page = 1;
    load();
  });

  // Baixa em massa (Pagamentos)
  const btnBatchPag = document.getElementById('baixarSelecionadosPag');
  if (btnBatchPag) {
    btnBatchPag.addEventListener('click', async () => {
      const today = formatDate();
      const { modal, close } = createModal({
        title: 'Baixar pagamentos selecionados',
        content: `<div class="card">
          <p>Informe a data de pagamento que será aplicada a todos os selecionados.</p>
          <label style="display:flex;gap:8px;align-items:center;">
            <span>Data do pagamento</span>
            <input type="date" id="dtBatchPag" value="${today}" />
          </label>
          <div class="muted" style="margin-top:8px;">O valor pago será igual ao valor a pagar (esperado).</div>
        </div>`,
        actions: [
          { label: 'Cancelar', className: 'btn btn-outline', onClick: ({ close }) => close() },
          { label: 'Baixar', className: 'btn btn-success', onClick: async ({ close }) => {
            const dt = modal.querySelector('#dtBatchPag')?.value || today;
            const ids = Array.from(selectedPagIds);
            if (!ids.length) { showToast('Nenhum item selecionado', 'warning'); return; }
            try {
              const updates = ids.map(async id => {
                const idStr = String(id);
                let row = currentRows.find(r => String(r.id) === idStr);
                if (!row) {
                  const { data } = await db.select('pagamentos', { select: 'id, valor_esperado', eq: { id: idStr } });
                  row = (data||[])[0];
                }
                const valor = Number(row?.valor_esperado || 0);
                return db.update('pagamentos', idStr, { status: 'pago', valor_pago: valor, data_pagamento: dt });
              });
              const results = await Promise.all(updates);
              const errors = results.filter(r => r?.error);
              if (errors.length) {
                showToast(`Alguns itens falharam (${errors.length}).`, 'error');
              } else {
                showToast(`Baixa concluída para ${ids.length} pagamento(s).`, 'success');
              }
              selectedPagIds.clear();
              updateBatchButtonPag();
              load();
            } catch (e) {
              console.error(e);
              showToast('Erro na baixa em massa', 'error');
            } finally {
              close();
            }
          } },
        ],
      });
    });
  }
    document.getElementById('fForNome').addEventListener('input', (e) => { qFor = e.target.value.trim(); page = 1; debouncedLoad(); });
  document.getElementById('fDescricao').addEventListener('input', (e) => { qDesc = e.target.value.trim(); page = 1; debouncedLoad(); });
  document.getElementById('fCategoriaNome').addEventListener('input', (e) => { qCat = e.target.value.trim(); page = 1; debouncedLoad(); });
  document.getElementById('fFormaNome').addEventListener('input', (e) => { qForma = e.target.value.trim(); page = 1; debouncedLoad(); });
  document.getElementById('sortField').addEventListener('change', (e) => { sortField = e.target.value; page = 1; load(); });
  document.getElementById('sortDir').addEventListener('change', (e) => { sortDir = e.target.value; page = 1; load(); });
  document.getElementById('newPay').addEventListener('click', openCreate);
  document.getElementById('gerarPagamentos').addEventListener('click', openGeneratePagamentos);
  document.getElementById('relatorioDespesas').addEventListener('click', () => {
    try {
      if (!lastExportRows || !lastExportRows.length) {
        showToast('Nada para exportar no resultado atual', 'warning');
        return;
      }
      function diffDiasLocal(dateStr) {
        if (!dateStr) return null;
        const parts = (dateStr || '').split('-').map(Number);
        const [y, m, d] = parts; if (!y || !m || !d) return null;
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
        fornecedor: r.fornecedor_nome,
        categoria: r.categoria_nome,
        forma: r.forma_pagamento_nome,
        valor_esperado: r.valor_esperado,
        valor_pago: r.valor_pago,
        data_pagamento: r.data_pagamento || '',
        data_vencimento: r.data_vencimento || '',
        dias: diasTextLocal(r),
        status: r.status,
        tipo: r.tipo_pagamento,
      }));
      const ts = new Date();
      const stamp = `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}-${String(ts.getDate()).padStart(2,'0')}_${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}`;
      exportToCSV(`relatorio_despesas_${stamp}.csv`, rowsOut);
      showToast('Relatório de despesas exportado (CSV) com sucesso', 'success');
    } catch (e) {
      console.error(e);
      showToast('Falha ao gerar relatório de despesas', 'error');
    }
  });
  await load();
}

;
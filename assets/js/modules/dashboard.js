import { db } from '../supabaseClient.js';
import { formatCurrency, sum } from '../utils.js';
import { renderLineChart, renderPieChart, renderBarChart, renderAreaChart } from '../components/Charts.js';

// Totais do dia
async function getTotalReceberHoje() {
  const today = new Date().toISOString().slice(0,10);
  const { data, error } = await db.select('recebimentos', { eq: { data_vencimento: today, status: 'pendente' }, select: 'valor_esperado' });
  if (error) return 0;
  return sum((data || []).map(r => r.valor_esperado || 0));
}

async function getTotalPagarHoje() {
  const today = new Date().toISOString().slice(0,10);
  const { data, error } = await db.select('pagamentos', { eq: { data_vencimento: today, status: 'pendente' }, select: 'valor_esperado' });
  if (error) return 0;
  return sum((data || []).map(p => p.valor_esperado || 0));
}

async function getMRR() {
  const now = new Date(); const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, '0');
  const start = `${y}-${m}-01`;
  const end = `${y}-${m}-31`;
  const rec = await db.select('recebimentos', { eq: { tipo_recebimento: 'mensal' }, gte: { data_vencimento: start }, lte: { data_vencimento: end }, select: 'valor_esperado' });
  return sum((rec.data || []).map(r => r.valor_esperado));
}

async function getPendencias30d() {
  const now = new Date(); const in30 = new Date(now.getTime() + 30 * 86400000);
  const start = now.toISOString().slice(0,10); const end = in30.toISOString().slice(0,10);
  const rec = await db.select('recebimentos', { eq: { status: 'pendente' }, gte: { data_vencimento: start }, lte: { data_vencimento: end }, select: 'valor_esperado, descricao, data_vencimento' });
  const pag = await db.select('pagamentos', { eq: { status: 'pendente' }, gte: { data_vencimento: start }, lte: { data_vencimento: end }, select: 'valor_esperado, descricao, data_vencimento' });
  return { recPend: rec.data || [], pagPend: pag.data || [] };
}

async function getFluxoCaixaMensal() {
  // Últimos 6 meses: soma de recebidos e pagos por mês
  const rec = await db.select('recebimentos', { select: 'valor_recebido, data_recebimento, status' });
  const pag = await db.select('pagamentos', { select: 'valor_pago, data_pagamento, status' });
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${String(d.getMonth() + 1).padStart(2,'0')}/${d.getFullYear()}`);
  }
  const entradas = months.map(m => {
    const [mm, yy] = m.split('/');
    return sum((rec.data || []).filter(r => r.status === 'recebido' && (r.data_recebimento || '').startsWith(`${yy}-${mm}`)).map(r => r.valor_recebido));
  });
  const saidas = months.map(m => {
    const [mm, yy] = m.split('/');
    return sum((pag.data || []).filter(p => p.status === 'pago' && (p.data_pagamento || '').startsWith(`${yy}-${mm}`)).map(p => p.valor_pago));
  });
  return { months, entradas, saidas };
}

async function getTopClientes() {
  const rec = await db.select('recebimentos', { select: 'cliente_id, valor_recebido, status' });
  const byClient = new Map();
  (rec.data || []).filter(r => r.status === 'recebido').forEach(r => {
    byClient.set(r.cliente_id, (byClient.get(r.cliente_id) || 0) + Number(r.valor_recebido || 0));
  });
  const top = Array.from(byClient.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5);
  // Buscar nomes dos clientes
  const ids = top.map(([id]) => id).filter(Boolean);
  const cli = ids.length ? await db.select('clientes', { select: 'id, nome' }) : { data: [] };
  const nameById = new Map((cli.data || []).map(c => [c.id, c.nome]));
  return top.map(([id, val]) => ({ nome: nameById.get(id) || '—', total: val }));
}

async function getTopFornecedores() {
  const pag = await db.select('pagamentos', { select: 'fornecedor_id, valor_pago, status' });
  const byForn = new Map();
  (pag.data || []).filter(p => p.status === 'pago').forEach(p => {
    byForn.set(p.fornecedor_id, (byForn.get(p.fornecedor_id) || 0) + Number(p.valor_pago || 0));
  });
  const top = Array.from(byForn.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const ids = top.map(([id]) => id).filter(Boolean);
  const forn = ids.length ? await db.select('fornecedores', { select: 'id, nome' }) : { data: [] };
  const nameById = new Map((forn.data || []).map(f => [f.id, f.nome]));
  return top.map(([id, val]) => ({ nome: nameById.get(id) || '—', total: val }));
}

export async function renderDashboard(app) {
  app.innerHTML = `
    <div class="grid cols-4">
      <div class="card"><h3>Recebimentos para hoje</h3><div class="value" id="recHoje">—</div></div>
      <div class="card"><h3>Pagamentos para hoje</h3><div class="value" id="pagHoje">—</div></div>
      <div class="card"><h3>Recebimentos Pendentes (30d)</h3><div class="value" id="recPend">—</div></div>
      <div class="card"><h3>Pagamentos Pendentes (30d)</h3><div class="value" id="pagPend">—</div></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px;">
      <div class="card">
        <h3>Fluxo de Caixa Mensal</h3>
        <canvas id="fluxoChart" height="120"></canvas>
      </div>
      <div class="card">
        <h3>MRR Evolution</h3>
        <canvas id="mrrChart" height="120"></canvas>
      </div>
    </div>
    <div class="grid cols-2" style="margin-top:16px;">
      <div class="card">
        <h3>Top Clientes (Receita)</h3>
        <ul id="topClientes" class="muted"></ul>
      </div>
      <div class="card">
        <h3>Top Fornecedores (Despesas)</h3>
        <ul id="topFornecedores" class="muted"></ul>
      </div>
    </div>
  `;

  const recHojeTotal = await getTotalReceberHoje();
  document.getElementById('recHoje').textContent = formatCurrency(recHojeTotal);

  const pagHojeTotal = await getTotalPagarHoje();
  document.getElementById('pagHoje').textContent = formatCurrency(pagHojeTotal);

  const mrr = await getMRR();

  const pend = await getPendencias30d();
  const recSum = sum(pend.recPend.map(r => r.valor_esperado));
  const pagSum = sum(pend.pagPend.map(p => p.valor_esperado));
  document.getElementById('recPend').textContent = formatCurrency(recSum);
  document.getElementById('pagPend').textContent = formatCurrency(pagSum);

  const fluxo = await getFluxoCaixaMensal();
  const ctxFluxo = document.getElementById('fluxoChart');
  renderBarChart(ctxFluxo, fluxo.months, 'Entradas', fluxo.entradas);
  // sobrepor saídas como dataset secundário
  new Chart(ctxFluxo, { type: 'bar', data: { labels: fluxo.months, datasets: [
    { label: 'Entradas', data: fluxo.entradas, backgroundColor: 'rgba(16,185,129,0.5)' },
    { label: 'Saídas', data: fluxo.saidas, backgroundColor: 'rgba(239,68,68,0.5)' },
  ] }, options: { responsive: true } });

  const ctxMrr = document.getElementById('mrrChart');
  // Placeholder simples — usa MRR atual para preencher linha
  renderAreaChart(ctxMrr, fluxo.months, 'MRR', fluxo.months.map(()=>mrr));

  const topCli = await getTopClientes();
  const topForn = await getTopFornecedores();
  document.getElementById('topClientes').innerHTML = topCli.map(c => `<li>${c.nome} — <strong>${formatCurrency(c.total)}</strong></li>`).join('') || '<div class="empty-state">Sem dados</div>';
  document.getElementById('topFornecedores').innerHTML = topForn.map(f => `<li>${f.nome} — <strong>${formatCurrency(f.total)}</strong></li>`).join('') || '<div class="empty-state">Sem dados</div>';
}
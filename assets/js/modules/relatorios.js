import { db } from '../supabaseClient.js';
import { renderLineChart, renderPieChart, renderBarChart, renderAreaChart } from '../components/Charts.js';
import { formatCurrency, sum } from '../utils.js';

async function fluxoCaixaComparativo() {
  const rec = await db.select('recebimentos', { select: 'valor_recebido, valor_esperado, status, data_vencimento, data_recebimento' });
  const pag = await db.select('pagamentos', { select: 'valor_pago, valor_esperado, status, data_vencimento, data_pagamento' });
  const months = []; const now = new Date();
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`); }
  const entradas = months.map(m => { const [mm, yy] = m.split('/'); return sum((rec.data||[]).filter(r => (r.data_recebimento||'').startsWith(`${yy}-${mm}`)).map(r => r.valor_recebido || 0)); });
  const saidas = months.map(m => { const [mm, yy] = m.split('/'); return sum((pag.data||[]).filter(p => (p.data_pagamento||'').startsWith(`${yy}-${mm}`)).map(p => p.valor_pago || 0)); });
  return { months, entradas, saidas };
}

async function receitaPorCategoria() {
  const { data } = await db.select('recebimentos', { select: 'categoria_id, valor_recebido, valor_esperado, status' });
  const { data: cats } = await db.select('categorias', { select: 'id, nome, tipo' });
  const map = new Map();
  (data||[]).forEach(r => {
    const val = r.status === 'recebido' ? Number(r.valor_recebido||0) : 0;
    map.set(r.categoria_id, (map.get(r.categoria_id) || 0) + val);
  });
  const labels = Array.from(map.keys()).map(id => (cats||[]).find(c => c.id === id)?.nome || '—');
  const values = Array.from(map.values());
  return { labels, values };
}

async function despesasPorCategoria() {
  const { data } = await db.select('pagamentos', { select: 'categoria_id, valor_pago, status' });
  const { data: cats } = await db.select('categorias', { select: 'id, nome, tipo' });
  const map = new Map();
  (data||[]).forEach(p => {
    const val = p.status === 'pago' ? Number(p.valor_pago||0) : 0;
    map.set(p.categoria_id, (map.get(p.categoria_id) || 0) + val);
  });
  const labels = Array.from(map.keys()).map(id => (cats||[]).find(c => c.id === id)?.nome || '—');
  const values = Array.from(map.values());
  return { labels, values };
}

async function mrrChurn() {
  const now = new Date(); const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, '0');
  const start = `${y}-${m}-01`; const end = `${y}-${m}-31`;
  const { data } = await db.select('recebimentos', { eq: { tipo_recebimento: 'mensal' }, gte: { data_vencimento: start }, lte: { data_vencimento: end }, select: 'valor_esperado, status' });
  const mrr = sum((data||[]).map(r => r.valor_esperado));
  const lost = sum((data||[]).filter(r => r.status === 'cancelado').map(r => r.valor_esperado));
  const churnRate = mrr ? (lost / mrr) : 0;
  return { mrr, churnRate };
}

async function performancePorCliente() {
  const { data } = await db.select('recebimentos', { select: 'cliente_id, valor_recebido, status' });
  const { data: cli } = await db.select('clientes', { select: 'id, nome' });
  const byClient = new Map();
  (data||[]).filter(r => r.status === 'recebido').forEach(r => byClient.set(r.cliente_id, (byClient.get(r.cliente_id)||0) + Number(r.valor_recebido||0)));
  const labels = Array.from(byClient.keys()).map(id => (cli||[]).find(c => c.id === id)?.nome || '—');
  const values = Array.from(byClient.values());
  return { labels, values };
}

async function projecoesFuturas() {
  const { data } = await db.select('recebimentos', { eq: { status: 'pendente' }, select: 'valor_esperado, data_vencimento' });
  const months = []; const now = new Date();
  for (let i = 0; i < 6; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); months.push(`${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`); }
  const values = months.map(m => { const [mm, yy] = m.split('/'); return sum((data||[]).filter(r => (r.data_vencimento||'').startsWith(`${yy}-${mm}`)).map(r => r.valor_esperado||0)); });
  return { months, values };
}

export async function renderRelatorios(app) {
  app.innerHTML = `
    <div class="grid cols-2">
      <div class="card"><h3>Fluxo de Caixa (12m)</h3><canvas id="fluxo12m" height="140"></canvas></div>
      <div class="card"><h3>MRR e Churn</h3><div id="kpiMrr">—</div><div id="kpiChurn">—</div><canvas id="mrrArea" height="140"></canvas></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px;">
      <div class="card"><h3>Receita por Categoria</h3><canvas id="receitaCat" height="140"></canvas></div>
      <div class="card"><h3>Despesas por Categoria</h3><canvas id="despesaCat" height="140"></canvas></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px;">
      <div class="card"><h3>Performance por Cliente</h3><canvas id="perfCli" height="140"></canvas></div>
      <div class="card"><h3>Projeções Futuras</h3><canvas id="projFut" height="140"></canvas></div>
    </div>
  `;

  const fluxo = await fluxoCaixaComparativo();
  const ctxFluxo = document.getElementById('fluxo12m');
  new Chart(ctxFluxo, { type: 'bar', data: { labels: fluxo.months, datasets: [
    { label: 'Entradas', data: fluxo.entradas, backgroundColor: 'rgba(16,185,129,0.5)' },
    { label: 'Saídas', data: fluxo.saidas, backgroundColor: 'rgba(239,68,68,0.5)' },
  ] }, options: { responsive: true } });

  const { mrr, churnRate } = await mrrChurn();
  document.getElementById('kpiMrr').textContent = `MRR: ${formatCurrency(mrr)}`;
  document.getElementById('kpiChurn').textContent = `Churn Rate: ${(churnRate*100).toFixed(2)}%`;
  const ctxMrr = document.getElementById('mrrArea');
  renderAreaChart(ctxMrr, fluxo.months, 'MRR', fluxo.months.map(()=>mrr));

  const recCat = await receitaPorCategoria();
  renderPieChart(document.getElementById('receitaCat'), recCat.labels, recCat.values);

  const despCat = await despesasPorCategoria();
  renderPieChart(document.getElementById('despesaCat'), despCat.labels, despCat.values);

  const perfCli = await performancePorCliente();
  renderBarChart(document.getElementById('perfCli'), perfCli.labels, 'Receita', perfCli.values);

  const proj = await projecoesFuturas();
  renderLineChart(document.getElementById('projFut'), proj.months, 'Receita Esperada', proj.values);
}
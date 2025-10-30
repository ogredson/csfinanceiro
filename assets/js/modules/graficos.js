import { db } from '../supabaseClient.js';
import { renderLineChart, renderPieChart, renderBarChart, renderAreaChart } from '../components/Charts.js';
import { formatCurrency, sum, showToast } from '../utils.js';

function inRangeDate(s, startStr, endStr) {
  if (!s) return false;
  if (!startStr || !endStr) return true;
  const [y,m,d] = s.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  const [ys,ms,ds] = startStr.split('-').map(Number);
  const [ye,me,de] = endStr.split('-').map(Number);
  const a = new Date(ys, ms-1, ds);
  const b = new Date(ye, me-1, de);
  return dt >= a && dt <= b;
}

async function fluxoCaixaComparativo(startDateStr, endDateStr) {
  const rec = await db.select('recebimentos', { select: 'valor_recebido, status, data_recebimento' });
  const pag = await db.select('pagamentos', { select: 'valor_pago, status, data_pagamento' });
  function buildMonthLabels(startStr, endStr) {
    const labels = [];
    if (startStr && endStr) {
      const s = startStr.split('-').map(Number); const e = endStr.split('-').map(Number);
      let y = s[0], m = s[1];
      while (y < e[0] || (y === e[0] && m <= e[1])) {
        labels.push(`${String(m).padStart(2,'0')}/${y}`);
        m++; if (m > 12) { m = 1; y++; }
        if (labels.length > 36) break;
      }
      return labels;
    }
    const months = []; const now = new Date();
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`); }
    return months;
  }
  const months = buildMonthLabels(startDateStr, endDateStr);
  const entradas = months.map(m => { const [mm, yy] = m.split('/'); return sum((rec.data||[]).filter(r => (r.data_recebimento||'').startsWith(`${yy}-${mm}`) && r.status==='recebido').map(r => r.valor_recebido || 0)); });
  const saidas = months.map(m => { const [mm, yy] = m.split('/'); return sum((pag.data||[]).filter(p => (p.data_pagamento||'').startsWith(`${yy}-${mm}`) && p.status==='pago').map(p => p.valor_pago || 0)); });
  return { months, entradas, saidas };
}

async function receitaPorCategoria(startStr, endStr, campoSel, statusSel) {
  const { data } = await db.select('recebimentos', { select: 'categoria_id, valor_recebido, valor_esperado, status, data_vencimento, data_recebimento' });
  const { data: cats } = await db.select('categorias', { select: 'id, nome' });
  const dateField = (campoSel === 'data_pagamento') ? 'data_recebimento' : 'data_vencimento';
  const map = new Map();
  (data||[]).forEach(r => {
    const okDate = inRangeDate(r[dateField], startStr, endStr);
    if (!okDate) return;
    const isPend = r.status === 'pendente';
    const isRec = r.status === 'recebido';
    let val = 0;
    if (statusSel === 'pendentes') val = isPend ? Number(r.valor_esperado||0) : 0;
    else val = isRec ? Number(r.valor_recebido||0) : 0;
    map.set(r.categoria_id, (map.get(r.categoria_id) || 0) + val);
  });
  const labels = Array.from(map.keys()).map(id => (cats||[]).find(c => c.id === id)?.nome || '—');
  const values = Array.from(map.values());
  return { labels, values };
}

async function despesasPorCategoria(startStr, endStr, campoSel, statusSel) {
  const { data } = await db.select('pagamentos', { select: 'categoria_id, valor_pago, valor_esperado, status, data_vencimento, data_pagamento' });
  const { data: cats } = await db.select('categorias', { select: 'id, nome' });
  const dateField = (campoSel === 'data_pagamento') ? 'data_pagamento' : 'data_vencimento';
  const map = new Map();
  (data||[]).forEach(p => {
    const okDate = inRangeDate(p[dateField], startStr, endStr);
    if (!okDate) return;
    const isPend = p.status === 'pendente';
    const isPago = p.status === 'pago';
    let val = 0;
    if (statusSel === 'pendentes') val = isPend ? Number(p.valor_esperado||0) : 0;
    else val = isPago ? Number(p.valor_pago||0) : 0;
    map.set(p.categoria_id, (map.get(p.categoria_id) || 0) + val);
  });
  const labels = Array.from(map.keys()).map(id => (cats||[]).find(c => c.id === id)?.nome || '—');
  const values = Array.from(map.values());
  return { labels, values };
}

async function performancePorCliente(startStr, endStr, campoSel) {
  const { data } = await db.select('recebimentos', { select: 'cliente_id, valor_recebido, status, data_vencimento, data_recebimento' });
  const { data: cli } = await db.select('clientes', { select: 'id, nome' });
  const dateField = (campoSel === 'data_pagamento') ? 'data_recebimento' : 'data_vencimento';
  const byClient = new Map();
  (data||[]).filter(r => r.status === 'recebido' && inRangeDate(r[dateField], startStr, endStr)).forEach(r => byClient.set(r.cliente_id, (byClient.get(r.cliente_id)||0) + Number(r.valor_recebido||0)));
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

export async function renderGraficos(app) {
  app.innerHTML = `
    <div class="toolbar">
      <div class="filters" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <label>Início <input type="date" id="graDtInicio" /></label>
        <label>Fim <input type="date" id="graDtFim" /></label>
        <label id="graLblCampo"><span id="graLblCampoText">Campo de data</span>
          <select id="graCampoData">
            <option value="data_vencimento" selected>Por Vencimento</option>
            <option value="data_pagamento">Por Pagamento/Recebimento</option>
          </select>
        </label>
        <label>Filtro de status
          <select id="graStatus">
            <option value="concluidos" selected>Concluídos (recebidos/pagos)</option>
            <option value="pendentes">Pendentes (esperados)</option>
            <option value="todos">Todos (realizados)</option>
          </select>
        </label>
        <button id="aplicarGraficos" class="btn btn-primary btn-prominent">Aplicar Filtros</button>
      </div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Fluxo de Caixa (período)</h3><canvas id="graFluxo" height="140"></canvas></div>
      <div class="card"><h3>MRR e Churn</h3><div id="graKpiMrr">—</div><div id="graKpiChurn">—</div><canvas id="graMrr" height="140"></canvas></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px;">
      <div class="card"><h3>Receita por Categoria</h3><canvas id="graRecCat" height="140"></canvas></div>
      <div class="card"><h3>Despesas por Categoria</h3><canvas id="graDespCat" height="140"></canvas></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px;">
      <div class="card"><h3>Performance por Cliente</h3><canvas id="graPerfCli" height="140"></canvas></div>
      <div class="card"><h3>Projeções Futuras</h3><canvas id="graProj" height="140"></canvas></div>
    </div>
  `;

  const dtInicio = document.getElementById('graDtInicio');
  const dtFim = document.getElementById('graDtFim');
  const now = new Date();
  const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const lastDayDate = new Date(now.getFullYear(), now.getMonth()+1, 0);
  const lastDay = `${lastDayDate.getFullYear()}-${String(lastDayDate.getMonth()+1).padStart(2,'0')}-${String(lastDayDate.getDate()).padStart(2,'0')}`;
  dtInicio.value = firstDay;
  dtFim.value = lastDay;

  const campoSel = document.getElementById('graCampoData');
  const campoLabelText = document.getElementById('graLblCampoText');
  const setCampoDataLabels = () => {
    const v = campoSel.value;
    campoLabelText.textContent = v === 'data_pagamento' ? 'Campo de data (Pagamento/Recebimento)' : 'Campo de data (Vencimento)';
  };
  setCampoDataLabels();
  campoSel.addEventListener('change', setCampoDataLabels);

  let charts = [];
  const destroyCharts = () => { charts.forEach(c => { try { c.destroy?.(); } catch {} }); charts = []; };

  async function drawAll() {
    destroyCharts();
    const inicio = dtInicio.value; const fim = dtFim.value; const campo = campoSel.value; const statusSel = document.getElementById('graStatus').value;
    try {
      const fluxo = await fluxoCaixaComparativo(inicio, fim);
      const ctxFluxo = document.getElementById('graFluxo');
      const chFluxo = new Chart(ctxFluxo, { type: 'bar', data: { labels: fluxo.months, datasets: [
        { label: 'Entradas', data: fluxo.entradas, backgroundColor: 'rgba(16,185,129,0.5)' },
        { label: 'Saídas', data: fluxo.saidas, backgroundColor: 'rgba(239,68,68,0.5)' },
      ] }, options: { responsive: true } });
      charts.push(chFluxo);

      // KPIs e MRR
      const mrrKpi = await (async function mrrChurn() {
        const now = new Date(); const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, '0');
        const start = `${y}-${m}-01`; const end = `${y}-${m}-31`;
        const { data } = await db.select('recebimentos', { eq: { tipo_recebimento: 'mensal' }, gte: { data_vencimento: start }, lte: { data_vencimento: end }, select: 'valor_esperado, status' });
        const mrr = sum((data||[]).map(r => r.valor_esperado));
        const lost = sum((data||[]).filter(r => r.status === 'cancelado').map(r => r.valor_esperado));
        const churnRate = mrr ? (lost / mrr) : 0; return { mrr, churnRate };
      })();
      document.getElementById('graKpiMrr').textContent = `MRR: ${formatCurrency(mrrKpi.mrr)}`;
      document.getElementById('graKpiChurn').textContent = `Churn Rate: ${(mrrKpi.churnRate*100).toFixed(2)}%`;
      charts.push(renderAreaChart(document.getElementById('graMrr'), fluxo.months, 'MRR', fluxo.months.map(()=>mrrKpi.mrr)));

      const recCat = await receitaPorCategoria(inicio, fim, campo, statusSel);
      charts.push(renderPieChart(document.getElementById('graRecCat'), recCat.labels, recCat.values));

      const despCat = await despesasPorCategoria(inicio, fim, campo, statusSel);
      charts.push(renderPieChart(document.getElementById('graDespCat'), despCat.labels, despCat.values));

      const perfCli = await performancePorCliente(inicio, fim, campo);
      charts.push(renderBarChart(document.getElementById('graPerfCli'), perfCli.labels, 'Receita', perfCli.values));

      const proj = await projecoesFuturas();
      charts.push(renderLineChart(document.getElementById('graProj'), proj.months, 'Receita Esperada', proj.values));
    } catch (e) {
      console.error(e);
      showToast('Falha ao carregar gráficos', 'error');
    }
  }

  document.getElementById('aplicarGraficos').addEventListener('click', drawAll);
  await drawAll();
}
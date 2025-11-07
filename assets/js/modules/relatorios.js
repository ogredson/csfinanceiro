import { db } from '../supabaseClient.js';
import { renderLineChart, renderPieChart, renderBarChart, renderAreaChart } from '../components/Charts.js';
import { formatCurrency, sum, showToast, formatDate, exportToCSV } from '../utils.js';

async function fluxoCaixaComparativo(startDateStr, endDateStr) {
  const rec = await db.select('recebimentos', { select: 'valor_recebido, valor_esperado, status, data_vencimento, data_recebimento' });
  const pag = await db.select('pagamentos', { select: 'valor_pago, valor_esperado, status, data_vencimento, data_pagamento' });
  function buildMonthLabels(startStr, endStr) {
    const labels = [];
    if (startStr && endStr) {
      const s = startStr.split('-').map(Number); const e = endStr.split('-').map(Number);
      let y = s[0], m = s[1];
      while (y < e[0] || (y === e[0] && m <= e[1])) {
        labels.push(`${String(m).padStart(2,'0')}/${y}`);
        m++; if (m > 12) { m = 1; y++; }
        if (labels.length > 36) break; // limita 36 meses
      }
      return labels;
    }
    const months = []; const now = new Date();
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`); }
    return months;
  }
  const months = buildMonthLabels(startDateStr, endDateStr);
  const entradas = months.map(m => { const [mm, yy] = m.split('/'); return sum((rec.data||[]).filter(r => (r.data_recebimento||'').startsWith(`${yy}-${mm}`)).map(r => r.valor_recebido || 0)); });
  const saidas = months.map(m => { const [mm, yy] = m.split('/'); return sum((pag.data||[]).filter(p => (p.data_pagamento||'').startsWith(`${yy}-${mm}`)).map(p => p.valor_pago || 0)); });
  return { months, entradas, saidas };
}

async function receitaPorCategoria() {
  const { data } = await db.select('recebimentos', { select: 'categoria_id, valor_recebido, valor_esperado, status' });
  const { data: cats } = await db.select('categorias', { select: 'id, nome, tipo' });
  const map = new Map();
  (data||[]).forEach(r => { const val = r.status === 'recebido' ? Number(r.valor_recebido||0) : 0; map.set(r.categoria_id, (map.get(r.categoria_id) || 0) + val); });
  const labels = Array.from(map.keys()).map(id => (cats||[]).find(c => c.id === id)?.nome || '—');
  const values = Array.from(map.values());
  return { labels, values };
}

async function despesasPorCategoria() {
  const { data } = await db.select('pagamentos', { select: 'categoria_id, valor_pago, status' });
  const { data: cats } = await db.select('categorias', { select: 'id, nome, tipo' });
  const map = new Map();
  (data||[]).forEach(p => { const val = p.status === 'pago' ? Number(p.valor_pago||0) : 0; map.set(p.categoria_id, (map.get(p.categoria_id) || 0) + val); });
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

function buildMonthArray(startStr, endStr) {
  const arr = [];
  const s = startStr.split('-').map(Number);
  const e = endStr.split('-').map(Number);
  let y = s[0], m = s[1];
  while (y < e[0] || (y === e[0] && m <= e[1])) {
    arr.push({ year: y, month: m });
    m++; if (m > 12) { m = 1; y++; }
    if (arr.length > 36) break;
  }
  return arr;
}

function getMonthNamePtBr(month) {
  const nomes = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  return nomes[month - 1] || '';
}

async function gerarEvolucaoReceitasDespesasPDF(startStr, endStr, saldoInicial = 0) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { showToast('Biblioteca jsPDF não carregada', 'error'); return; }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFont('helvetica','normal');
  const blue = [0, 64, 192];
  const red = [192, 0, 0];
  const margin = 24;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Formata datas como dd-mm-aaaa (solicitação do usuário)
  const formatDateDashedBR = (s) => {
    if (!s) return '';
    const [y,m,d] = String(s).split('T')[0].split('-');
    return `${d}-${m}-${y}`;
  };

  const campoSel = window._campoDataRelatorios || 'data_vencimento';
  const recDateField = (campoSel === 'data_pagamento') ? 'data_recebimento' : 'data_vencimento';
  const pagDateField = (campoSel === 'data_pagamento') ? 'data_pagamento' : 'data_vencimento';

  const parseDate = (str) => {
    if (!str) return null;
    const [y,m,d] = String(str).split('T')[0].split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m-1, d);
  };
  const inRange = (dt) => {
    if (!dt) return false;
    const sParts = startStr.split('-').map(Number);
    const eParts = endStr.split('-').map(Number);
    const s = new Date(sParts[0], sParts[1]-1, sParts[2]||1);
    const e = new Date(eParts[0], eParts[1]-1, eParts[2]||1);
    const dts = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    return dts >= s && dts <= e;
  };

  const { data: recebimentos } = await db.select('recebimentos', { select: 'id, categoria_id, descricao, valor_esperado, valor_recebido, status, data_vencimento, data_recebimento' });
  const { data: pagamentos } = await db.select('pagamentos', { select: 'id, categoria_id, descricao, valor_esperado, valor_pago, status, data_vencimento, data_pagamento' });
  const { data: categorias } = await db.select('categorias', { select: 'id, nome, tipo' });
  const mapCat = new Map((categorias||[]).map(c => [c.id, { nome: c.nome, tipo: c.tipo }]));

  const months = buildMonthArray(startStr, endStr);
  const monthKey = (y,m) => `${y}-${String(m).padStart(2,'0')}`;
  const monthLabel = (y,m) => {
    const abbr = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'][m-1] || '';
    return `${abbr}/${String(y).slice(-2)}`;
  };

  const receitasCats = new Set();
  const despesasCats = new Set();
  const receitasPorMesCat = {};
  const despesasPorMesCat = {};
  const totReceitasMes = {};
  const totDespesasMes = {};

  (recebimentos||[]).forEach(r => {
    const dt = parseDate(r[recDateField]);
    if (!dt || !inRange(dt)) return;
    const val = (recDateField === 'data_recebimento') ? Number(r.valor_recebido||0) : Number(r.valor_esperado||0);
    const key = monthKey(dt.getFullYear(), dt.getMonth()+1);
    const cat = mapCat.get(r.categoria_id);
    const catId = r.categoria_id;
    if (cat && cat.tipo === 'entrada') {
      receitasCats.add(catId);
      if (!receitasPorMesCat[catId]) receitasPorMesCat[catId] = {};
      receitasPorMesCat[catId][key] = (receitasPorMesCat[catId][key]||0) + val;
      totReceitasMes[key] = (totReceitasMes[key]||0) + val;
    }
  });
  (pagamentos||[]).forEach(p => {
    const dt = parseDate(p[pagDateField]);
    if (!dt || !inRange(dt)) return;
    const val = (pagDateField === 'data_pagamento') ? Number(p.valor_pago||0) : Number(p.valor_esperado||0);
    const key = monthKey(dt.getFullYear(), dt.getMonth()+1);
    const cat = mapCat.get(p.categoria_id);
    const catId = p.categoria_id;
    if (cat && cat.tipo === 'saida') {
      despesasCats.add(catId);
      if (!despesasPorMesCat[catId]) despesasPorMesCat[catId] = {};
      despesasPorMesCat[catId][key] = (despesasPorMesCat[catId][key]||0) + val;
      totDespesasMes[key] = (totDespesasMes[key]||0) + val;
    }
  });

  const saldoFinalMes = {};
  const acumuladoMes = {};
  let acc = Number(saldoInicial || 0);
  months.forEach(({year, month}) => {
    const key = monthKey(year, month);
    const rec = Number(totReceitasMes[key]||0);
    const des = Number(totDespesasMes[key]||0);
    const saldo = rec - des;
    saldoFinalMes[key] = saldo;
    acc += saldo;
    acumuladoMes[key] = acc;
  });

  const title = 'Evolução das Receitas x Despesas';
  doc.setTextColor(0,0,0);
  doc.setFontSize(18);
  doc.text(title, margin, margin + 18);
  doc.setFontSize(11);
  const campoLabel = (campoSel === 'data_pagamento') ? 'Por Pagamento/Recebimento' : 'Por Vencimento';
  // Período no formato dd-mm-aaaa, com "Campo de data" ao lado (mesma linha)
  const periodY = margin + 36;
  doc.text(`Período ${formatDateDashedBR(startStr)} a ${formatDateDashedBR(endStr)}`, margin, periodY);
  doc.text(`Campo de data: ${campoLabel}`, pageWidth - margin, periodY, { align: 'right' });
  // Saldo inicial destacado em negrito (linha imediatamente abaixo)
  doc.setFont('helvetica','bold');
  doc.text(`Saldo inicial: ${formatCurrency(Number(saldoInicial||0))}`, margin, periodY + 16);
  doc.setFont('helvetica','normal');

  const leftW = 240;
  const rightW = pageWidth - margin*2 - leftW;
  const colW = rightW / Math.max(months.length, 1);
  // Ajuste de espaçamento superior para ganhar linhas na página
  let y = margin + 84;

  // Cabeçalhos
  doc.setFontSize(10);
  doc.setTextColor(0,0,0);
  doc.text('Receitas', margin, y);
  // Alinha cabeçalhos dos meses com os valores (direita da coluna)
  months.forEach((m, idx) => {
    const tx = margin + leftW + idx*colW + colW - 4;
    doc.text(monthLabel(m.year, m.month), tx, y, { align: 'right' });
  });
  // Remove a linha vazia entre "Receitas" e as categorias
  y += 16;

  // Linhas de categorias de receita
  const receitaCatIds = Array.from(receitasCats);
  receitaCatIds.sort((a,b) => (mapCat.get(a)?.nome||'').localeCompare(mapCat.get(b)?.nome||''));
  doc.setTextColor(blue[0], blue[1], blue[2]);
  let recRowIndex = 0;
  receitaCatIds.forEach(catId => {
    if (y > pageHeight - margin - 140) { doc.addPage(); y = margin + 24; }
    // Alternância de fundo (cinza/branco) para melhor visualização
    if (recRowIndex % 2 === 0) {
      doc.setFillColor(245, 245, 245);
      doc.rect(margin, y - 12, pageWidth - margin*2, 18, 'F');
    }
    doc.text(mapCat.get(catId)?.nome || '-', margin, y);
    months.forEach((m, idx) => {
      const key = monthKey(m.year, m.month);
      const v = Number((receitasPorMesCat[catId]||{})[key]||0);
      const tx = margin + leftW + idx*colW + colW - 4;
      doc.text(formatCurrency(v), tx, y, { align: 'right' });
    });
    y += 16;
    recRowIndex++;
  });
  // Total Receitas Mês
  doc.setTextColor(blue[0], blue[1], blue[2]);
  doc.setFontSize(11);
  doc.text('Total Receitas Mês', margin, y);
  months.forEach((m, idx) => {
    const key = monthKey(m.year, m.month);
    const v = Number(totReceitasMes[key]||0);
    const tx = margin + leftW + idx*colW + colW - 4;
    doc.text(formatCurrency(v), tx, y, { align: 'right' });
  });
  y += 28;

  // Despesas
  doc.setTextColor(0,0,0);
  doc.setFontSize(10);
  doc.text('Despesas', margin, y);
  // Alinha cabeçalhos dos meses com os valores (direita da coluna)
  months.forEach((m, idx) => {
    const tx = margin + leftW + idx*colW + colW - 4;
    doc.text(monthLabel(m.year, m.month), tx, y, { align: 'right' });
  });
  // Remove a linha vazia abaixo de "Despesas"
  y += 16;

  const despesaCatIds = Array.from(despesasCats);
  despesaCatIds.sort((a,b) => (mapCat.get(a)?.nome||'').localeCompare(mapCat.get(b)?.nome||''));
  doc.setTextColor(red[0], red[1], red[2]);
  let desRowIndex = 0;
  despesaCatIds.forEach(catId => {
    if (y > pageHeight - margin - 140) { doc.addPage(); y = margin + 24; }
    // Alternância de fundo (cinza/branco) para melhor visualização
    if (desRowIndex % 2 === 0) {
      doc.setFillColor(245, 245, 245);
      doc.rect(margin, y - 12, pageWidth - margin*2, 18, 'F');
    }
    doc.text(mapCat.get(catId)?.nome || '-', margin, y);
    months.forEach((m, idx) => {
      const key = monthKey(m.year, m.month);
      const v = Number((despesasPorMesCat[catId]||{})[key]||0);
      const tx = margin + leftW + idx*colW + colW - 4;
      doc.text(formatCurrency(v), tx, y, { align: 'right' });
    });
    y += 16;
    desRowIndex++;
  });

  doc.setTextColor(red[0], red[1], red[2]);
  doc.setFontSize(11);
  doc.text('Total Despesas Mês', margin, y);
  months.forEach((m, idx) => {
    const key = monthKey(m.year, m.month);
    const v = Number(totDespesasMes[key]||0);
    const tx = margin + leftW + idx*colW + colW - 4;
    doc.text(formatCurrency(v), tx, y, { align: 'right' });
  });
  // Remove a linha vazia após "Total Despesas Mês"
  y += 16;

  doc.setTextColor(blue[0], blue[1], blue[2]);
  doc.setFontSize(11);
  doc.text('Saldo Final (Receita – Despesa)', margin, y);
  months.forEach((m, idx) => {
    const key = monthKey(m.year, m.month);
    const v = Number(saldoFinalMes[key]||0);
    const tx = margin + leftW + idx*colW + colW - 4;
    doc.text(formatCurrency(v), tx, y, { align: 'right' });
  });
  y += 20;

  doc.setTextColor(blue[0], blue[1], blue[2]);
  doc.text('Acumulado', margin, y);
  months.forEach((m, idx) => {
    const key = monthKey(m.year, m.month);
    const v = Number(acumuladoMes[key]||0);
    const tx = margin + leftW + idx*colW + colW - 4;
    doc.text(formatCurrency(v), tx, y, { align: 'right' });
  });

  doc.save(`evolucao_receitas_despesas_${startStr}_a_${endStr}.pdf`);
  showToast('PDF gerado: Evolução das Receitas x Despesas', 'success');
}

async function gerarCalendarioRecebimentosPDF(startStr, endStr) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { showToast('Biblioteca jsPDF não carregada', 'error'); return; }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFont('helvetica','normal');
  const blue = [0, 64, 192];
  const margin = 24;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const gridTop = margin + 40; // abaixo do título
  const colCount = 7; const rowCount = 6;
  const colW = (pageWidth - margin * 2) / colCount;
  const totalGridHeight = pageHeight - gridTop - margin;

  const { data: recebimentos } = await db.select('recebimentos', { select: 'id, cliente_id, descricao, valor_esperado, valor_recebido, status, data_vencimento, data_recebimento' });
  const { data: clientes } = await db.select('clientes', { select: 'id, nome' });
  const clienteNome = (id) => (clientes||[]).find(c => c.id === id)?.nome || '—';

  const meses = buildMonthArray(startStr, endStr);
  const diasSemana = ['DOM.','SEG.','TER.','QUA.','QUI.','SEX.','SÁB.'];

  meses.forEach((mesObj, idx) => {
    if (idx > 0) doc.addPage('a4','landscape');
    const y = mesObj.year, m = mesObj.month;
    const titulo = `CALENDÁRIO DE RECEBIMENTOS - ${getMonthNamePtBr(m)} de ${y}`;
    doc.setTextColor(...blue); doc.setFontSize(18);
    doc.text(titulo, pageWidth / 2, margin + 10, { align: 'center' });

    // cabeçalho dos dias da semana
    doc.setFontSize(12); doc.setTextColor(...blue);
    diasSemana.forEach((ds, i) => {
      const x = margin + i * colW + 6;
      doc.text(ds, x, gridTop - 8);
    });

    // dias do mês e conteúdos
    const firstDay = new Date(y, m - 1, 1);
    const startWeekday = firstDay.getDay(); // 0=Dom
    const daysInMonth = new Date(y, m, 0).getDate();

    // agrupa recebimentos por dia (campo de data)
    const selField = window._campoDataRelatorios || 'data_vencimento';
    const dateField = selField === 'data_pagamento' ? 'data_recebimento' : 'data_vencimento';
    const mmStr = String(m).padStart(2,'0');
    const rowsMes = (recebimentos||[]).filter(r => ((r[dateField]||'').startsWith(`${y}-${mmStr}`)));

    const porDia = new Map();
    rowsMes.forEach(r => {
      const d = Number(((r[dateField]||'').split('-')[2]));
      const lista = porDia.get(d) || [];
      const txt = shortenForCalendar(r.descricao || '—');
      lista.push(txt);
      porDia.set(d, lista);
    });

    // calcula necessidade de linhas por dia (com quebra) e peso por semana
    const weeklyMaxLines = new Array(rowCount).fill(0);
    const lineHeight = 9; // fonte menor para caber mais linhas
    doc.setFontSize(7); // fonte dos itens do calendário
    for (let day = 1; day <= daysInMonth; day++) {
      const itens = porDia.get(day) || [];
      let linesNeeded = 0;
      itens.forEach(t => { linesNeeded += doc.splitTextToSize(t, colW - 12).length; });
      const pos = startWeekday + (day - 1);
      const week = Math.floor(pos / colCount);
      weeklyMaxLines[week] = Math.max(weeklyMaxLines[week], linesNeeded);
    }
    // alturas dinâmicas por semana
    const weights = weeklyMaxLines.map(l => 1 + (l / 5));
    const sumW = weights.reduce((a,b)=>a+b,0) || 1;
    const rowHeights = weights.map(w => totalGridHeight * (w / sumW));

    // desenha bordas do grid em azul
    doc.setDrawColor(...blue);
    let yCursor = gridTop;
    for (let r = 0; r <= rowCount; r++) {
      doc.line(margin, yCursor, pageWidth - margin, yCursor);
      if (r < rowCount) yCursor += rowHeights[r];
    }
    for (let c = 0; c <= colCount; c++) {
      const xLine = margin + c * colW;
      doc.line(xLine, gridTop, xLine, gridTop + totalGridHeight);
    }

    // cabeçalho dos dias da semana
    doc.setFontSize(12); doc.setTextColor(...blue);
    const headerY = gridTop - 8;
    for (let i = 0; i < colCount; i++) { const x = margin + i * colW + 6; doc.text(diasSemana[i], x, headerY); }

    // imprime conteúdo por dia respeitando a altura de cada semana
    let yStartRow = gridTop;
    for (let day = 1; day <= daysInMonth; day++) {
      const pos = startWeekday + (day - 1);
      const row = Math.floor(pos / colCount);
      const col = pos % colCount;
      const x0 = margin + col * colW;
      const y0 = yStartRow + (row === 0 ? 0 : rowHeights.slice(0, row).reduce((a,b)=>a+b,0));

      // número do dia (azul)
      doc.setTextColor(...blue); doc.setFontSize(12);
      doc.text(String(day), x0 + 6, y0 + 16);

      const itens = porDia.get(day) || [];
      if (itens.length) {
        // DIFERENÇA: conteúdo em azul (não vermelho)
        doc.setTextColor(...blue); doc.setFontSize(8);
        const availableLines = Math.max(0, Math.floor((rowHeights[row] - (16 + 14 + 8)) / lineHeight));
        let printedLines = 0;
        let printedItems = 0;
        for (let i = 0; i < itens.length; i++) {
          const lines = doc.splitTextToSize(itens[i], colW - 12);
          for (let j = 0; j < lines.length; j++) {
            if (printedLines >= availableLines) break;
            const yy = y0 + 16 + 14 + printedLines * lineHeight;
            doc.text(lines[j], x0 + 6, yy);
            printedLines++;
          }
          printedItems++;
          if (printedLines >= availableLines) break;
        }
        const remainingItems = itens.length - printedItems;
        if (remainingItems > 0) { doc.text(`+recebimentos (${remainingItems})`, x0 + 6, y0 + rowHeights[row] - 8); }
      }
    }

    // rodapé: totais do mês e legenda
    const totalMes = sum(rowsMes.map(r => Number(dateField === 'data_recebimento' ? (r.valor_recebido || 0) : (r.valor_esperado || 0))));
    const footerY = pageHeight - margin - 6;
    doc.setTextColor(...blue); doc.setFontSize(10);
    const qtdMes = rowsMes.length;
    doc.text(`Total do mês (${dateField === 'data_recebimento' ? 'por recebimento' : 'por vencimento'}): ${formatCurrency(totalMes)} / Quantidade de recebimentos: ${qtdMes}`,
      margin, footerY);

    // (Relatório mensal separado — removido daqui)
  });

  const fname = `calendario_recebimentos_${startStr}_a_${endStr}.pdf`;
  doc.save(fname);
  showToast('Calendário de recebimentos gerado em PDF', 'success');
}

async function gerarCalendarioPagamentosPDF(startStr, endStr) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { showToast('Biblioteca jsPDF não carregada', 'error'); return; }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFont('helvetica','normal');
  const blue = [0, 64, 192];
  const red = [200, 0, 0];
  const margin = 24;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const gridTop = margin + 40; // abaixo do título
  const colCount = 7; const rowCount = 6;
  const colW = (pageWidth - margin * 2) / colCount;
  const totalGridHeight = pageHeight - gridTop - margin;

  const { data: pagamentos } = await db.select('pagamentos', { select: 'id, fornecedor_id, descricao, valor_esperado, valor_pago, status, data_vencimento, data_pagamento' });
  const { data: fornecedores } = await db.select('fornecedores', { select: 'id, nome' });
  const fornecedorNome = (id) => (fornecedores||[]).find(f => f.id === id)?.nome || '—';

  const meses = buildMonthArray(startStr, endStr);
  const diasSemana = ['DOM.','SEG.','TER.','QUA.','QUI.','SEX.','SÁB.'];

  meses.forEach((mesObj, idx) => {
    if (idx > 0) doc.addPage('a4','landscape');
    const y = mesObj.year, m = mesObj.month;
    const titulo = `CALENDÁRIO DE PAGAMENTOS - ${getMonthNamePtBr(m)} de ${y}`;
    doc.setTextColor(...blue); doc.setFontSize(18);
    doc.text(titulo, pageWidth / 2, margin + 10, { align: 'center' });

    // cabeçalho dos dias da semana
    doc.setFontSize(12); doc.setTextColor(...blue);
    diasSemana.forEach((ds, i) => {
      const x = margin + i * colW + 6;
      doc.text(ds, x, gridTop - 8);
    });

    // bordas do grid (azul) — linhas horizontais serão desenhadas após calcular alturas dinâmicas
    // dias do mês e conteúdos
    const firstDay = new Date(y, m - 1, 1);
    const startWeekday = firstDay.getDay(); // 0=Dom
    const daysInMonth = new Date(y, m, 0).getDate();

    // agrupa pagamentos por dia
    const dateField = window._campoDataRelatorios || 'data_vencimento';
    const mmStr = String(m).padStart(2,'0');
    const rowsMes = (pagamentos||[]).filter(p => ((p[dateField]||'').startsWith(`${y}-${mmStr}`)));
    const porDia = new Map();
    rowsMes.forEach(p => {
      const d = Number(((p[dateField]||'').split('-')[2]));
      const lista = porDia.get(d) || [];
      const valor = Number(dateField === 'data_pagamento' ? (p.valor_pago || 0) : (p.valor_esperado || 0));
      const txt = shortenForCalendar(p.descricao || '—');
      lista.push(txt);
      porDia.set(d, lista);
    });

    // calcula necessidade de linhas por dia (com quebra) e peso por semana
    const weeklyMaxLines = new Array(rowCount).fill(0);
    const lineHeight = 9; // ligeiramente menor para caber mais linhas
    doc.setFontSize(7); // fonte dos itens do calendário: 7pt
    for (let day = 1; day <= daysInMonth; day++) {
      const itens = porDia.get(day) || [];
      let linesNeeded = 0;
      itens.forEach(t => { linesNeeded += doc.splitTextToSize(t, colW - 12).length; });
      const pos = startWeekday + (day - 1);
      const week = Math.floor(pos / colCount);
      weeklyMaxLines[week] = Math.max(weeklyMaxLines[week], linesNeeded);
    }
    // gera alturas dinâmicas por semana com base no peso
    const weights = weeklyMaxLines.map(l => 1 + (l / 5));
    const sumW = weights.reduce((a,b)=>a+b,0) || 1;
    const rowHeights = weights.map(w => totalGridHeight * (w / sumW));

    // desenha bordas do grid usando alturas dinâmicas
    doc.setDrawColor(...blue);
    let yCursor = gridTop;
    for (let r = 0; r <= rowCount; r++) {
      doc.line(margin, yCursor, pageWidth - margin, yCursor);
      if (r < rowCount) yCursor += rowHeights[r];
    }
    for (let c = 0; c <= colCount; c++) {
      const xLine = margin + c * colW;
      doc.line(xLine, gridTop, xLine, gridTop + totalGridHeight);
    }

    // cabeçalho dos dias da semana
    doc.setFontSize(12); doc.setTextColor(...blue);
    const headerY = gridTop - 8;
    for (let i = 0; i < colCount; i++) { const x = margin + i * colW + 6; doc.text(diasSemana[i], x, headerY); }

    // imprime conteúdo por dia respeitando a altura de cada semana
    let yStartRow = gridTop;
    for (let day = 1; day <= daysInMonth; day++) {
      const pos = startWeekday + (day - 1);
      const row = Math.floor(pos / colCount);
      const col = pos % colCount;
      const x0 = margin + col * colW;
      const y0 = yStartRow + (row === 0 ? 0 : rowHeights.slice(0, row).reduce((a,b)=>a+b,0));

      // número do dia (azul)
      doc.setTextColor(...blue); doc.setFontSize(12);
      doc.text(String(day), x0 + 6, y0 + 16);

      const itens = porDia.get(day) || [];
      if (itens.length) {
        doc.setTextColor(...red); doc.setFontSize(8);
        const availableLines = Math.max(0, Math.floor((rowHeights[row] - (16 + 14 + 8)) / lineHeight));
         let printedLines = 0;
         let printedItems = 0;
         for (let i = 0; i < itens.length; i++) {
           const lines = doc.splitTextToSize(itens[i], colW - 12);
           for (let j = 0; j < lines.length; j++) {
             if (printedLines >= availableLines) break;
             const yy = y0 + 16 + 14 + printedLines * lineHeight;
             doc.text(lines[j], x0 + 6, yy);
             printedLines++;
           }
           printedItems++;
           if (printedLines >= availableLines) break;
         }
         const remainingItems = itens.length - printedItems;
         if (remainingItems > 0) { doc.text(`+pagamentos (${remainingItems})`, x0 + 6, y0 + rowHeights[row] - 8); }
      }
    }
    // rodapé: totais do mês e legenda
    const totalMes = sum(rowsMes.map(p => Number(dateField === 'data_pagamento' ? (p.valor_pago || 0) : (p.valor_esperado || 0))));
    const footerY = pageHeight - margin - 6;
    doc.setTextColor(...blue); doc.setFontSize(10);
    const qtdMes = rowsMes.length;
    doc.text(`Total do mês (${dateField === 'data_pagamento' ? 'por pagamento' : 'por vencimento'}): ${formatCurrency(totalMes)} / Quantidade de pagamentos: ${qtdMes}`,
      margin, footerY);

    // (Relatório mensal separado — removido daqui)
  });

  const fname = `calendario_pagamentos_${startStr}_a_${endStr}.pdf`;
  doc.save(fname);
  showToast('Calendário de pagamentos gerado em PDF', 'success');
}

export async function renderRelatorios(app) {
  app.innerHTML = `
    <div class="toolbar">
      <div class="filters" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <label>Início <input type="date" id="dtInicio" /></label>
        <label>Fim <input type="date" id="dtFim" /></label>
        <label id="lblCampoData"><span id="lblCampoDataText">Campo de data</span>
          <select id="campoData">
            <option value="data_vencimento" selected>Por Vencimento</option>
            <option value="data_pagamento">Por Pagamento</option>
          </select>
        </label>
      </div>
    </div>

    <div id="areasRel" class="areas">
      <div class="card area" data-area-id="calendarios">
        <div class="toolbar" style="justify-content:space-between;">
          <h3>Calendários</h3>
          <button class="btn btn-outline" data-toggle="calendarios">Mostrar/Ocultar</button>
        </div>
        <div class="area-body" id="areaBody_calendarios" style="display:block;">
          <div class="muted" style="margin-bottom:8px;">Gere calendários de pagamentos e recebimentos para o período selecionado.</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <button id="btnCalPag" class="btn btn-outline">Gerar Calendário de Pagamentos</button>
            <button id="btnCalRec" class="btn btn-outline">Gerar Calendário de Recebimentos</button>
          </div>
        </div>
      </div>

      <div class="card area" data-area-id="operacionais">
        <div class="toolbar" style="justify-content:space-between;">
          <h3>Relatórios Operacionais</h3>
          <button class="btn btn-outline" data-toggle="operacionais">Mostrar/Ocultar</button>
        </div>
        <div class="area-body" id="areaBody_operacionais" style="display:block;">
          <div class="muted" style="margin-bottom:8px;">Gere relações de Recebimentos e Pagamentos separadas dos calendários.</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
            <span class="muted" style="margin-right:8px;">Filtros abaixo se aplicam somente aos relatórios operacionais.</span>
            <label style="display:inline-flex;align-items:center;gap:6px;">
              Status (Rec)
              <select id="opStatusRec" style="width:140px;">
                <option value="todos" selected>Todos</option>
                <option value="pendente">Pendente</option>
                <option value="recebido">Recebido</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;">
              Tipo (Rec)
              <select id="opTipoRec" style="width:140px;">
                <option value="todos" selected>Todos</option>
                <option value="mensal">Mensal</option>
                <option value="avulso">Avulso</option>
                <option value="parcelado">Parcelado</option>
              </select>
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;">
              Status (Pag)
              <select id="opStatusPag" style="width:140px;">
                <option value="todos" selected>Todos</option>
                <option value="pendente">Pendente</option>
                <option value="pago">Pago</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;">
              Tipo (Pag)
              <select id="opTipoPag" style="width:140px;">
                <option value="todos" selected>Todos</option>
                <option value="fixo">Fixo</option>
                <option value="avulso">Avulso</option>
                <option value="parcelado">Parcelado</option>
              </select>
            </label>
            <button id="btnRelRec" class="btn btn-outline">Relação de Recebimentos</button>
            <button id="btnRelRecCSV" class="btn btn-outline">Exportar CSV (Recebimentos)</button>
            <button id="btnRelPag" class="btn btn-outline">Relação de Pagamentos</button>
            <button id="btnRelPagCSV" class="btn btn-outline">Exportar CSV (Pagamentos)</button>
          </div>
        </div>
      </div>

      <div class="card area" data-area-id="fluxo">
        <div class="toolbar" style="justify-content:space-between;">
          <h3>Fluxo de Caixa</h3>
          <button class="btn btn-outline" data-toggle="fluxo">Mostrar/Ocultar</button>
        </div>
        <div class="area-body" id="areaBody_fluxo" style="display:block;">
          <div class="muted" style="margin-bottom:8px;">Gere o fluxo de caixa (sintético ou analítico). Os controles abaixo se aplicam a ambos os botões.</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
            <label style="display:inline-flex;align-items:center;gap:6px;">
              Saldo Inicial
              <input type="number" id="saldoInicial" step="0.01" value="0" style="width:140px;" />
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;">
              Tipo de Relatório
              <select id="tipoRelatorio" style="width:140px;">
                <option value="sintetico" selected>Sintético</option>
                <option value="analitico">Analítico</option>
              </select>
            </label>
            <button id="btnFluxo" class="btn btn-outline">Gerar Fluxo de Caixa</button>
            <button id="btnFluxoCat" class="btn btn-outline">Gerar fluxo de caixa por categorias</button>
          </div>
        </div>
      </div>

      <div class="card area" data-area-id="gerenciais">
        <div class="toolbar" style="justify-content:space-between;">
          <h3>Relatórios Gerenciais</h3>
          <button class="btn btn-outline" data-toggle="gerenciais">Mostrar/Ocultar</button>
        </div>
        <div class="area-body" id="areaBody_gerenciais" style="display:block;">
          <div class="muted" style="margin-bottom:8px;">Evolução mensal das Receitas x Despesas no período selecionado.</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
            <label style="display:inline-flex;align-items:center;gap:6px;">
              Saldo Inicial
              <input type="number" id="saldoInicialGer" step="0.01" value="0" style="width:140px;" />
            </label>
            <button id="btnEvolucaoRecDesp" class="btn btn-outline">Evolução das Receitas x Despesas</button>
          </div>
        </div>
      </div>

      <div class="card area" data-area-id="participacao">
        <div class="toolbar" style="justify-content:space-between;">
          <h3>Participação por Cliente</h3>
          <button class="btn btn-outline" data-toggle="participacao">Mostrar/Ocultar</button>
        </div>
        <div class="area-body" id="areaBody_participacao" style="display:none;">
          <div class="muted" style="margin-bottom:8px;">Mensalidade e % de participação no período; classes por pagamento e faturamento.</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <label>Agrupar Clientes
              <select id="agrupaClientes">
                <option value="nao" selected>Não</option>
                <option value="sim">Sim</option>
              </select>
            </label>
            <button id="btnParticipacao" class="btn btn-outline">Gerar Participação por Cliente</button>
            <button id="btnParticipacaoCSV" class="btn btn-outline">Exportar CSV</button>
          </div>
          <div id="participacaoResult" class="card" style="margin-top:10px;"></div>
        </div>
      </div>

      <div class="card area" data-area-id="extras">
        <div class="toolbar" style="justify-content:space-between;">
          <h3>Relatórios adicionais</h3>
          <button class="btn btn-outline" data-toggle="extras">Mostrar/Ocultar</button>
        </div>
        <div class="area-body" id="areaBody_extras" style="display:none;">
          <div class="empty-state">Em breve: novos relatórios e exportações.</div>
        </div>
      </div>
    </div>
  `;

  // Inicializa período padrão: mês atual
  const dtInicio = document.getElementById('dtInicio');
  const dtFim = document.getElementById('dtFim');
  const now = new Date();
  const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const lastDayDate = new Date(now.getFullYear(), now.getMonth()+1, 0);
  const lastDay = `${lastDayDate.getFullYear()}-${String(lastDayDate.getMonth()+1).padStart(2,'0')}-${String(lastDayDate.getDate()).padStart(2,'0')}`;
  dtInicio.value = firstDay;
  dtFim.value = lastDay;

  // persistir escolha de campo de data
  const campoSel = document.getElementById('campoData');
  const campoLabelText = document.getElementById('lblCampoDataText');
  const optPag = campoSel.querySelector('option[value="data_pagamento"]');
  const setCampoDataLabels = (tipo) => {
    if (tipo === 'recebimentos') {
      optPag.textContent = 'Por Recebimento';
      campoLabelText.textContent = 'Campo de data (Receitas)';
    } else {
      optPag.textContent = 'Por Pagamento';
      campoLabelText.textContent = 'Campo de data (Pagamentos)';
    }
  };
  setCampoDataLabels('pagamentos');
  window._campoDataRelatorios = campoSel.value;
  campoSel.addEventListener('change', () => { window._campoDataRelatorios = campoSel.value; });

  // Controle de expansão de áreas (persistência)
  const lsKey = 'REL_SECTIONS_OPEN';
  const openSet = new Set(JSON.parse(localStorage.getItem(lsKey) || '[]'));
  function applyOpenState() {
    ['calendarios','operacionais','fluxo','gerenciais','participacao','extras'].forEach(id => {
      const body = document.getElementById(`areaBody_${id}`);
      if (!body) return;
      body.style.display = openSet.has(id) ? 'block' : 'none';
    });
  }
  function toggleArea(id) {
    if (openSet.has(id)) openSet.delete(id); else openSet.add(id);
    localStorage.setItem(lsKey, JSON.stringify(Array.from(openSet)));
    applyOpenState();
  }
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => toggleArea(btn.getAttribute('data-toggle')));
  });
  // inicializa (default: mostrar todas se nenhuma preferência)
  if (openSet.size === 0) { ['calendarios','operacionais','fluxo','gerenciais'].forEach(id => openSet.add(id)); localStorage.setItem(lsKey, JSON.stringify(Array.from(openSet))); }
  applyOpenState();

  // Eventos dos botões de topo
  document.getElementById('btnCalPag').addEventListener('click', async () => {
    setCampoDataLabels('pagamentos');
    const dtInicio = document.getElementById('dtInicio').value;
    const dtFim = document.getElementById('dtFim').value;
    window._campoDataRelatorios = document.getElementById('campoData').value;
    try { await gerarCalendarioPagamentosPDF(dtInicio, dtFim); } catch (e) { console.error(e); showToast('Falha ao gerar PDF', 'error'); }
  });
  document.getElementById('btnCalRec').addEventListener('click', async () => {
    setCampoDataLabels('recebimentos');
    const dtInicio = document.getElementById('dtInicio').value;
    const dtFim = document.getElementById('dtFim').value;
    window._campoDataRelatorios = document.getElementById('campoData').value;
    try { await gerarCalendarioRecebimentosPDF(dtInicio, dtFim); } catch (e) { console.error(e); showToast('Falha ao gerar PDF', 'error'); }
  });

  // Botões de Relatórios Operacionais
  document.getElementById('btnRelRec').addEventListener('click', async () => {
    setCampoDataLabels('recebimentos');
    const dtInicio = document.getElementById('dtInicio').value;
    const dtFim = document.getElementById('dtFim').value;
    window._campoDataRelatorios = document.getElementById('campoData').value;
    const filters = {
      status: document.getElementById('opStatusRec')?.value || 'todos',
      tipo: document.getElementById('opTipoRec')?.value || 'todos',
    };
    try { await gerarRelacaoRecebimentosPDF(dtInicio, dtFim, filters); } catch (e) { console.error(e); showToast('Falha ao gerar PDF', 'error'); }
  });
  document.getElementById('btnRelPag').addEventListener('click', async () => {
    setCampoDataLabels('pagamentos');
    const dtInicio = document.getElementById('dtInicio').value;
    const dtFim = document.getElementById('dtFim').value;
    window._campoDataRelatorios = document.getElementById('campoData').value;
    const filters = {
      status: document.getElementById('opStatusPag')?.value || 'todos',
      tipo: document.getElementById('opTipoPag')?.value || 'todos',
    };
    try { await gerarRelacaoPagamentosPDF(dtInicio, dtFim, filters); } catch (e) { console.error(e); showToast('Falha ao gerar PDF', 'error'); }
  });
  document.getElementById('btnRelRecCSV').addEventListener('click', async () => {
    setCampoDataLabels('recebimentos');
    const startStr = document.getElementById('dtInicio').value;
    const endStr = document.getElementById('dtFim').value;
    window._campoDataRelatorios = document.getElementById('campoData').value;
    try {
      const filters = {
        status: document.getElementById('opStatusRec')?.value || 'todos',
        tipo: document.getElementById('opTipoRec')?.value || 'todos',
      };
      const rows = await buildRelacaoRecebimentosCSV(startStr, endStr, filters);
      exportToCSV(`relacao_recebimentos_${startStr}_a_${endStr}.csv`, rows);
      showToast('CSV de relação de recebimentos exportado', 'success');
    } catch (e) { console.error(e); showToast('Falha ao exportar CSV', 'error'); }
  });
  document.getElementById('btnRelPagCSV').addEventListener('click', async () => {
    setCampoDataLabels('pagamentos');
    const startStr = document.getElementById('dtInicio').value;
    const endStr = document.getElementById('dtFim').value;
    window._campoDataRelatorios = document.getElementById('campoData').value;
    try {
      const filters = {
        status: document.getElementById('opStatusPag')?.value || 'todos',
        tipo: document.getElementById('opTipoPag')?.value || 'todos',
      };
      const rows = await buildRelacaoPagamentosCSV(startStr, endStr, filters);
      exportToCSV(`relacao_pagamentos_${startStr}_a_${endStr}.csv`, rows);
      showToast('CSV de relação de pagamentos exportado', 'success');
    } catch (e) { console.error(e); showToast('Falha ao exportar CSV', 'error'); }
  });

  document.getElementById('btnFluxo').addEventListener('click', async () => {
    const dtInicioVal = document.getElementById('dtInicio').value;
    const dtFimVal = document.getElementById('dtFim').value;
    const saldoInicial = Number(document.getElementById('saldoInicial').value || 0);
    const tipoRelatorio = document.getElementById('tipoRelatorio').value;
    window._campoDataRelatorios = document.getElementById('campoData').value;
    try { await gerarFluxoCaixaPDF(dtInicioVal, dtFimVal, saldoInicial, tipoRelatorio); } catch (e) { console.error(e); showToast('Falha ao gerar fluxo de caixa em PDF', 'error'); }
  });

  document.getElementById('btnFluxoCat').addEventListener('click', async () => {
    const dtInicioVal = document.getElementById('dtInicio').value;
    const dtFimVal = document.getElementById('dtFim').value;
    const saldoInicial = Number(document.getElementById('saldoInicial').value || 0);
    const tipoRelatorio = document.getElementById('tipoRelatorio').value;
    window._campoDataRelatorios = document.getElementById('campoData').value;
    try { await gerarFluxoCaixaPorCategoriasPDF(dtInicioVal, dtFimVal, saldoInicial, tipoRelatorio); } catch (e) { console.error(e); showToast('Falha ao gerar fluxo por categorias em PDF', 'error'); }
  });

  // Relatórios Gerenciais – Evolução Receitas x Despesas
  const btnEvolucao = document.getElementById('btnEvolucaoRecDesp');
  if (btnEvolucao) btnEvolucao.addEventListener('click', async () => {
    const startStr = document.getElementById('dtInicio').value;
    const endStr = document.getElementById('dtFim').value;
    const saldoInicial = Number(document.getElementById('saldoInicialGer').value || 0);
    window._campoDataRelatorios = document.getElementById('campoData').value;
    try { await gerarEvolucaoReceitasDespesasPDF(startStr, endStr, saldoInicial); } catch (e) { console.error(e); showToast('Falha ao gerar relatório gerencial', 'error'); }
  });

  // Participação por Cliente – eventos
  const btnPart = document.getElementById('btnParticipacao');
  const btnPartCSV = document.getElementById('btnParticipacaoCSV');
  const resultEl = document.getElementById('participacaoResult');
  async function gerarParticipacaoUI() {
    const startStr = document.getElementById('dtInicio').value;
    const endStr = document.getElementById('dtFim').value;
    window._campoDataRelatorios = document.getElementById('campoData').value;
    const agrupa = (document.getElementById('agrupaClientes')?.value === 'sim');
    try {
      const dados = await calcularParticipacaoPorCliente(startStr, endStr, agrupa);
      renderParticipacaoTabela(resultEl, dados);
      window._lastParticipacaoRows = dados?.rowsCSV || [];
      showToast('Participação por Cliente gerada', 'success');
    } catch (e) { console.error(e); showToast('Falha ao gerar Participação por Cliente', 'error'); }
  }
  if (btnPart) btnPart.addEventListener('click', gerarParticipacaoUI);
  if (btnPartCSV) btnPartCSV.addEventListener('click', () => {
    const rows = window._lastParticipacaoRows || [];
    if (!rows.length) { showToast('Gere a participação antes de exportar', 'warning'); return; }
    exportToCSV(`participacao_por_cliente_${document.getElementById('dtInicio').value}_a_${document.getElementById('dtFim').value}.csv`, rows);
  });
}

// Helper to abbreviate common words and truncate descriptions for calendar cells
function shortenForCalendar(text) {
  let t = (text || '').trim();
  if (!t) return '—';
  // Abbreviation rules (case-insensitive)
  const rules = [
    [/\bdespesa(s)?\b/gi, 'DESP.'],
    [/\badministrativ[ao]s?\b/gi, 'ADM.'],
    [/\bescritorio\b/gi, 'ESCR.'],
    [/\bmensalidade(s)?\b/gi, 'MENS.'],
    [/\baluguel\b/gi, 'ALUG.'],
    [/\bimposto(s)?\b/gi, 'IMP.'],
    [/\bservic[oó]s?\b/gi, 'SERV.'],
    [/\bconta(s)?\b/gi, 'CTA.']
  ];
  for (const [re, rep] of rules) {
    t = t.replace(re, rep);
  }
  const maxChars = 32; // default truncation length for calendar
  if (t.length > maxChars) {
    t = t.slice(0, maxChars - 3) + '...';
  }
  return t;
}

// Função para gerar PDF de Fluxo de Caixa Analítico (linha a linha)
async function gerarFluxoCaixaAnalitico(doc, startStr, endStr, saldoInicial, recebimentos, pagamentos, recDateField, pagDateField, parseDate, inRange, blue, red, margin, pageWidth, pageHeight, mapCli, mapForn) {
  // Título
  doc.setTextColor(...blue); doc.setFontSize(18);
  const fmtDMY = s => { if (!s) return '—'; const [y,m,d] = String(s).split('-'); return `${d}-${m}-${y}`; };
  doc.text(`Fluxo de Caixa Analítico - ${fmtDMY(startStr)} a ${fmtDMY(endStr)}`, pageWidth/2, margin + 10, { align: 'center' });

  // Coletar todas as transações no período
  const transacoes = [];
  
  // Adicionar recebimentos
  (recebimentos||[]).forEach(r => {
    const ds = r[recDateField];
    if (inRange(ds)) {
      const valor = (r.status === 'recebido') ? (r.valor_recebido || 0) : (r.valor_esperado || 0);
      if (valor > 0) {
        transacoes.push({
          data: ds,
          tipo: 'Recebimento',
          nome: (mapCli?.get?.(r.cliente_id) || '—'),
          descricao: r.descricao || 'Recebimento',
          valor: valor,
          status: r.status || 'pendente'
        });
      }
    }
  });

  // Adicionar pagamentos
  (pagamentos||[]).forEach(p => {
    const ds = p[pagDateField];
    if (inRange(ds)) {
      const valor = (p.status === 'pago') ? (p.valor_pago || 0) : (p.valor_esperado || 0);
      if (valor > 0) {
        transacoes.push({
          data: ds,
          tipo: 'Pagamento',
          nome: (mapForn?.get?.(p.fornecedor_id) || '—'),
          descricao: p.descricao || 'Pagamento',
          valor: -valor,
          status: p.status || 'pendente'
        });
      }
    }
  });

  // Ordenar por data
  transacoes.sort((a, b) => a.data.localeCompare(b.data));

  // Cabeçalho da tabela
  const cols = [
    { label: 'Data', width: 70 },
    { label: 'Tipo', width: 40 },
    { label: 'Nome', width: 170 },
    { label: 'Descrição', width: 250 },
    { label: 'Valor', width: 85 },
    { label: 'Status', width: 60 },
    { label: 'Saldo Acumulado', width: 115 }
  ];
  
  const colX = []; 
  let acc = margin; 
  for (let i = 0; i < cols.length; i++) { 
    colX.push(acc); 
    acc += cols[i].width; 
  }
  
  const tableTop = margin + 34;
  doc.setFontSize(11); doc.setTextColor(...blue);
  for (let i = 0; i < cols.length; i++) { 
    doc.text(cols[i].label, colX[i] + 3, tableTop); 
  }
  doc.setDrawColor(...blue); 
  doc.line(margin, tableTop + 4, pageWidth - margin, tableTop + 4);

  let yList = tableTop + 16;
  doc.setTextColor(0,0,0); doc.setFontSize(10);
  let saldoAcum = Number(saldoInicial || 0);

  // Helpers para layout
  const fitText = (txt, maxW) => {
    const lines = doc.splitTextToSize(String(txt||''), Math.max(10, maxW - 6));
    const first = (Array.isArray(lines) && lines.length > 0) ? lines[0] : String(txt||'');
    return first;
  };
  const abbrStatus = (s) => {
    const m = { recebido: 'rec', pendente: 'pend', cancelado: 'canc', pago: 'pago' };
    const k = String(s||'').toLowerCase();
    return m[k] || (s || '—');
  };

  // Função para garantir cabeçalho em nova página
  const ensureHeader = () => {
    doc.setTextColor(...blue); doc.setFontSize(18);
    doc.text(`Fluxo de Caixa Analítico - ${fmtDMY(startStr)} a ${fmtDMY(endStr)}`, pageWidth/2, margin + 10, { align: 'center' });
    doc.setFontSize(11); doc.setTextColor(...blue);
    for (let i = 0; i < cols.length; i++) { 
      doc.text(cols[i].label, colX[i] + 3, tableTop); 
    }
    doc.setDrawColor(...blue); 
    doc.line(margin, tableTop + 4, pageWidth - margin, tableTop + 4);
    doc.setTextColor(0,0,0); doc.setFontSize(10);
  };

  // Renderizar transações com subtotal diário
  let currentDay = null;
  let entradasDia = 0;
  let saídasDia = 0;

  const renderSubtotal = () => {
    if (!currentDay) return;
    if (yList > pageHeight - 60) {
      doc.addPage();
      yList = tableTop + 16;
      ensureHeader();
    }
    doc.setTextColor(...blue); doc.setFontSize(10);
    doc.text(fmtDMY(currentDay), colX[0] + 3, yList);
    doc.text('Subtotal do dia', colX[1] + 3, yList);
    doc.text('—', colX[2] + 3, yList);
    const descSub = `Entradas: ${formatCurrency(entradasDia)} | Saídas: ${formatCurrency(saídasDia)}`;
    doc.text(descSub, colX[3] + 3, yList);
    doc.text('—', colX[4] + 3, yList);
    doc.text('—', colX[5] + 3, yList);
    doc.setTextColor(...(saldoAcum >= 0 ? [0, 128, 0] : red));
    doc.text(formatCurrency(saldoAcum), colX[6] + cols[6].width - 3, yList, { align: 'right' });
    doc.setTextColor(0,0,0); doc.setFontSize(10);
    yList += 16;
    entradasDia = 0; saídasDia = 0;
  };

  for (const t of transacoes) {
    // Se mudou o dia, imprime subtotal do dia anterior
    if (currentDay && t.data !== currentDay) {
      renderSubtotal();
    }
    if (!currentDay) currentDay = t.data; else currentDay = t.data;

    if (yList > pageHeight - 60) {
      doc.addPage();
      yList = tableTop + 16;
      ensureHeader();
    }

    saldoAcum += t.valor;

    // Acumular subtotais do dia
    if (t.valor >= 0) entradasDia += t.valor; else saídasDia += (-t.valor);
    
    // Destacar linhas com saldo negativo
    if (saldoAcum < 0) {
      doc.setFillColor(255, 240, 240);
      doc.rect(margin, yList - 12, pageWidth - margin * 2, 14, 'F');
    }

    doc.text(fmtDMY(t.data), colX[0] + 3, yList);
    doc.text(t.tipo === 'Pagamento' ? 'P' : 'R', colX[1] + 3, yList);
    doc.text(fitText(t.nome || '—', cols[2].width), colX[2] + 3, yList);
    
    // Ajuste de descrição para caber na coluna
    const desc = fitText(t.descricao || '—', cols[3].width);
    doc.text(desc, colX[3] + 3, yList);
    
    // Valor com cor (verde para positivo, vermelho para negativo) e alinhado à direita
    doc.setTextColor(...(t.valor >= 0 ? [0, 128, 0] : red));
    doc.text(formatCurrency(Math.abs(t.valor)), colX[4] + cols[4].width - 3, yList, { align: 'right' });
    
    doc.setTextColor(0,0,0);
    doc.text(abbrStatus(t.status), colX[5] + 3, yList);
    
    // Saldo acumulado com cor (alinhado à direita)
    doc.setTextColor(...(saldoAcum >= 0 ? [0, 128, 0] : red));
    doc.text(formatCurrency(saldoAcum), colX[6] + cols[6].width - 3, yList, { align: 'right' });
    doc.setTextColor(0,0,0);

    yList += 16;
  }

  // Subtotal do último dia
  renderSubtotal();

  // Linha de saldo inicial se não há transações
  if (transacoes.length === 0) {
    doc.text('Nenhuma transação no período', colX[2] + 3, yList);
    doc.setTextColor(saldoAcum >= 0 ? [0, 128, 0] : red);
    doc.text(formatCurrency(saldoAcum), colX[5] + 3, yList);
    doc.setTextColor(0,0,0);
  }

  // Salvar PDF
  doc.save(`fluxo-caixa-analitico-${startStr}-${endStr}.pdf`);
}

// Função para gerar PDF de Fluxo de Caixa diário
async function gerarFluxoCaixaPDF(startStr, endStr, saldoInicial, tipoRelatorio = 'sintetico') {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { showToast('Biblioteca jsPDF não carregada', 'error'); return; }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  doc.setFont('helvetica','normal');
  const blue = [0, 64, 192];
  const red = [200, 0, 0];
  const margin = 24;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const campoSel = window._campoDataRelatorios || 'data_vencimento';
  const recDateField = (campoSel === 'data_pagamento') ? 'data_recebimento' : 'data_vencimento';
  const pagDateField = (campoSel === 'data_pagamento') ? 'data_pagamento' : 'data_vencimento';

  const { data: recebimentos } = await db.select('recebimentos', { select: 'descricao, valor_esperado, valor_recebido, status, data_vencimento, data_recebimento, cliente_id' });
  const { data: pagamentos } = await db.select('pagamentos', { select: 'descricao, valor_esperado, valor_pago, status, data_vencimento, data_pagamento, fornecedor_id' });
  const { data: clientes } = await db.select('clientes', { select: 'id, nome' });
  const { data: fornecedores } = await db.select('fornecedores', { select: 'id, nome' });
  const mapCli = new Map((clientes||[]).map(c => [c.id, c.nome]));
  const mapForn = new Map((fornecedores||[]).map(f => [f.id, f.nome]));

  const parseDate = (s) => { if (!s) return null; const [y,m,d] = s.split('-'); return new Date(Number(y), Number(m)-1, Number(d)); };
  const inRange = (s) => { const dt = parseDate(s); if (!dt) return false; const a = parseDate(startStr); const b = parseDate(endStr); return dt >= a && dt <= b; };

  const daysBetween = []; {
    const start = parseDate(startStr); const end = parseDate(endStr);
    const cur = new Date(start.getTime());
    while (cur <= end) {
      const y = cur.getFullYear(); const m = String(cur.getMonth()+1).padStart(2,'0'); const d = String(cur.getDate()).padStart(2,'0');
      daysBetween.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate()+1);
    }
  }

  const dayMap = new Map();
  daysBetween.forEach(d => dayMap.set(d, { entradas: 0, saidas: 0 }));

  // Decidir qual tipo de relatório gerar
  if (tipoRelatorio === 'analitico') {
    return await gerarFluxoCaixaAnalitico(doc, startStr, endStr, saldoInicial, recebimentos, pagamentos, recDateField, pagDateField, parseDate, inRange, blue, red, margin, pageWidth, pageHeight, mapCli, mapForn);
  }

  // Continuar com relatório sintético (código atual)

  (recebimentos||[]).forEach(r => {
    const ds = r[recDateField];
    if (!ds || !inRange(ds)) return;
    const val = Number(recDateField === 'data_recebimento' ? (r.valor_recebido || 0) : (r.valor_esperado || 0));
    const day = dayMap.get(ds); if (day) day.entradas += val;
  });
  (pagamentos||[]).forEach(p => {
    const ds = p[pagDateField];
    if (!ds || !inRange(ds)) return;
    const val = Number(pagDateField === 'data_pagamento' ? (p.valor_pago || 0) : (p.valor_esperado || 0));
    const day = dayMap.get(ds); if (day) day.saidas += val;
  });

  // Título
  doc.setTextColor(...blue); doc.setFontSize(18);
  const fmtDMY = s => { if (!s) return '—'; const [y,m,d] = String(s).split('-'); return `${d}-${m}-${y}`; };
  doc.text(`Fluxo de Caixa - ${fmtDMY(startStr)} a ${fmtDMY(endStr)}`, pageWidth/2, margin + 10, { align: 'center' });

  // Tabela
  const cols = [
    { label: 'Data', width: 100 },
    { label: 'Entradas', width: 120 },
    { label: 'Saídas', width: 120 },
    { label: 'Saldo do dia', width: 120 },
    { label: 'Saldo acumulado', width: 140 },
  ];
  const colX = []; { let acc = margin; for (let i = 0; i < cols.length; i++) { colX.push(acc); acc += cols[i].width; } }
  const tableTop = margin + 34;
  doc.setFontSize(11); doc.setTextColor(...blue);
  for (let i = 0; i < cols.length; i++) { doc.text(cols[i].label, colX[i] + 3, tableTop); }
  doc.setDrawColor(...blue); doc.line(margin, tableTop + 4, pageWidth - margin, tableTop + 4);

  let yList = tableTop + 16;
  doc.setTextColor(0,0,0); doc.setFontSize(10);

  let saldoAcum = Number(saldoInicial || 0);
  const totalEntradas = { v: 0 }; const totalSaidas = { v: 0 };
  const saldoSeries = []; let minSaldo = saldoAcum; let maxSaldo = saldoAcum;

  const ensureHeader = () => {
    doc.setTextColor(...blue); doc.setFontSize(18);
    doc.text(`Fluxo de Caixa - ${formatDate(startStr)} a ${formatDate(endStr)}`, pageWidth/2, margin + 10, { align: 'center' });
    doc.setFontSize(11); doc.setTextColor(...blue);
    for (let i = 0; i < cols.length; i++) { doc.text(cols[i].label, colX[i] + 3, tableTop); }
    doc.setDrawColor(...blue); doc.line(margin, tableTop + 4, pageWidth - margin, tableTop + 4);
    doc.setTextColor(0,0,0); doc.setFontSize(10);
    yList = tableTop + 16;
  };

  let negativeDays = 0;
  let firstNegativeDate = null;

  for (let i = 0; i < daysBetween.length; i++) {
    const ds = daysBetween[i];
    const dm = dayMap.get(ds) || { entradas: 0, saidas: 0 };
    const entradas = Number(dm.entradas || 0);
    const saidas = Number(dm.saidas || 0);
    totalEntradas.v += entradas; totalSaidas.v += saidas;
    const saldoDia = entradas - saidas;
    saldoAcum += saldoDia;

    if (yList + 18 > pageHeight - margin) { doc.addPage('a4','landscape'); ensureHeader(); }

    // Destaque visual para saldo negativo (fundo e borda vermelha)
    if (saldoAcum >= 0 && i % 2 === 1) {
      doc.setFillColor(245,245,245);
      doc.rect(margin, yList - 2, (pageWidth - margin) - margin, 18 + 4, 'F');
    }

    const [y,m,d] = ds.split('-'); const fmt = `${d}-${m}-${y}`;
    doc.text(fmt, colX[0] + 3, yList + 12);
    doc.text(formatCurrency(entradas), colX[1] + 3, yList + 12);
    doc.text(formatCurrency(saidas), colX[2] + 3, yList + 12);
    doc.text(formatCurrency(saldoDia), colX[3] + 3, yList + 12);

    if (saldoAcum < 0) { doc.setTextColor(...red); negativeDays++; if (!firstNegativeDate) firstNegativeDate = fmt; }
    doc.text(formatCurrency(saldoAcum), colX[4] + 3, yList + 12);
    doc.setTextColor(0,0,0);

    // Série para gráfico
    saldoSeries.push({ date: ds, value: saldoAcum });
    if (saldoAcum < minSaldo) minSaldo = saldoAcum;
    if (saldoAcum > maxSaldo) maxSaldo = saldoAcum;

    yList += 22;
  }

  // Rodapé resumo
  const footerY = pageHeight - margin - 6;
  doc.setTextColor(...blue); doc.setFontSize(10);
  doc.text(`Saldo inicial: ${formatCurrency(saldoInicial)} | Entradas: ${formatCurrency(totalEntradas.v)} | Saídas: ${formatCurrency(totalSaidas.v)} | Saldo final: ${formatCurrency(saldoAcum)}`,
    margin, footerY);
  if (negativeDays > 0) {
    doc.setTextColor(...red);
    doc.text(`Dias com saldo negativo: ${negativeDays} (primeiro: ${firstNegativeDate})`, margin, footerY - 16);
    doc.setTextColor(...blue);
  }

  // Página de gráfico e insights
    doc.addPage();
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    
    // Título único da segunda página
    doc.setTextColor(...blue); 
    doc.setFontSize(16);
    doc.text('Gráfico - Saldo Acumulado no Período', pw/2, margin + 20, { align: 'center' });

    // Desenhar gráfico de linha (saldo acumulado)
    const chartLeft = margin;
    const chartTop = margin + 40;
    const chartWidth = pw - margin * 2;
    const chartHeight = 180;
    doc.setLineWidth(1);
    // Moldura do gráfico e eixos
    doc.setDrawColor(150,150,150);
    doc.rect(chartLeft, chartTop, chartWidth, chartHeight, 'S');
    doc.line(chartLeft, chartTop + chartHeight, chartLeft + chartWidth, chartTop + chartHeight); // eixo X
    doc.line(chartLeft, chartTop, chartLeft, chartTop + chartHeight); // eixo Y

    if (!saldoSeries || saldoSeries.length === 0) {
      doc.setTextColor(120,120,120); doc.setFontSize(12);
      doc.text('Sem dados no período selecionado', chartLeft + 10, chartTop + chartHeight/2);
    } else {
      const range = (maxSaldo - minSaldo);
      const safeRange = range === 0 ? (Math.abs(maxSaldo) + Math.abs(minSaldo) || 1) : range;
      const zeroY = chartTop + chartHeight - ((0 - minSaldo) / safeRange) * chartHeight;
      // Linha zero
      doc.setDrawColor(200,200,200); doc.setLineWidth(0.8);
      doc.line(chartLeft, zeroY, chartLeft + chartWidth, zeroY);

      const stepX = saldoSeries.length > 1 ? chartWidth / (saldoSeries.length - 1) : chartWidth / 2;
      let prevX = null, prevY = null;
      doc.setDrawColor(...blue); doc.setLineWidth(1.2);
      for (let i = 0; i < saldoSeries.length; i++) {
        const x = chartLeft + i * stepX;
        const val = saldoSeries[i].value;
        const y = chartTop + chartHeight - ((val - minSaldo) / safeRange) * chartHeight;
        if (prevX !== null) { doc.line(prevX, prevY, x, y); }
        prevX = x; prevY = y;
        // Marcador no ponto (fallback se circle não existir)
        if (val < 0) { doc.setFillColor(200,0,0); } else { doc.setFillColor(0,64,192); }
        if (typeof doc.circle === 'function') { doc.circle(x, y, 2.2, 'F'); }
        else { doc.rect(x - 2, y - 2, 4, 4, 'F'); }
      }

      // Rótulos mínimo/máximo e final
      doc.setTextColor(0,0,0); doc.setFontSize(10);
      doc.text(`Min: ${formatCurrency(minSaldo)}`, chartLeft, chartTop - 6);
      doc.text(`Max: ${formatCurrency(maxSaldo)}`, chartLeft + chartWidth - 120, chartTop - 6);
      const finalVal = (saldoSeries.length > 0) ? saldoSeries[saldoSeries.length - 1].value : saldoAcum;
      doc.text(`Final: ${formatCurrency(finalVal)}`, chartLeft + chartWidth - 120, chartTop + chartHeight + 14);
    }
    
    // Insights
    doc.setTextColor(...blue); doc.setFontSize(16);
    const insightsTitleY = chartTop + chartHeight + 40;
    doc.text('Insights para decisão de caixa', pw/2, insightsTitleY, { align: 'center' });
    doc.setTextColor(0,0,0); doc.setFontSize(12);
    const insights = [
      '- Se o saldo ficar negativo em algum dia, replanejar pagamentos imediatos (adiar ou parcelar).',
      '- Antecipar recebíveis ou negociar prazos com fornecedores para suavizar picos de saída.',
      '- Avaliar compras futuras e parceladas conforme a curva do saldo acumulado.',
      '- Considerar uso de "Por Vencimento" para previsão e "Por Pagamento/Recebimento" para realizado.',
      '- Concentrar pagamentos em dias com saldo alto e evitar em dias críticos.',
    ];
    let yI = insightsTitleY + 24; const lh = 16;
    insights.forEach(txt => { doc.text(txt, margin, yI); yI += lh; });

    const fname = `fluxo_caixa_${startStr}_a_${endStr}.pdf`;
    doc.save(fname);
    showToast('Fluxo de caixa gerado em PDF', 'success');
  }

// Fluxo de Caixa por Categoria – Sintético/Analítico
async function gerarFluxoCaixaPorCategoriasPDF(startStr, endStr, saldoInicial, tipoRelatorio = 'sintetico') {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { showToast('Biblioteca jsPDF não carregada', 'error'); return; }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  doc.setFont('helvetica','normal');
  const blue = [0, 64, 192];
  const red = [200, 0, 0];
  const margin = 24;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const campoSel = window._campoDataRelatorios || 'data_vencimento';
  const recDateField = (campoSel === 'data_pagamento') ? 'data_recebimento' : 'data_vencimento';
  const pagDateField = (campoSel === 'data_pagamento') ? 'data_pagamento' : 'data_vencimento';
  // Expandimos seleção para suportar analítico (descrição e contraparte)
  const { data: recebimentos } = await db.select('recebimentos', { select: 'categoria_id, descricao, valor_esperado, valor_recebido, status, data_vencimento, data_recebimento, cliente_id' });
  const { data: pagamentos } = await db.select('pagamentos', { select: 'categoria_id, descricao, valor_esperado, valor_pago, status, data_vencimento, data_pagamento, fornecedor_id' });
  const { data: categorias } = await db.select('categorias', { select: 'id, nome, tipo' });
  const { data: clientes } = await db.select('clientes', { select: 'id, nome' });
  const { data: fornecedores } = await db.select('fornecedores', { select: 'id, nome' });
  const mapCli = new Map((clientes||[]).map(c => [c.id, c.nome]));
  const mapForn = new Map((fornecedores||[]).map(f => [f.id, f.nome]));
  const nomeCategoria = (id) => (categorias||[]).find(c => c.id === id)?.nome || '—';
  const tipoCategoria = (id) => (categorias||[]).find(c => c.id === id)?.tipo || null;

  const parseDate = (s) => { if (!s) return null; const [y,m,d] = s.split('-'); return new Date(Number(y), Number(m)-1, Number(d)); };
  const inRange = (s) => { const dt = parseDate(s); if (!dt) return false; const a = parseDate(startStr); const b = parseDate(endStr); return dt >= a && dt <= b; };

  // Se o tipo for analítico, gerar relatório detalhado e sair
  if (tipoRelatorio === 'analitico') {
    const fmtDMY = s => { if (!s) return '—'; const [y,m,d] = String(s).split('-'); return `${d}/${m}/${y}`; };
    // Cabeçalho
    doc.setTextColor(0,0,0); doc.setFontSize(16);
    doc.text('FLUXO DE CAIXA POR CATEGORIA – ANALÍTICO', margin, margin + 6);
    doc.setFontSize(10);
    doc.text(`Periodo ${fmtDMY(startStr)} a ${fmtDMY(endStr)}`, margin, margin + 22);
    const campoLabel = (campoSel === 'data_vencimento') ? 'Por Vencimento' : 'Por Pagamento';
    doc.text(`Campo de data: ${campoLabel}`, margin, margin + 36);
    // Saldo inicial à direita
    doc.setFontSize(11); doc.setTextColor(0,0,0);
    const saldoIniStr = `Saldo inicial  ${formatCurrency(saldoInicial)}`;
    doc.text(saldoIniStr, pageWidth - margin - doc.getTextWidth(saldoIniStr), margin + 22);

    // Layout em tabela sem bordas visíveis, fonte menor
    const valueColWidth = 120; // coluna de valores fixa à direita
    const col1X = margin;
    const col2X = pageWidth - margin - valueColWidth; // início da coluna de valor
    let y = margin + 50;
    const rowHeight = 16; // altura consistente por linha
    const tableWidth = pageWidth - margin * 2;
    const contentWidth = tableWidth - valueColWidth;
    // Larguras: Descricao, Fornecedor/Cliente, Data, Status (somam contentWidth)
    const descW = Math.floor(contentWidth * 0.40); // ~40%
    const partyW = Math.floor(contentWidth * 0.33); // ~33%
    const dataW = Math.floor(contentWidth * 0.15); // ~15% (mais espaço)
    const statusW = contentWidth - descW - partyW - dataW; // ~12% (leva o Status mais à direita)
    const colX = [col1X, col1X + descW, col1X + descW + partyW, col1X + descW + partyW + dataW, col2X];
    const pad = 6;
    const truncateToWidth = (txt, maxW) => {
      let t = String(txt || '—');
      if (doc.getTextWidth(t) <= maxW) return t;
      const ell = '…';
      while (t.length > 1 && doc.getTextWidth(t + ell) > maxW) { t = t.slice(0, -1); }
      return t + ell;
    };
    const drawSectionBand = (sectionColor) => {
      // Faixa suave para cabeçalho de seção
      const bandColor = (sectionColor === blue) ? [240,248,255] : [255,240,240];
      doc.setFillColor(...bandColor);
      doc.rect(col1X, y - 12, tableWidth, 20, 'F');
      doc.setTextColor(...sectionColor); doc.setFontSize(11);
      doc.setFont('helvetica','bold');
      doc.text(sectionColor === blue ? 'Receitas' : 'Despesas', col1X + pad, y);
      doc.setFont('helvetica','normal');
      doc.setTextColor(0,0,0); doc.setFontSize(9);
      y += 20;
    };
    const drawTableHeader = () => {
      doc.setFont('helvetica','bold'); doc.setFontSize(10);
      doc.text('Descricao', colX[0] + pad, y);
      doc.text('Fornecedor / Cliente', colX[1] + pad, y);
      doc.text('Data', colX[2] + pad, y);
      doc.text('Status', colX[3] + pad, y);
      doc.text('Valor', colX[4] + valueColWidth - pad, y, { align: 'right' });
      doc.setFont('helvetica','normal');
      y += 14;
    };
    const ensurePage = (sectionColor, currentCat) => {
      if (y + rowHeight > pageHeight - margin) {
        doc.addPage();
        y = margin + 24;
        drawSectionBand(sectionColor);
        drawTableHeader();
        if (currentCat) {
          // Reimprime a faixa da categoria com subtotal à direita
          doc.setFont('helvetica','bold'); doc.setFontSize(10);
          doc.setFillColor(245,245,245);
          doc.rect(col1X, y - 12, tableWidth, rowHeight, 'F');
          doc.text(currentCat.name, colX[0] + pad, y);
          if (currentCat.subtotalStr) doc.text(currentCat.subtotalStr, colX[4] + valueColWidth - pad, y, { align: 'right' });
          doc.setFont('helvetica','normal');
          y += rowHeight;
        }
      }
    };

    // Agrupamento de receitas por categoria (tipo entrada)
    const receitasPorCat = new Map();
    (recebimentos||[]).forEach(r => {
      const ds = r[recDateField];
      if (!ds || !inRange(ds)) return;
      const val = Number(recDateField === 'data_recebimento' ? (r.valor_recebido || 0) : (r.valor_esperado || 0));
      if (!(val > 0)) return;
      const tipo = tipoCategoria(r.categoria_id);
      if (tipo && String(tipo).toLowerCase() !== 'entrada') return;
      const catName = nomeCategoria(r.categoria_id);
      const arr = receitasPorCat.get(catName) || [];
      arr.push({
        descricao: r.descricao || '—',
        contraparte: mapCli.get(r.cliente_id) || '—',
        dataStr: fmtDMY(ds),
        status: r.status || '—',
        valor: val
      });
      receitasPorCat.set(catName, arr);
    });

    // Agrupamento de despesas por categoria (tipo saida)
    const despesasPorCat = new Map();
    (pagamentos||[]).forEach(p => {
      const ds = p[pagDateField];
      if (!ds || !inRange(ds)) return;
      const val = Number(pagDateField === 'data_pagamento' ? (p.valor_pago || 0) : (p.valor_esperado || 0));
      if (!(val > 0)) return;
      const tipo = tipoCategoria(p.categoria_id);
      if (tipo && String(tipo).toLowerCase() !== 'saida') return;
      const catName = nomeCategoria(p.categoria_id);
      const arr = despesasPorCat.get(catName) || [];
      arr.push({
        descricao: p.descricao || '—',
        contraparte: mapForn.get(p.fornecedor_id) || '—',
        dataStr: fmtDMY(ds),
        status: p.status || '—',
        valor: val
      });
      despesasPorCat.set(catName, arr);
    });

    const sumVals = arr => (arr||[]).reduce((a,b)=>a + (b.valor||0), 0);
    const totalReceitas = Array.from(receitasPorCat.values()).reduce((a,b)=>a + sumVals(b), 0);
    const totalDespesas = Array.from(despesasPorCat.values()).reduce((a,b)=>a + sumVals(b), 0);
    const saldoFinal = Number(saldoInicial||0) + totalReceitas - totalDespesas;

    // Seção Receitas
    drawSectionBand(blue);
    drawTableHeader();
    const receitasCats = Array.from(receitasPorCat.entries())
      .sort((a,b)=> sumVals(b[1]) - sumVals(a[1]));
    receitasCats.forEach(([catName, items]) => {
      const subtotal = sumVals(items);
      const subtotalStr = formatCurrency(subtotal);
      // Cabeçalho de categoria (faixa suave com subtotal à direita)
      doc.setFont('helvetica','bold'); doc.setFontSize(10);
      doc.setFillColor(245,245,245);
      doc.rect(col1X, y - 12, tableWidth, rowHeight, 'F');
      doc.text(catName, colX[0] + pad, y);
      doc.text(subtotalStr, colX[4] + valueColWidth - pad, y, { align: 'right' });
      doc.setFont('helvetica','normal');
      y += rowHeight;
      ensurePage(blue, { name: catName, subtotalStr });
      // Itens
      items.sort((a,b)=> a.dataStr.localeCompare(b.dataStr));
      const itemDescIndent = 12;
      items.forEach((it, idx) => {
        // zebra suave sem borda
        if (idx % 2 === 1) { doc.setFillColor(245,245,245); doc.rect(col1X, y - 12, tableWidth, rowHeight, 'F'); }
        // textos com truncamento por coluna e fonte menor
        const descTxt = truncateToWidth(it.descricao, descW - pad*2 - itemDescIndent);
        const partyTxt = truncateToWidth(it.contraparte, partyW - pad*2);
        const dateTxt = truncateToWidth(it.dataStr, dataW - pad*2);
        const statusTxt = truncateToWidth(it.status, statusW - pad*2);
        doc.text(descTxt, colX[0] + pad + itemDescIndent, y);
        doc.text(partyTxt, colX[1] + pad, y);
        doc.text(dateTxt, colX[2] + pad, y);
        doc.text(statusTxt, colX[3] + pad, y);
        doc.text(formatCurrency(it.valor), colX[4] + valueColWidth - pad, y, { align: 'right' });
        y += rowHeight;
        ensurePage(blue, { name: catName, subtotalStr });
      });
    });

    // Total Receitas (faixa suave)
    doc.setFont('helvetica','bold'); doc.setTextColor(...blue);
    doc.setFillColor(240,248,255);
    doc.rect(col1X, y - 12, tableWidth, rowHeight, 'F');
    doc.text('Total Receitas', colX[0] + pad, y);
    doc.text(formatCurrency(totalReceitas), colX[4] + valueColWidth - pad, y, { align: 'right' });
    doc.setFont('helvetica','normal'); doc.setTextColor(0,0,0);
    y += rowHeight;

    // Seção Despesas
    drawSectionBand(red);
    drawTableHeader();
    const despesasCats = Array.from(despesasPorCat.entries())
      .sort((a,b)=> sumVals(b[1]) - sumVals(a[1]));
    despesasCats.forEach(([catName, items]) => {
      const subtotal = sumVals(items);
      const subtotalStr = formatCurrency(subtotal);
      // Cabeçalho de categoria
      doc.setFont('helvetica','bold'); doc.setFontSize(10);
      doc.setFillColor(245,245,245);
      doc.rect(col1X, y - 12, tableWidth, rowHeight, 'F');
      doc.text(catName, colX[0] + pad, y);
      doc.text(subtotalStr, colX[4] + valueColWidth - pad, y, { align: 'right' });
      doc.setFont('helvetica','normal');
      y += rowHeight;
      ensurePage(red, { name: catName, subtotalStr });
      // Itens
      items.sort((a,b)=> a.dataStr.localeCompare(b.dataStr));
      const itemDescIndent2 = 12;
      items.forEach((it, idx) => {
        if (idx % 2 === 1) { doc.setFillColor(245,245,245); doc.rect(col1X, y - 12, tableWidth, rowHeight, 'F'); }
        const descTxt = truncateToWidth(it.descricao, descW - pad*2 - itemDescIndent2);
        const partyTxt = truncateToWidth(it.contraparte, partyW - pad*2);
        const dateTxt = truncateToWidth(it.dataStr, dataW - pad*2);
        const statusTxt = truncateToWidth(it.status, statusW - pad*2);
        doc.text(descTxt, colX[0] + pad + itemDescIndent2, y);
        doc.text(partyTxt, colX[1] + pad, y);
        doc.text(dateTxt, colX[2] + pad, y);
        doc.text(statusTxt, colX[3] + pad, y);
        doc.text(formatCurrency(it.valor), colX[4] + valueColWidth - pad, y, { align: 'right' });
        y += rowHeight;
        ensurePage(red, { name: catName, subtotalStr });
      });
    });

    // Total Despesas (faixa suave)
    doc.setFont('helvetica','bold'); doc.setTextColor(...red);
    doc.setFillColor(255,240,240);
    doc.rect(col1X, y - 12, tableWidth, rowHeight, 'F');
    doc.text('Total Despesas', colX[0] + pad, y);
    doc.text(formatCurrency(totalDespesas), colX[4] + valueColWidth - pad, y, { align: 'right' });
    doc.setFont('helvetica','normal'); doc.setTextColor(0,0,0);
    y += rowHeight;

    // Saldo final (faixa, sem borda) com cor condicional
    const saldoColor = (saldoFinal >= 0) ? blue : red;
    doc.setTextColor(...saldoColor); doc.setFontSize(12);
    doc.setFont('helvetica','bold');
    const bandColor = (saldoFinal >= 0) ? [240,248,255] : [255,240,240];
    doc.setFillColor(...bandColor);
    doc.rect(col1X, y - 12, tableWidth, rowHeight, 'F');
    doc.text('Saldo Final', colX[0] + pad, y);
    doc.text(formatCurrency(saldoFinal), colX[4] + valueColWidth - pad, y, { align: 'right' });
    doc.setFont('helvetica','normal'); doc.setTextColor(0,0,0);

    const fname = `fluxo-categorias-analitico_${startStr}_a_${endStr}.pdf`;
    doc.save(fname);
    showToast('Fluxo por categorias (analítico) gerado em PDF', 'success');
    return;
  }

  const receitasMap = new Map();
  (recebimentos||[]).forEach(r => {
    const ds = r[recDateField];
    if (!ds || !inRange(ds)) return;
    const val = Number(recDateField === 'data_recebimento' ? (r.valor_recebido || 0) : (r.valor_esperado || 0));
    if (val <= 0) return;
    const name = nomeCategoria(r.categoria_id);
    const tipo = tipoCategoria(r.categoria_id);
    // No schema, categorias.tipo é 'entrada' para receitas
    if (tipo && String(tipo).toLowerCase() !== 'entrada') return;
    receitasMap.set(name, (receitasMap.get(name)||0) + val);
  });

  const despesasMap = new Map();
  (pagamentos||[]).forEach(p => {
    const ds = p[pagDateField];
    if (!ds || !inRange(ds)) return;
    const val = Number(pagDateField === 'data_pagamento' ? (p.valor_pago || 0) : (p.valor_esperado || 0));
    if (val <= 0) return;
    const name = nomeCategoria(p.categoria_id);
    const tipo = tipoCategoria(p.categoria_id);
    // No schema, categorias.tipo é 'saida' para despesas
    if (tipo && String(tipo).toLowerCase() !== 'saida') return;
    despesasMap.set(name, (despesasMap.get(name)||0) + val);
  });

  const totalReceitas = Array.from(receitasMap.values()).reduce((a,b)=>a+b,0);
  const totalDespesas = Array.from(despesasMap.values()).reduce((a,b)=>a+b,0);
  const saldoFinal = Number(saldoInicial||0) + totalReceitas - totalDespesas;

  const fmtDMY = s => { if (!s) return '—'; const [y,m,d] = String(s).split('-'); return `${d}/${m}/${y}`; };
  doc.setTextColor(0,0,0); doc.setFontSize(16);
  doc.text('FLUXO DE CAIXA POR CATEGORIA – SINTETICO', margin, margin + 6);
  doc.setFontSize(10);
  doc.text(`Periodo ${fmtDMY(startStr)} a ${fmtDMY(endStr)}`, margin, margin + 22);
  const campoLabel = (campoSel === 'data_vencimento') ? 'Por Vencimento' : 'Por Pagamento';
  doc.text(`Campo de data: ${campoLabel}`, margin, margin + 36);

  // Saldo inicial à direita
  doc.setFontSize(11); doc.setTextColor(0,0,0);
  const saldoIniStr = `Saldo inicial  ${formatCurrency(saldoInicial)}`;
  doc.text(saldoIniStr, pageWidth - margin - doc.getTextWidth(saldoIniStr), margin + 22);

  // Tabela
  const valueColWidth = 160;
  const col1X = margin;
  const col2X = pageWidth - margin - valueColWidth;
  const nameIndentX = col1X + 16; // identação para categorias
  let y = margin + 48;
  const rowHeight = 14;
  const zebraWidth = pageWidth - margin * 2;
  const ensurePage = (section) => { 
    if (y + rowHeight > pageHeight - margin) { 
      doc.addPage(); 
      y = margin + 24; 
      // Reimprime título da seção
      if (section === 'receitas') { doc.setTextColor(...blue); doc.setFontSize(12); doc.text('Receitas', col1X, y); }
      else if (section === 'despesas') { doc.setTextColor(...red); doc.setFontSize(12); doc.text('Despesas', col1X, y); }
      y += 14; doc.setTextColor(0,0,0); doc.setFontSize(11);
    }
  };
  const leaderPad = 6;
  const drawLeader = (startX, endX, y) => {
    if (endX - startX <= 4) return;
    if (typeof doc.setLineDash === 'function') {
      doc.setDrawColor(180,180,180);
      doc.setLineDash([2,2], 0);
      doc.line(startX, y - 3, endX, y - 3);
      doc.setLineDash([]);
    } else {
      // Fallback: pequenos pontos
      doc.setDrawColor(180,180,180);
      const step = 4; for (let x = startX; x < endX; x += step) { if (typeof doc.circle === 'function') doc.circle(x, y - 3, 0.5, 'F'); }
    }
  };

  // Receitas
  doc.setTextColor(...blue); doc.setFontSize(12);
  doc.text('Receitas', col1X, y);
  y += 14; doc.setTextColor(0,0,0); doc.setFontSize(11);
  const receitasArr = Array.from(receitasMap.entries()).sort((a,b)=>b[1]-a[1]);
  receitasArr.forEach(([name, val], idx) => {
    // zebra line
    if (idx % 2 === 1) { doc.setFillColor(245,245,245); doc.rect(margin, y - (rowHeight - 2), zebraWidth, rowHeight, 'F'); }
    // texto
    doc.text(name, nameIndentX, y);
    const vStr = formatCurrency(val);
    // leader pontilhado entre fim do nome e coluna de valor
    const nameW = doc.getTextWidth(name);
    const startLeaderX = nameIndentX + nameW + leaderPad;
    const endLeaderX = col2X - leaderPad;
    drawLeader(startLeaderX, endLeaderX, y);
    // valor alinhado à direita
    doc.text(vStr, col2X + valueColWidth, y, { align: 'right' });
    y += rowHeight;
    ensurePage('receitas');
  });
  // Total Receitas (negrito com rótulo)
  doc.setFont('helvetica','bold'); doc.setTextColor(...blue);
  doc.text('Total Receitas', col1X, y);
  doc.text(formatCurrency(totalReceitas), col2X + valueColWidth, y, { align: 'right' });
  y += 18; doc.setFont('helvetica','normal'); doc.setTextColor(0,0,0);

  // Despesas
  doc.setTextColor(...red); doc.setFontSize(12);
  doc.text('Despesas', col1X, y);
  y += 14; doc.setTextColor(0,0,0); doc.setFontSize(11);
  const despesasArr = Array.from(despesasMap.entries()).sort((a,b)=>b[1]-a[1]);
  despesasArr.forEach(([name, val], idx) => {
    if (idx % 2 === 1) { doc.setFillColor(245,245,245); doc.rect(margin, y - (rowHeight - 2), zebraWidth, rowHeight, 'F'); }
    doc.text(name, nameIndentX, y);
    const vStr = formatCurrency(val);
    const nameW = doc.getTextWidth(name);
    const startLeaderX = nameIndentX + nameW + leaderPad;
    const endLeaderX = col2X - leaderPad;
    drawLeader(startLeaderX, endLeaderX, y);
    doc.text(vStr, col2X + valueColWidth, y, { align: 'right' });
    y += rowHeight;
    ensurePage('despesas');
  });
  // Total Despesas (negrito com rótulo)
  doc.setFont('helvetica','bold'); doc.setTextColor(...red);
  doc.text('Total Despesas', col1X, y);
  doc.text(formatCurrency(totalDespesas), col2X + valueColWidth, y, { align: 'right' });
  y += 22; doc.setFont('helvetica','normal'); doc.setTextColor(0,0,0);

  // Saldo final
  const saldoColor = (saldoFinal >= 0) ? blue : red;
  doc.setTextColor(...saldoColor); doc.setFontSize(12);
  doc.setFont('helvetica','bold');
  doc.text('Saldo Final', col1X, y);
  doc.text(formatCurrency(saldoFinal), col2X + valueColWidth, y, { align: 'right' });
  doc.setFont('helvetica','normal');

  const fname = `fluxo-categorias-sintetico_${startStr}_a_${endStr}.pdf`;
  doc.save(fname);
  showToast('Fluxo por categorias (sintético) gerado em PDF', 'success');
}

// Participação por Cliente – cálculo e renderização
function parseDateStr(s) { if (!s) return null; const [y,m,d] = String(s).split('-').map(Number); return new Date(y, (m||1)-1, (d||1)); }
function daysBetween(aStr, bStr) { const a = parseDateStr(aStr); const b = parseDateStr(bStr); if (!a || !b) return 0; const ms = a.getTime() - b.getTime(); return Math.round(ms / 86400000); }
function classifyPagamentoForClient(recs, todayStr) {
  const delays = [];
  (recs||[]).forEach(r => {
    const venc = r.data_vencimento;
    const recb = r.data_recebimento;
    if (recb) {
      const d = daysBetween(recb, venc);
      delays.push(Math.max(0, d));
    } else if ((r.status === 'pendente') && venc && daysBetween(todayStr, venc) > 0) {
      // atrasado até hoje
      delays.push(daysBetween(todayStr, venc));
    }
  });
  const maxDelay = delays.length ? Math.max(...delays) : 0;
  if (maxDelay > 30) return 'D';
  if (maxDelay >= 11) return 'C';
  if (maxDelay >= 1) return 'B';
  return 'A';
}
function quantiles(values) {
  const arr = [...values].filter(v => Number.isFinite(v)).sort((a,b)=>a-b);
  const qAt = (p) => { if (!arr.length) return 0; const idx = (arr.length - 1) * p; const lo = Math.floor(idx); const hi = Math.ceil(idx); const w = idx - lo; return (arr[lo] || 0) * (1 - w) + (arr[hi] || 0) * w; };
  return { q1: qAt(0.25), q2: qAt(0.50), q3: qAt(0.75) };
}
function classifyFaturamento(mensalidade, qs) {
  if (mensalidade >= (qs.q3 || 0)) return 'A';
  if (mensalidade >= (qs.q2 || 0)) return 'B';
  if (mensalidade >= (qs.q1 || 0)) return 'C';
  return 'D';
}
async function calcularParticipacaoPorCliente(startStr, endStr, agrupar = false) {
  const campoSel = window._campoDataRelatorios || 'data_vencimento';
  const recDateField = (campoSel === 'data_pagamento') ? 'data_recebimento' : 'data_vencimento';
  const { data: recebimentos } = await db.select('recebimentos', { select: 'cliente_id, valor_esperado, valor_recebido, status, data_vencimento, data_recebimento, tipo_recebimento' });
  const { data: clientes } = await db.select('clientes', { select: 'id, nome, grupo_cliente' });
  const inRange = (s) => { const dt = parseDateStr(s); if (!dt) return false; const a = parseDateStr(startStr); const b = parseDateStr(endStr); return dt >= a && dt <= b; };

  const byClient = new Map();
  const recsByClient = new Map();
  (recebimentos||[]).filter(r => r.tipo_recebimento === 'mensal' && r.status !== 'cancelado').forEach(r => {
    if (!inRange(r[recDateField])) return;
    const valor = (campoSel === 'data_pagamento') ? (r.status === 'recebido' ? Number(r.valor_recebido||0) : 0) : Number(r.valor_esperado||0);
    byClient.set(r.cliente_id, (byClient.get(r.cliente_id)||0) + valor);
    const arr = recsByClient.get(r.cliente_id) || []; arr.push(r); recsByClient.set(r.cliente_id, arr);
  });
  const metaCli = new Map((clientes||[]).map(c => [c.id, { nome: c.nome, grupo: (c.grupo_cliente||'').trim() }]));

  let rows;
  if (!agrupar) {
    rows = Array.from(byClient.entries()).map(([cid, mensalidade]) => {
      const nome = metaCli.get(cid)?.nome || '—';
      return { cliente_id: cid, cliente_nome: nome, mensalidade };
    }).sort((a,b)=>b.mensalidade - a.mensalidade);
  } else {
    const groupSum = new Map();
    const recsByGroup = new Map();
    const individualRows = [];
    Array.from(byClient.entries()).forEach(([cid, mensalidade]) => {
      const meta = metaCli.get(cid) || {};
      const grupo = (meta.grupo||'').trim();
      if (grupo) {
        groupSum.set(grupo, (groupSum.get(grupo)||0) + mensalidade);
        const recs = recsByClient.get(cid) || [];
        recsByGroup.set(grupo, (recsByGroup.get(grupo)||[]).concat(recs));
      } else {
        individualRows.push({ cliente_id: cid, cliente_nome: meta.nome || '—', mensalidade });
      }
    });
    const groupRows = Array.from(groupSum.entries()).map(([grupo, mensalidade]) => ({ cliente_id: null, cliente_nome: grupo, mensalidade, _group: grupo }));
    rows = groupRows.concat(individualRows).sort((a,b)=>b.mensalidade - a.mensalidade);

    // compute classe_pagamento for grouped entries using aggregated recs
    const todayStr = formatDate(new Date());
    rows = rows.map(r => {
      if (r._group) {
        const recs = recsByGroup.get(r._group) || [];
        const classePag = classifyPagamentoForClient(recs, todayStr);
        return { ...r, _recsAgg: recs, _classe_pag_agg: classePag };
      }
      return r;
    });
  }

  const total = sum(rows.map(r => r.mensalidade));
  const media = rows.length ? total / rows.length : 0;
  const qs = quantiles(rows.map(r => r.mensalidade));
  const todayStr = formatDate(new Date());

  const enriched = rows.map(r => {
    const recsCli = r._group ? (r._recsAgg || []) : (recsByClient.get(r.cliente_id) || []);
    const classePag = r._group ? (r._classe_pag_agg || classifyPagamentoForClient(recsCli, todayStr)) : classifyPagamentoForClient(recsCli, todayStr);
    const classeFat = classifyFaturamento(r.mensalidade, qs);
    const part = total ? (r.mensalidade / total) : 0;
    return { cliente_nome: r.cliente_nome, mensalidade: r.mensalidade, classe_pagamento: classePag, classe_faturamento: classeFat, participacao: part };
  });

  const rowsCSV = enriched.map(r => ({
    Cliente: r.cliente_nome,
    'Classe Faturamento': r.classe_faturamento,
    'Classe Pagamento': r.classe_pagamento,
    Mensalidade: r.mensalidade,
    '%Participacao': (r.participacao * 100).toFixed(2) + '%'
  }));

  return { total, media, rows: enriched, rowsCSV, qs };
}
function renderParticipacaoTabela(container, dados) {
  if (!container) return;
  const { total, media, rows, qs } = dados || {};
  const critFatA = formatCurrency((qs?.q3) || 0);
  const critFatB = formatCurrency((qs?.q2) || 0);
  const critFatC = formatCurrency((qs?.q1) || 0);
  const criteria = `
    <div class="muted" style="font-size:12px;padding:2px 0 8px 0;">
      Critérios: Pagamento A=0d; B=1–10d; C=11–30d; D=>30d | Faturamento A ≥ ${critFatA}; B ≥ ${critFatB}; C ≥ ${critFatC}; D < ${critFatC}
    </div>
  `;
  const header = `
    <div style="display:flex;gap:24px;align-items:center;justify-content:flex-start;padding:8px 0;">
      <div><strong>Total:</strong> ${formatCurrency(total || 0)}</div>
      <div><strong>Valor médio:</strong> ${formatCurrency(media || 0)}</div>
    </div>
  `;
  const labelPg = (l) => {
    switch (String(l || '')) {
      case 'A': return '(Bons Pagadores)';
      case 'B': return '(Pequeno Atraso)';
      case 'C': return '(Atraso Moderado)';
      case 'D': return '(Inadimplentes Crônicos)';
      default: return '';
    }
  };
  const table = `
    <table class="table" style="width:100%;">
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Classe Faturamento</th>
          <th>Classe Pagamento</th>
          <th class="right">Mensalidade</th>
          <th class="right">%Participacao</th>
        </tr>
      </thead>
      <tbody>
        ${(rows||[]).map(r => `
          <tr>
            <td>${(r.cliente_nome||'—')}</td>
            <td>${r.classe_faturamento}</td>
            <td>${r.classe_pagamento} ${labelPg(r.classe_pagamento)}</td>
            <td class="right">${formatCurrency(r.mensalidade)}</td>
            <td class="right">${(r.participacao * 100).toFixed(2)}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  container.innerHTML = criteria + header + table;
}

// Funções adicionadas ao final para geração dos relatórios operacionais
async function gerarRelacaoRecebimentosPDF(startStr, endStr, filters = { status: 'todos', tipo: 'todos' }) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { showToast('Biblioteca jsPDF não carregada', 'error'); return; }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  doc.setFont('helvetica','normal');
  const blue = [0, 64, 192];
  const margin = 24;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const { data: recebimentos } = await db.select('recebimentos', { select: 'id, cliente_id, descricao, valor_esperado, valor_recebido, status, tipo_recebimento, data_vencimento, data_recebimento' });
  const { data: clientes } = await db.select('clientes', { select: 'id, nome, regime_tributario, tipo_empresa' });
  const mapCli = new Map((clientes||[]).map(c => [c.id, c]));
  const clienteNome = (id) => (mapCli.get(id)?.nome) || '—';
  const tipoEmissaoPorCliente = (id) => {
    const c = mapCli.get(id);
    const regime = (c?.regime_tributario || '').toLowerCase();
    const tipoEmp = (c?.tipo_empresa || '').toLowerCase();
    if (regime === 'lucro real' && tipoEmp === 'industria') return 'NF Serv Retencao';
    if (regime === 'lucro real') return 'Emitir NF Serv';
    return '';
  };

  const campoSel = window._campoDataRelatorios || 'data_vencimento';
  const dateField = (campoSel === 'data_pagamento') ? 'data_recebimento' : 'data_vencimento';
  const meses = buildMonthArray(startStr, endStr);

  const baseCols = [
    { label: 'Cliente', width: 200 },
    { label: 'Descrição', width: 320 },
    { label: 'Data', width: 90 },
    { label: 'Valor', width: 110 },
    { label: 'Tipo Emissao', width: 140 },
    { label: 'Status', width: 74 },
  ];
  const availWidth = pageWidth - margin * 2;
  const sumBase = baseCols.reduce((a,c)=>a+c.width,0);
  const scale = availWidth / sumBase;
  const cols = baseCols.map(c => ({ label: c.label, width: Math.floor(c.width * scale) }));

  const header = (m, y) => {
    doc.setTextColor(...blue); doc.setFontSize(16);
    doc.text(`Relação de Recebimentos - ${getMonthNamePtBr(m)} de ${y}`, pageWidth / 2, margin + 10, { align: 'center' });
    const colX = []; { let acc = margin; for (let i = 0; i < cols.length; i++) { colX.push(acc); acc += cols[i].width; } }
    const tableTop = margin + 34;
    doc.setFontSize(11); doc.setTextColor(...blue);
    for (let i = 0; i < cols.length; i++) { doc.text(cols[i].label, colX[i] + 3, tableTop); }
    doc.setDrawColor(...blue); doc.line(margin, tableTop + 4, pageWidth - margin, tableTop + 4);
    return { colX, tableTop };
  };

  meses.forEach((mesObj, idx) => {
    if (idx > 0) doc.addPage('a4','portrait');
    const y = mesObj.year, m = mesObj.month;
    const { colX, tableTop } = header(m, y);
    const mmStr = String(m).padStart(2,'0');
    let rowsMes = (recebimentos||[]).filter(r => ((r[dateField]||'').startsWith(`${y}-${mmStr}`)));
    if (filters.status && filters.status !== 'todos') { rowsMes = rowsMes.filter(r => (r.status || '').toLowerCase() === filters.status); }
    if (filters.tipo && filters.tipo !== 'todos') { rowsMes = rowsMes.filter(r => (r.tipo_recebimento || '').toLowerCase() === filters.tipo); }
    const sorted = [...rowsMes].sort((a,b)=>((a[dateField]||'').localeCompare(b[dateField]||'')));

    let yList = tableTop + 16;
    doc.setTextColor(0,0,0); doc.setFontSize(9);
    const baseContentSize = 9;
    const lineHeight = 12;
    const padY = 10;

    for (let idxRow = 0; idxRow < sorted.length; idxRow++) {
      const r = sorted[idxRow];
      const nome = clienteNome(r.cliente_id);
      const desc = r.descricao || '—';
      const dateStr = r[dateField] || '';
      const fmt = (dateStr && dateStr.includes('-')) ? `${dateStr.split('-')[2]}/${dateStr.split('-')[1]}/${dateStr.split('-')[0]}` : '—';
      const valor = Number(dateField === 'data_recebimento' ? (r.valor_recebido || 0) : (r.valor_esperado || 0));
      const status = r.status || '—';
      const tipoEmissao = tipoEmissaoPorCliente(r.cliente_id);
      const nomeLines = doc.splitTextToSize(nome, cols[0].width - 6);
      const descLines = doc.splitTextToSize(desc, cols[1].width - 6);
      const rowLines = Math.max(nomeLines.length, descLines.length);
      const rowH = padY + lineHeight * rowLines;

      if (yList + rowH + 8 > pageHeight - margin) { doc.addPage('a4','portrait'); const h = header(m, y); doc.setTextColor(0,0,0); doc.setFontSize(9); yList = h.tableTop + 16; }

      if (idxRow % 2 === 1) { doc.setFillColor(240,240,240); doc.rect(margin, yList - 2, (pageWidth - margin) - margin, rowH + 4, 'F'); }
      for (let i = 0; i < nomeLines.length; i++) { doc.text(nomeLines[i], colX[0] + 3, yList + padY + i*lineHeight); }
      for (let i = 0; i < descLines.length; i++) { doc.text(descLines[i], colX[1] + 3, yList + padY + i*lineHeight); }
      const yBase = yList + padY + lineHeight - 2;
      doc.text(fmt, colX[2] + 3, yBase);
      // align value to the right within its column
      doc.text(formatCurrency(valor), colX[3] + cols[3].width - 3, yBase, { align: 'right' });
      // Tipo Emissao: fonte reduzida e negrito (apenas conteúdo)
      doc.setFont('helvetica','bold');
      doc.setFontSize(9);
      doc.text(tipoEmissao || '—', colX[4] + 3, yBase);
      doc.setFont('helvetica','normal');
      doc.setFontSize(baseContentSize);
      doc.text(status, colX[5] + 3, yBase);
      yList += rowH + 6;
    }
    // Rodapé com totais do mês
    const totalMes = sum(rowsMes.map(r => Number(dateField === 'data_recebimento' ? (r.valor_recebido || 0) : (r.valor_esperado || 0))));
    const qtdMes = rowsMes.length;
    const footerY = pageHeight - margin - 8;
    doc.setTextColor(...blue); doc.setFontSize(10);
    doc.text(`Total do mês (${dateField === 'data_recebimento' ? 'por recebimento' : 'por vencimento'}): ${formatCurrency(totalMes)} / Quantidade de recebimentos: ${qtdMes}`,
      margin, footerY);
  });

  const fname = `relacao_recebimentos_${startStr}_a_${endStr}.pdf`;
  doc.save(fname);
  showToast('Relação de recebimentos gerada em PDF', 'success');
}

async function gerarRelacaoPagamentosPDF(startStr, endStr, filters = { status: 'todos', tipo: 'todos' }) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { showToast('Biblioteca jsPDF não carregada', 'error'); return; }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  doc.setFont('helvetica','normal');
  const blue = [0, 64, 192];
  const margin = 24;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const { data: pagamentos } = await db.select('pagamentos', { select: 'id, fornecedor_id, descricao, valor_esperado, valor_pago, status, tipo_pagamento, data_vencimento, data_pagamento' });
  const { data: fornecedores } = await db.select('fornecedores', { select: 'id, nome' });
  const fornecedorNome = (id) => (fornecedores||[]).find(f => f.id === id)?.nome || '—';

  const dateField = window._campoDataRelatorios || 'data_vencimento';
  const meses = buildMonthArray(startStr, endStr);

  const baseCols = [
    { label: 'Fornecedor', width: 200 },
    { label: 'Descrição', width: 320 },
    { label: 'Data', width: 90 },
    { label: 'Valor', width: 110 },
    { label: 'Status', width: 74 },
  ];
  const availWidth2 = pageWidth - margin * 2;
  const sumBase2 = baseCols.reduce((a,c)=>a+c.width,0);
  const scale2 = availWidth2 / sumBase2;
  const cols = baseCols.map(c => ({ label: c.label, width: Math.floor(c.width * scale2) }));

  const header = (m, y) => {
    doc.setTextColor(...blue); doc.setFontSize(16);
    doc.text(`Relação de Pagamentos - ${getMonthNamePtBr(m)} de ${y}`, pageWidth / 2, margin + 10, { align: 'center' });
    const colX = []; { let acc = margin; for (let i = 0; i < cols.length; i++) { colX.push(acc); acc += cols[i].width; } }
    const tableTop = margin + 34;
    doc.setFontSize(11); doc.setTextColor(...blue);
    for (let i = 0; i < cols.length; i++) { doc.text(cols[i].label, colX[i] + 3, tableTop); }
    doc.setDrawColor(...blue); doc.line(margin, tableTop + 4, pageWidth - margin, tableTop + 4);
    return { colX, tableTop };
  };

  meses.forEach((mesObj, idx) => {
    if (idx > 0) doc.addPage('a4','portrait');
    const y = mesObj.year, m = mesObj.month;
    const { colX, tableTop } = header(m, y);
    const mmStr = String(m).padStart(2,'0');
    let rowsMes = (pagamentos||[]).filter(p => ((p[dateField]||'').startsWith(`${y}-${mmStr}`)));
    if (filters.status && filters.status !== 'todos') { rowsMes = rowsMes.filter(p => (p.status || '').toLowerCase() === filters.status); }
    if (filters.tipo && filters.tipo !== 'todos') { rowsMes = rowsMes.filter(p => (p.tipo_pagamento || '').toLowerCase() === filters.tipo); }
    const sorted = [...rowsMes].sort((a,b)=>((a[dateField]||'').localeCompare(b[dateField]||'')));

    let yList = tableTop + 16;
    doc.setTextColor(0,0,0); doc.setFontSize(9);
    const lineHeight = 12;
    const padY = 10;

    for (let idxRow = 0; idxRow < sorted.length; idxRow++) {
      const p = sorted[idxRow];
      const nome = fornecedorNome(p.fornecedor_id);
      const desc = p.descricao || '—';
      const dateStr = p[dateField] || '';
      const fmt = (dateStr && dateStr.includes('-')) ? `${dateStr.split('-')[2]}/${dateStr.split('-')[1]}/${dateStr.split('-')[0]}` : '—';
      const valor = Number(dateField === 'data_pagamento' ? (p.valor_pago || 0) : (p.valor_esperado || 0));
      const status = p.status || '—';
      const nomeLines = doc.splitTextToSize(nome, cols[0].width - 6);
      const descLines = doc.splitTextToSize(desc, cols[1].width - 6);
      const rowLines = Math.max(nomeLines.length, descLines.length);
      const rowH = padY + lineHeight * rowLines;

      if (yList + rowH + 8 > pageHeight - margin) { doc.addPage('a4','portrait'); const h = header(m, y); doc.setTextColor(0,0,0); doc.setFontSize(9); yList = h.tableTop + 16; }

      if (idxRow % 2 === 1) { doc.setFillColor(240,240,240); doc.rect(margin, yList - 2, (pageWidth - margin) - margin, rowH + 4, 'F'); }
      for (let i = 0; i < nomeLines.length; i++) { doc.text(nomeLines[i], colX[0] + 3, yList + padY + i*lineHeight); }
      for (let i = 0; i < descLines.length; i++) { doc.text(descLines[i], colX[1] + 3, yList + padY + i*lineHeight); }
      const yBase = yList + padY + lineHeight - 2;
      doc.text(fmt, colX[2] + 3, yBase);
      doc.text(formatCurrency(valor), colX[3] + 3, yBase);
      doc.text(status, colX[4] + 3, yBase);
      yList += rowH + 6;
    }
    // Rodapé com totais do mês
    const totalMes = sum(rowsMes.map(p => Number(dateField === 'data_pagamento' ? (p.valor_pago || 0) : (p.valor_esperado || 0))));
    const qtdMes = rowsMes.length;
    const footerY = pageHeight - margin - 8;
    doc.setTextColor(...blue); doc.setFontSize(10);
    doc.text(`Total do mês (${dateField === 'data_pagamento' ? 'por pagamento' : 'por vencimento'}): ${formatCurrency(totalMes)} / Quantidade de pagamentos: ${qtdMes}`,
      margin, footerY);
  });

  const fname = `relacao_pagamentos_${startStr}_a_${endStr}.pdf`;
  doc.save(fname);
  showToast('Relação de pagamentos gerada em PDF', 'success');
}

// Helpers para exportação CSV das relações
async function buildRelacaoRecebimentosCSV(startStr, endStr, filters = { status: 'todos', tipo: 'todos' }) {
  const campoSel = window._campoDataRelatorios || 'data_vencimento';
  const dateField = (campoSel === 'data_pagamento') ? 'data_recebimento' : 'data_vencimento';
  const { data: recebimentos } = await db.select('recebimentos', { select: 'cliente_id, descricao, valor_esperado, valor_recebido, status, tipo_recebimento, data_vencimento, data_recebimento' });
  const { data: clientes } = await db.select('clientes', { select: 'id, nome, regime_tributario, tipo_empresa' });
  const mapCli = new Map((clientes||[]).map(c => [c.id, c]));
  const nomeCliente = (id) => (mapCli.get(id)?.nome) || '—';
  const tipoEmissaoPorCliente = (id) => {
    const c = mapCli.get(id);
    const regime = (c?.regime_tributario || '').toLowerCase();
    const tipoEmp = (c?.tipo_empresa || '').toLowerCase();
    if (regime === 'lucro real' && tipoEmp === 'industria') return 'NF Serv Retencao';
    if (regime === 'lucro real') return 'Emitir NF Serv';
    return '';
  };
  const inRange = (ds) => !!ds && ds >= startStr && ds <= endStr;
  const fmtBR = (s) => { if (!s) return '—'; const [y,m,d] = String(s).split('-'); return `${d}/${m}/${y}`; };
  const rows = [];
  (recebimentos||[]).forEach(r => {
    const ds = r[dateField];
    if (inRange(ds)) {
      const valor = Number(dateField === 'data_recebimento' ? (r.valor_recebido || 0) : (r.valor_esperado || 0));
      if ((filters.status === 'todos' || (r.status || '').toLowerCase() === filters.status) &&
          (filters.tipo === 'todos' || (r.tipo_recebimento || '').toLowerCase() === filters.tipo)) {
        rows.push({
          Cliente: nomeCliente(r.cliente_id),
          Descricao: r.descricao || '—',
          Data: fmtBR(ds),
          Valor: valor,
          Status: r.status || 'pendente',
          Tipo: r.tipo_recebimento || '—',
          'Tipo Emissao': tipoEmissaoPorCliente(r.cliente_id) || '',
        });
      }
    }
  });
  return rows;
}

async function buildRelacaoPagamentosCSV(startStr, endStr, filters = { status: 'todos', tipo: 'todos' }) {
  const campoSel = window._campoDataRelatorios || 'data_vencimento';
  const dateField = (campoSel === 'data_pagamento') ? 'data_pagamento' : 'data_vencimento';
  const { data: pagamentos } = await db.select('pagamentos', { select: 'fornecedor_id, descricao, valor_esperado, valor_pago, status, tipo_pagamento, data_vencimento, data_pagamento' });
  const { data: fornecedores } = await db.select('fornecedores', { select: 'id, nome' });
  const nomeFornecedor = (id) => (fornecedores||[]).find(f => f.id === id)?.nome || '—';
  const inRange = (ds) => !!ds && ds >= startStr && ds <= endStr;
  const fmtBR = (s) => { if (!s) return '—'; const [y,m,d] = String(s).split('-'); return `${d}/${m}/${y}`; };
  const rows = [];
  (pagamentos||[]).forEach(p => {
    const ds = p[dateField];
    if (inRange(ds)) {
      const valor = Number(dateField === 'data_pagamento' ? (p.valor_pago || 0) : (p.valor_esperado || 0));
      if ((filters.status === 'todos' || (p.status || '').toLowerCase() === filters.status) &&
          (filters.tipo === 'todos' || (p.tipo_pagamento || '').toLowerCase() === filters.tipo)) {
        rows.push({
          Fornecedor: nomeFornecedor(p.fornecedor_id),
          Descricao: p.descricao || '—',
          Data: fmtBR(ds),
          Valor: valor,
          Status: p.status || 'pendente',
          Tipo: p.tipo_pagamento || '—',
        });
      }
    }
  });
  return rows;
}
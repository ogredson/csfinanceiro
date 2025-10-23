import { db } from '../supabaseClient.js';
import { renderLineChart, renderPieChart, renderBarChart, renderAreaChart } from '../components/Charts.js';
import { formatCurrency, sum, showToast, formatDate } from '../utils.js';

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

    // Página de lista do mês
    doc.addPage('a4','landscape');
    doc.setTextColor(...blue); doc.setFontSize(16);
    doc.text(`Relação de Recebimentos - ${getMonthNamePtBr(m)} de ${y}`, pageWidth / 2, margin + 10, { align: 'center' });
    const cols = [
      { label: 'Cliente', width: 200 },
      { label: 'Descrição', width: 320 },
      { label: 'Data', width: 90 },
      { label: 'Valor', width: 110 },
      { label: 'Status', width: 74 },
    ];
    const colX = []; { let acc = margin; for (let i = 0; i < cols.length; i++) { colX.push(acc); acc += cols[i].width; } }
    const tableTop = margin + 34;
    // Cabeçalho da tabela
    doc.setFontSize(11); doc.setTextColor(...blue);
    for (let i = 0; i < cols.length; i++) { doc.text(cols[i].label, colX[i] + 3, tableTop); }
    doc.setDrawColor(...blue); doc.line(margin, tableTop + 4, pageWidth - margin, tableTop + 4);

    const sorted = [...rowsMes].sort((a,b)=>((a[dateField]||'').localeCompare(b[dateField]||'')));
    doc.setTextColor(0,0,0); doc.setFontSize(10);
    let yList = tableTop + 16;
    const makeHeader = () => {
      doc.setTextColor(...blue); doc.setFontSize(16);
      doc.text(`Relação de Recebimentos - ${getMonthNamePtBr(m)} de ${y}`, pageWidth / 2, margin + 10, { align: 'center' });
      doc.setFontSize(11); doc.setTextColor(...blue);
      for (let i = 0; i < cols.length; i++) { doc.text(cols[i].label, colX[i] + 3, tableTop); }
      doc.setDrawColor(...blue); doc.line(margin, tableTop + 4, pageWidth - margin, tableTop + 4);
      doc.setTextColor(0,0,0); doc.setFontSize(10);
      yList = tableTop + 16;
    };

    for (let idxRow = 0; idxRow < sorted.length; idxRow++) {
      const r = sorted[idxRow];
      const nome = clienteNome(r.cliente_id);
      const desc = r.descricao || '—';
      const dateStr = r[dateField] || '';
      const fmt = (dateStr && dateStr.includes('-')) ? `${dateStr.split('-')[2]}/${dateStr.split('-')[1]}/${dateStr.split('-')[0]}` : '—';
      const valor = Number(dateField === 'data_recebimento' ? (r.valor_recebido || 0) : (r.valor_esperado || 0));
      const status = r.status || '—';
      const nomeLines = doc.splitTextToSize(nome, cols[0].width - 6);
      const descLines = doc.splitTextToSize(desc, cols[1].width - 6);
      const rowLines = Math.max(nomeLines.length, descLines.length);
      const lineHeight = 12;
      const padY = 10;
      const rowH = padY + lineHeight * rowLines;

      if (yList + rowH + 8 > pageHeight - margin) { doc.addPage('a4','landscape'); makeHeader(); }

      if (idxRow % 2 === 1) {
        doc.setFillColor(240,240,240);
        doc.rect(margin, yList - 2, (pageWidth - margin) - margin, rowH + 4, 'F');
      }

      for (let i = 0; i < nomeLines.length; i++) { doc.text(nomeLines[i], colX[0] + 3, yList + padY + i*lineHeight); }
      for (let i = 0; i < descLines.length; i++) { doc.text(descLines[i], colX[1] + 3, yList + padY + i*lineHeight); }
      const yBase = yList + padY + lineHeight - 2;
      doc.text(fmt, colX[2] + 3, yBase);
      doc.text(formatCurrency(valor), colX[3] + 3, yBase);
      doc.text(status, colX[4] + 3, yBase);
      yList += rowH + 6;
    }
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

    // Página de lista do mês
    doc.addPage('a4','landscape');
    doc.setTextColor(...blue); doc.setFontSize(16);
    doc.text(`Relação de Pagamentos - ${getMonthNamePtBr(m)} de ${y}`, pageWidth / 2, margin + 10, { align: 'center' });
    const cols = [
      { label: 'Fornecedor', width: 200 },
      { label: 'Descrição', width: 320 },
      { label: 'Data', width: 90 },
      { label: 'Valor', width: 110 },
      { label: 'Status', width: 74 },
    ];
    const colX = []; { let acc = margin; for (let i = 0; i < cols.length; i++) { colX.push(acc); acc += cols[i].width; } }
    const tableTop = margin + 34;
    // Cabeçalho da tabela
    doc.setFontSize(11); doc.setTextColor(...blue);
    for (let i = 0; i < cols.length; i++) { doc.text(cols[i].label, colX[i] + 3, tableTop); }
    doc.setDrawColor(...blue); doc.line(margin, tableTop + 4, pageWidth - margin, tableTop + 4);

    const sorted = [...rowsMes].sort((a,b)=>((a[dateField]||'').localeCompare(b[dateField]||'')));
    doc.setTextColor(0,0,0); doc.setFontSize(10);
    let yList = tableTop + 16;
    const makeHeader = () => {
      doc.setTextColor(...blue); doc.setFontSize(16);
      doc.text(`Relação de Pagamentos - ${getMonthNamePtBr(m)} de ${y}`, pageWidth / 2, margin + 10, { align: 'center' });
      doc.setFontSize(11); doc.setTextColor(...blue);
      for (let i = 0; i < cols.length; i++) { doc.text(cols[i].label, colX[i] + 3, tableTop); }
      doc.setDrawColor(...blue); doc.line(margin, tableTop + 4, pageWidth - margin, tableTop + 4);
      doc.setTextColor(0,0,0); doc.setFontSize(10);
      yList = tableTop + 16;
    };

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
      const lineHeight = 12;
      const padY = 10;
      const rowH = padY + lineHeight * rowLines;

      if (yList + rowH + 8 > pageHeight - margin) { doc.addPage('a4','landscape'); makeHeader(); }

      // fundo alternado para melhor visualização
      if (idxRow % 2 === 1) {
        doc.setFillColor(240,240,240);
        doc.rect(margin, yList - 2, (pageWidth - margin) - margin, rowH + 4, 'F');
      }

      // imprime a linha (com quebras), alinhando baseline com as demais colunas
      for (let i = 0; i < nomeLines.length; i++) { doc.text(nomeLines[i], colX[0] + 3, yList + padY + i*lineHeight); }
      for (let i = 0; i < descLines.length; i++) { doc.text(descLines[i], colX[1] + 3, yList + padY + i*lineHeight); }
      const yBase = yList + padY + lineHeight - 2;
      doc.text(fmt, colX[2] + 3, yBase);
      doc.text(formatCurrency(valor), colX[3] + 3, yBase);
      doc.text(status, colX[4] + 3, yBase);
      yList += rowH + 6;
    }
  });

  const fname = `calendario_pagamentos_${startStr}_a_${endStr}.pdf`;
  doc.save(fname);
  showToast('Calendário de pagamentos gerado em PDF', 'success');
}

export async function renderRelatorios(app) {
  app.innerHTML = `
    <div class="toolbar">
      <div class="filters" style="display:flex;gap:8px;align-items:center;">
        <label>Início <input type="date" id="dtInicio" /></label>
        <label>Fim <input type="date" id="dtFim" /></label>
        <label id="lblCampoData"><span id="lblCampoDataText">Campo de data</span>
          <select id="campoData">
            <option value="data_vencimento" selected>Por Vencimento</option>
            <option value="data_pagamento">Por Pagamento</option>
          </select>
        </label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button id="btnCalPag" class="btn btn-outline">Gerar Calendário de Pagamentos</button>
        <button id="btnCalRec" class="btn btn-outline">Gerar Calendário de Recebimentos</button>
        <label style="display:inline-flex;align-items:center;gap:6px;">
          Saldo Inicial
          <input type="number" id="saldoInicial" step="0.01" value="0" style="width:140px;" />
        </label>
        <label style="display:inline-flex;align-items:center;gap:6px;">
          Tipo de Relatório
          <select id="tipoRelatorio" style="width:120px;">
            <option value="sintetico" selected>Sintético</option>
            <option value="analitico">Analítico</option>
          </select>
        </label>
        <button id="btnFluxo" class="btn btn-outline">Gerar Fluxo de Caixa</button>
      </div>
    </div>
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

  const fluxo = await fluxoCaixaComparativo(dtInicio.value, dtFim.value);
  const ctxFluxo = document.getElementById('fluxo12m');
  const fluxoChart = new Chart(ctxFluxo, { type: 'bar', data: { labels: fluxo.months, datasets: [
    { label: 'Entradas', data: fluxo.entradas, backgroundColor: 'rgba(16,185,129,0.5)' },
    { label: 'Saídas', data: fluxo.saidas, backgroundColor: 'rgba(239,68,68,0.5)' },
  ] }, options: { responsive: true } });
  window._fluxo12mChart = fluxoChart;

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

  document.getElementById('btnFluxo').addEventListener('click', async () => {
    const dtInicioVal = document.getElementById('dtInicio').value;
    const dtFimVal = document.getElementById('dtFim').value;
    const saldoInicial = Number(document.getElementById('saldoInicial').value || 0);
    const tipoRelatorio = document.getElementById('tipoRelatorio').value;
    window._campoDataRelatorios = document.getElementById('campoData').value;
    try { await gerarFluxoCaixaPDF(dtInicioVal, dtFimVal, saldoInicial, tipoRelatorio); } catch (e) { console.error(e); showToast('Falha ao gerar fluxo de caixa em PDF', 'error'); }
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
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
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
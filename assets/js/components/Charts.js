export function renderLineChart(ctx, labels, datasetLabel, data) {
  return new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: datasetLabel, data, borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.2)', tension: 0.3, fill: true }] },
    options: { responsive: true, plugins: { legend: { display: true } } },
  });
}

export function renderBarChart(ctx, labels, datasetLabel, data) {
  return new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: datasetLabel, data, borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.4)' }] },
    options: { responsive: true, plugins: { legend: { display: true } } },
  });
}

export function renderPieChart(ctx, labels, data) {
  return new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data, backgroundColor: ['#3B82F6','#10B981','#F59E0B','#EF4444','#6B7280','#8B5CF6','#EC4899','#65A30D'] }] },
    options: { responsive: true },
  });
}

export function renderAreaChart(ctx, labels, datasetLabel, data) {
  return new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: datasetLabel, data, borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.2)', tension: 0.3, fill: true }] },
    options: { responsive: true },
  });
}
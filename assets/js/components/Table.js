import { paginate } from '../utils.js';

export function renderTable(container, { columns = [], rows = [], actions = [], page = 1, perPage = 20 } = {}) {
  const { from, to } = paginate(page, perPage);
  const pageRows = rows.slice(from, to + 1);
  const table = document.createElement('table');
  table.className = 'table';
  const thead = document.createElement('thead');
  const trHead = document.createElement('tr');
  columns.forEach(col => {
    const th = document.createElement('th'); th.textContent = col.label; trHead.appendChild(th);
  });
  if (actions.length) { const th = document.createElement('th'); th.textContent = 'Ações'; trHead.appendChild(th); }
  thead.appendChild(trHead);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  pageRows.forEach(row => {
    const tr = document.createElement('tr');
    columns.forEach(col => {
      const td = document.createElement('td');
      td.innerHTML = col.render ? col.render(row[col.key], row) : (row[col.key] ?? '');
      tr.appendChild(td);
    });
    if (actions.length) {
      const td = document.createElement('td'); td.className = 'row-actions';
      actions.forEach(act => {
        const btn = document.createElement('button'); btn.className = act.className || 'btn btn-outline'; btn.textContent = act.label;
        btn.addEventListener('click', () => act.onClick?.(row)); td.appendChild(btn);
      });
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
  return { table };
}
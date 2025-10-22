export function showToast(message, type = 'info', timeout = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show`;
  el.style.borderColor = type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--success)' : '#334155';
  setTimeout(() => { el.className = 'toast'; }, timeout);
}

export function formatCurrency(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}

export function parseCurrency(str) {
  // Mantém compatibilidade com números já normalizados
  if (typeof str === 'number') return str;
  const raw = (str || '').toString().trim();
  // Remove tudo que não for dígito, vírgula, ponto ou sinal
  const s = raw.replace(/[^0-9,.-]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  // Determina qual é o separador decimal pelo último que aparecer
  let decimalSep = '';
  if (lastDot === -1 && lastComma === -1) {
    decimalSep = '';
  } else if (lastDot > lastComma) {
    decimalSep = '.';
  } else {
    decimalSep = ',';
  }
  let normalized;
  if (!decimalSep) {
    // Sem separador decimal: remove separadores e interpreta como inteiro
    normalized = s.replace(/[.,]/g, '');
  } else if (decimalSep === ',') {
    // Estilo pt-BR: vírgula é decimal, pontos são milhares
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else {
    // Estilo en-US: ponto é decimal, vírgulas são milhares
    normalized = s.replace(/,/g, '');
  }
  const num = Number(normalized);
  return isNaN(num) ? 0 : num;
}

export function formatDate(date) {
  const d = date ? new Date(date) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function debounce(fn, delay = 300) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

export function throttle(fn, limit = 300) {
  let inThrottle; return (...args) => {
    if (!inThrottle) { fn(...args); inThrottle = true; setTimeout(() => inThrottle = false, limit); }
  };
}

export function sanitizeText(text) {
  const div = document.createElement('div');
  div.innerText = String(text || '');
  return div.innerHTML;
}

export function exportToCSV(filename, rows) {
  if (!rows || !rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')]
    .concat(rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '').replace(/\n/g, ' ')).join(',')))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

export function setLoading(el, isLoading) {
  if (!el) return;
  el.style.opacity = isLoading ? '0.6' : '1';
  el.style.pointerEvents = isLoading ? 'none' : 'auto';
}

export function paginate(page = 1, perPage = 20) {
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;
  return { from, to };
}

export function sum(values = []) { return values.reduce((acc, v) => acc + Number(v || 0), 0); }
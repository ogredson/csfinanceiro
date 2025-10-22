import { renderAuth } from './modules/auth.js';
import { renderDashboard } from './modules/dashboard.js';
import { renderRecebimentos } from './modules/recebimentos.js';
import { renderPagamentos } from './modules/pagamentos.js';
import { renderClientes } from './modules/clientes.js';
import { renderFornecedores } from './modules/fornecedores.js';
import { renderRelatorios } from './modules/relatorios.js';
import { renderConfig } from './modules/configuracoes.js';

export const routes = {
  '/login': renderAuth,
  '/dashboard': renderDashboard,
  '/recebimentos': renderRecebimentos,
  '/pagamentos': renderPagamentos,
  '/clientes': renderClientes,
  '/fornecedores': renderFornecedores,
  '/relatorios': renderRelatorios,
  '/configuracoes': renderConfig,
};

export function getRouteFromHash() {
  const hash = window.location.hash || '#/dashboard';
  const path = hash.replace('#', '');
  return routes[path] ? path : '/dashboard';
}

function updateActiveLink(path) {
  const links = document.querySelectorAll('a[data-route]');
  links.forEach(a => {
    const href = a.getAttribute('href') || '';
    const linkPath = href.replace('#', '');
    if (linkPath === path) a.classList.add('active'); else a.classList.remove('active');
  });
}

export async function navigate(path) {
  const app = document.getElementById('app');
  const renderer = routes[path] || routes['/dashboard'];
  app.innerHTML = '';
  await renderer(app);
  updateActiveLink(path);
}

export function initRouter() {
  window.addEventListener('hashchange', () => navigate(getRouteFromHash()));
}
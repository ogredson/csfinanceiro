import { renderAuth } from './modules/auth.js';
import { renderDashboard } from './modules/dashboard.js';
import { renderRecebimentos } from './modules/recebimentos.js';
import { renderPagamentos } from './modules/pagamentos.js';
import { renderClientes } from './modules/clientes.js';
import { renderFornecedores } from './modules/fornecedores.js';
import { renderRelatorios } from './modules/relatorios.js';
import { renderGraficos } from './modules/graficos.js';
import { renderConfig } from './modules/configuracoes.js';
import { renderMovimentacoes } from './modules/movimentacoes.js';

export const routes = {
  '/login': renderAuth,
  '/dashboard': renderDashboard,
  '/recebimentos': renderRecebimentos,
  '/pagamentos': renderPagamentos,
  '/clientes': renderClientes,
  '/fornecedores': renderFornecedores,
  '/graficos': renderGraficos,
  '/relatorios': renderRelatorios,
  '/configuracoes': renderConfig,
  '/movimentacoes': renderMovimentacoes,
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
  // Simple auth guard: block access to routes when not authenticated
  const getUser = () => {
    try { return JSON.parse(localStorage.getItem('CSF_USER') || 'null'); } catch { return null; }
  };
  const user = window.__USER__ || getUser();
  const isLoginRoute = path === '/login';
  if (!isLoginRoute && !user) {
    path = '/login';
    window.location.hash = '#/login';
  }

  const app = document.getElementById('app');
  const renderer = routes[path] || routes['/dashboard'];
  app.innerHTML = '';
  await renderer(app);
  updateActiveLink(path);

  // Hide navigation elements on login route to prevent interaction
  const sidebar = document.getElementById('sidebar');
  const headerActions = document.querySelector('.header-actions');
  const toggleBtn = document.getElementById('toggleSidebar');
  const brand = document.querySelector('.brand');
  const main = document.querySelector('.app-main');
  const onLogin = path === '/login';
  // Clear inline styles when not on login to restore CSS defaults
  if (sidebar) {
    sidebar.classList.remove('open');
    sidebar.style.display = onLogin ? 'none' : '';
  }
  if (headerActions) headerActions.style.display = onLogin ? 'none' : '';
  if (toggleBtn) toggleBtn.style.display = onLogin ? 'none' : '';
  if (main) main.style.marginLeft = onLogin ? '0' : '240px';
  if (brand) brand.style.pointerEvents = onLogin ? 'none' : 'auto';
}

export function initRouter() {
  window.addEventListener('hashchange', () => navigate(getRouteFromHash()));
}
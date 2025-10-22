import { initSupabase, subscribeRealtime } from './supabaseClient.js';
import { initRouter, navigate, getRouteFromHash } from './router.js';
import { showToast } from './utils.js';

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem('CSF_USER') || 'null'); } catch { return null; }
}

async function ensureAuth() {
  const user = getStoredUser();
  window.__USER__ = user;
  if (!user) { window.location.hash = '#/login'; return true; }
  return true;
}

function setupLayoutEvents() {
  const toggle = document.getElementById('toggleSidebar');
  const sidebar = document.getElementById('sidebar');
  toggle?.addEventListener('click', () => sidebar.classList.toggle('open'));
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    localStorage.removeItem('CSF_USER');
    window.__USER__ = null;
    showToast('Sessão encerrada', 'success');
    window.location.hash = '#/login';
  });
  // Atualiza visual ativo imediatamente ao clicar em qualquer link de rota
  document.querySelectorAll('a[data-route]').forEach(a => {
    a.addEventListener('click', () => {
      const path = (a.getAttribute('href') || '').replace('#', '');
      document.querySelectorAll('a[data-route]').forEach(link => {
        const lp = (link.getAttribute('href') || '').replace('#', '');
        link.classList.toggle('active', lp === path);
      });
    });
  });
}

function setupRealtime() {
  subscribeRealtime((table, payload) => {
    if (['recebimentos', 'pagamentos'].includes(table)) {
      // Re-render dashboard on changes
      if ((window.location.hash || '').includes('dashboard')) {
        navigate('/dashboard');
      }
    }
  });
}

async function bootstrap() {
  setupLayoutEvents();
  initRouter();
  const ok = await ensureAuth();
  if (ok) {
    setupRealtime();
    await navigate(getRouteFromHash());
  }
}

bootstrap();
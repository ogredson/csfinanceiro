import { initSupabase, subscribeRealtime, logout as supaLogout } from './supabaseClient.js';
import { initRouter, navigate, getRouteFromHash } from './router.js';
import { showToast } from './utils.js';

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem('CSF_USER') || 'null'); } catch { return null; }
}

function ensureAuth() {
  const user = getStoredUser();
  window.__USER__ = user;
  return !!user;
}

function getTheme() {
  return localStorage.getItem('CSF_THEME') || 'night';
}
function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove('theme-day', 'theme-night');
  root.classList.add(theme === 'day' ? 'theme-day' : 'theme-night');
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'day' ? '🌞 Dia' : '🌗 Noite';
}
function setTheme(theme) {
  localStorage.setItem('CSF_THEME', theme);
  applyTheme(theme);
}

function setupLayoutEvents() {
  const toggle = document.getElementById('toggleSidebar');
  const sidebar = document.getElementById('sidebar');
  toggle?.addEventListener('click', () => sidebar.classList.toggle('open'));
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    // Sign out from Supabase session
    await supaLogout();
    localStorage.removeItem('CSF_USER');
    window.__USER__ = null;
    showToast('Sessão encerrada', 'success');
    window.location.hash = '#/login';
  });
  const themeBtn = document.getElementById('themeToggle');
  themeBtn?.addEventListener('click', () => {
    const next = getTheme() === 'day' ? 'night' : 'day';
    setTheme(next);
  });
  applyTheme(getTheme());
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
  const isAuthed = ensureAuth();
  if (!isAuthed) {
    await navigate('/login');
    return;
  }
  setupRealtime();
  await navigate(getRouteFromHash());
}

bootstrap();
import { db, login } from '../supabaseClient.js';
import { showToast } from '../utils.js';
import { navigate } from '../router.js';

export async function renderAuth(app) {
  app.innerHTML = `
    <div class="card" style="max-width:420px;margin:40px auto;">
      <h3>Acessar</h3>
      <form id="loginForm" class="form">
        <div class="field">
          <label>E-mail</label>
          <input type="email" id="email" placeholder="seu@email.com" required />
        </div>
        <div class="field">
          <label>Senha</label>
          <input type="password" id="senha" placeholder="••••••••" required />
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
          <button type="submit" class="btn btn-primary">Entrar</button>
        </div>
      </form>
      <p class="muted" style="margin-top:8px;">Login via Supabase Auth.</p>
    </div>
  `;
  const form = document.getElementById('loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const senha = document.getElementById('senha').value.trim();
    const { data, error } = await login(email, senha);
    if (error) { showToast(error.message || 'Erro ao validar credenciais', 'error'); return; }
    const user = data?.user;
    if (!user) { showToast('Usuário ou senha inválidos', 'error'); return; }
    localStorage.setItem('CSF_USER', JSON.stringify({ id: user.id, email: user.email }));
    window.__USER__ = { id: user.id, email: user.email };
    showToast('Login efetuado', 'success');
    window.location.hash = '#/dashboard';
    await navigate('/dashboard');
  });
}
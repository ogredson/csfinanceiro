import { db } from '../supabaseClient.js';
import { showToast } from '../utils.js';
import { navigate } from '../router.js';

export async function renderAuth(app) {
  app.innerHTML = `
    <div class="card" style="max-width:420px;margin:40px auto;">
      <h3>Acessar</h3>
      <form id="loginForm" class="form">
        <div class="field">
          <label>Nome de usuário</label>
          <input type="text" id="nome" placeholder="seu_nome" required />
        </div>
        <div class="field">
          <label>Senha</label>
          <input type="password" id="senha" placeholder="••••••••" required />
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
          <button type="submit" class="btn btn-primary">Entrar</button>
        </div>
      </form>
      <p class="muted" style="margin-top:8px;">Login básico usando a tabela de usuários.</p>
    </div>
  `;
  const form = document.getElementById('loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('nome').value.trim();
    const senha = document.getElementById('senha').value.trim();
    const { data, error } = await db.select('usuarios', { eq: { nome, senha }, select: 'id, nome' });
    if (error) { showToast(error.message || 'Erro ao validar usuário', 'error'); return; }
    const user = (data || [])[0];
    if (!user) { showToast('Usuário ou senha inválidos', 'error'); return; }
    localStorage.setItem('CSF_USER', JSON.stringify(user));
    window.__USER__ = user;
    showToast('Login efetuado', 'success');
    window.location.hash = '#/dashboard';
    await navigate('/dashboard');
  });
}
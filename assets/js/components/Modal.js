export function createModal({ title = 'Modal', content = '', actions = [] } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop open';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <header>
      <strong>${title}</strong>
      <button class="icon-button" id="modalClose">✕</button>
    </header>
    <div class="content">${content}</div>
    <footer></footer>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  const footer = modal.querySelector('footer');
  actions.forEach(({ label, className = 'btn btn-primary', onClick }) => {
    const btn = document.createElement('button');
    btn.className = className; btn.textContent = label;
    btn.addEventListener('click', async () => { if (onClick) await onClick({ backdrop, modal, close }); });
    footer.appendChild(btn);
  });
  const close = () => { backdrop.classList.remove('open'); document.body.removeChild(backdrop); };
  modal.querySelector('#modalClose').addEventListener('click', close);
  return { backdrop, modal, close };
}
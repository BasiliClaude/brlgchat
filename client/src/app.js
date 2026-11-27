// Fenêtre principale : navigation entre les pages Amis / Envoyer / Réglages
(() => {
  const api = window.livechat;
  const q = new URLSearchParams(location.search);
  if (q.get('platform') === 'darwin') document.body.classList.add('mac');

  const TABS = ['friends', 'send', 'settings'];
  let current = null;

  function go(tab) {
    if (!TABS.includes(tab) || tab === current) return;
    current = tab;
    document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.id === 'page-' + tab));
    // l'aperçu de l'écran se recalcule une fois la page visible
    if (tab === 'send') requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  window.lcGo = go;

  document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-goto]');
    if (t) go(t.dataset.goto);
  });
  api.onGoto(go);
  go(q.get('tab') || 'friends');

  // Remplissage coloré des curseurs (à gauche du bouton)
  function paintRange(r) {
    const p = ((r.value - r.min) / (r.max - r.min)) * 100;
    r.style.setProperty('--p', p + '%');
  }
  document.querySelectorAll('input[type=range]').forEach((r) => {
    paintRange(r);
    r.addEventListener('input', () => paintRange(r));
  });
  window.lcPaintRanges = () => document.querySelectorAll('input[type=range]').forEach(paintRange);

  // Classes globales : LITE (pas d'effets) et réception coupée
  function apply(s) {
    if (!s || !s.settings) return;
    document.body.classList.toggle('lite', !!s.settings.lite);
    document.body.classList.toggle('off', !s.settings.enabled);
    window.lcPaintRanges();
  }
  api.onState(apply);
  api.getState().then(apply);
})();

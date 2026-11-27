// Mise à jour de l'appli : bandeau dans la barre latérale + ligne « Version » des réglages
(() => {
  const api = window.livechat;
  const $ = (id) => document.getElementById(id);

  const STATUS = {
    dev: 'Version de développement',
    idle: '',
    checking: 'Recherche en cours…',
    latest: 'Tu as la dernière version',
    available: 'Nouvelle version trouvée',
    downloading: 'Téléchargement de la mise à jour…',
    ready: 'Mise à jour prête',
    manual: 'Nouvelle version disponible',
    error: 'Impossible de vérifier',
  };

  function render(u) {
    if (!u) return;
    $('appVersion').textContent = u.current;
    let st = STATUS[u.state] || '';
    if (u.state === 'downloading') st += ` ${u.percent || 0} %`;
    if (u.state === 'ready' || u.state === 'manual') st += ` : ${u.version}`;
    if (u.state === 'error' && u.error) st += ` (${u.error})`;
    $('updateStatus').textContent = st;
    $('checkUpdate').disabled = ['dev', 'checking', 'downloading'].includes(u.state);
    $('checkUpdate').textContent = u.state === 'ready' ? 'Redémarrer maintenant' : u.state === 'manual' ? 'Télécharger' : 'Rechercher une mise à jour';

    const b = $('updateBanner');
    b.hidden = !['downloading', 'ready', 'manual'].includes(u.state);
    b.classList.toggle('busy', u.state === 'downloading');
    if (u.state === 'downloading') {
      $('updateTitle').textContent = `Mise à jour ${u.version || ''}`;
      $('updateSub').textContent = `Téléchargement… ${u.percent || 0} %`;
      let bar = b.querySelector('.bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'bar';
        bar.append(document.createElement('i'));
        b.append(bar);
      }
      bar.style.setProperty('--p', (u.percent || 0) + '%');
    } else {
      b.querySelector('.bar')?.remove();
      $('updateTitle').textContent = u.state === 'manual' ? `Version ${u.version} dispo` : `Mise à jour ${u.version} prête`;
      $('updateSub').textContent = u.state === 'manual' ? 'Clique pour la télécharger' : 'Clique pour redémarrer';
    }
  }

  $('updateBanner').addEventListener('click', () => api.installUpdate());
  $('checkUpdate').addEventListener('click', async () => {
    const t = $('checkUpdate').textContent;
    if (/Redémarrer|Télécharger/.test(t)) return api.installUpdate();
    render(await api.checkUpdate());
  });
  api.onUpdate(render);
  api.getState().then((s) => render(s.update));
})();

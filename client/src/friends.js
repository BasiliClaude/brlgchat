// Page « Amis » : qui est en ligne, qui reçoit, qui a coupé la réception ou tout masqué.
(() => {
  const api = window.livechat;
  const $ = (id) => document.getElementById(id);
  let st = { connected: false, cid: null, clients: [] };

  const COLORS = [
    ['#ff375f', '#bf5af2'], ['#0a84ff', '#5e5ce6'], ['#30d158', '#0a84ff'],
    ['#ff9f0a', '#ff375f'], ['#64d2ff', '#5e5ce6'], ['#bf5af2', '#ff2d55'],
  ];
  function hash(s) {
    let h = 0;
    for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return Math.abs(h);
  }

  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'à l’instant';
    const m = Math.round(s / 60);
    if (m < 60) return `il y a ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `il y a ${h} h` + (m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : '');
    return `il y a ${Math.floor(h / 24)} j`;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function statusOf(c) {
    if (!c.version) return { cls: 'old', label: 'Ancienne version de l’appli' };
    if (c.enabled === false) return { cls: 'off', label: 'Réception coupée' };
    return { cls: 'on', label: 'Reçoit les pops' };
  }

  function avatar(c, dotCls) {
    const a = el('div', 'f-avatar');
    const [c1, c2] = COLORS[hash(c.name || c.cid) % COLORS.length];
    a.style.background = `linear-gradient(140deg, ${c1}, ${c2})`;
    const initial = (c.name || '?').trim().charAt(0).toUpperCase() || '?';
    if (c.avatar && /^https:\/\//.test(c.avatar)) {
      const img = new Image();
      img.alt = '';
      img.onerror = () => img.replaceWith(document.createTextNode(initial));
      img.src = c.avatar;
      a.append(img);
    } else a.append(document.createTextNode(initial));
    a.append(el('i', 'dot ' + dotCls));
    return a;
  }

  function card(c) {
    const me = c.cid === st.cid;
    const s = statusOf(c);
    const box = el('div', 'friend card glass ' + s.cls);

    const top = el('div', 'friend-top');
    const nm = el('div', 'f-name');
    nm.append(el('b', null, c.name || 'anonyme'), el('div', 'f-state ' + s.cls, s.label));
    top.append(avatar(c, s.cls), nm);
    box.append(top);

    const tags = el('div', 'tags');
    if (me) tags.append(el('span', 'tag me', 'moi'));
    if (c.linked) tags.append(el('span', 'tag discord', 'Discord lié'));
    if (c.lite) tags.append(el('span', 'tag lite', 'Mode LITE'));
    if (c.allowPlaced === false) tags.append(el('span', 'tag noplace', 'Refuse les envois placés'));
    // « tout masqué » récent (moins de 30 min) : souvent en pleine partie
    if (c.hiddenAt && Date.now() - c.hiddenAt < 30 * 60 * 1000) tags.append(el('span', 'tag hid', 'A tout masqué ' + ago(c.hiddenAt)));
    if (tags.childElementCount) box.append(tags);

    const meta = el('div', 'f-meta');
    const line = (k, v) => {
      if (!v) return;
      const b = el('b', null, v);
      meta.append(el('span', null, k), b);
    };
    line('En ligne', c.since ? ago(c.since).replace('il y a ', 'depuis ') : '');
    line('Écran', c.screen ? `${c.screen.w} × ${c.screen.h}` : '');
    if (c.hiddenAt && Date.now() - c.hiddenAt >= 30 * 60 * 1000) line('Dernier « masquer »', ago(c.hiddenAt));
    line('Version', c.version ? 'v' + c.version : 'trop ancienne pour le statut');
    box.append(meta);

    const btn = el('button', 'btn small', me ? 'M’envoyer un test' : 'Envoyer à ' + (c.name || 'cet ami'));
    btn.type = 'button';
    btn.disabled = c.enabled === false;
    btn.addEventListener('click', () => {
      window.lcGo('send');
      window.dispatchEvent(new CustomEvent('lc:sendto', { detail: c.cid }));
    });
    box.append(btn);
    return box;
  }

  function render() {
    const list = $('friends');
    list.textContent = '';
    const clients = [...(st.clients || [])];
    if (!st.connected) {
      const e = el('div', 'empty card glass');
      e.append(el('b', null, 'Pas connecté au serveur'), document.createElement('br'), document.createTextNode('Vérifie l’adresse et le mot de passe dans Réglages.'));
      const b = el('button', 'btn', 'Ouvrir les réglages');
      b.type = 'button';
      b.dataset.goto = 'settings';
      b.style.marginTop = '14px';
      e.append(document.createElement('br'), b);
      list.append(e);
      $('friendsSub').textContent = 'Hors ligne';
      return;
    }
    // moi d'abord, puis ceux qui reçoivent, puis les autres, par nom
    const rank = (c) => (c.cid === st.cid ? 0 : c.version && c.enabled !== false ? 1 : c.version ? 2 : 3);
    clients.sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'fr'));
    for (const c of clients) list.append(card(c));

    const others = clients.filter((c) => c.cid !== st.cid);
    const on = others.filter((c) => c.version && c.enabled !== false).length;
    const off = others.filter((c) => c.enabled === false).length;
    $('friendsSub').textContent = others.length
      ? `${others.length} ami${others.length > 1 ? 's' : ''} en ligne · ${on} reçoi${on > 1 ? 'vent' : 't'}` + (off ? ` · ${off} réception coupée` : '')
      : 'Personne d’autre n’est en ligne pour l’instant.';
    if (!others.length) {
      const e = el('div', 'empty card glass');
      e.append(el('b', null, 'Tu es seul pour l’instant'), document.createElement('br'), document.createTextNode('Tes amis apparaîtront ici dès qu’ils ouvrent LiveChat.'));
      list.append(e);
    }
    const badge = document.querySelector('.nav[data-tab=friends] .badge') || el('span', 'badge');
    badge.textContent = String(others.length);
    badge.hidden = !others.length;
    document.querySelector('.nav[data-tab=friends]').append(badge);
  }

  api.onSendStatus((s) => {
    st = s;
    render();
  });
  api.sendState().then((s) => {
    st = s;
    render();
  });
  // les « il y a X min » avancent tout seuls
  setInterval(render, 30000);
})();

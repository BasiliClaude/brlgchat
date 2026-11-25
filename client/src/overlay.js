// Affichage des "pops" : un à la fois, les suivants attendent dans une file.
(() => {
  const api = window.livechat;
  const stage = document.getElementById('stage');
  const MAX_QUEUE = 15;
  const TEXT_ONLY_SEC = 3; // texte seul
  const GIF_SEC = 5; // gifs
  const VIDEO_SAFETY_SEC = 600; // une vidéo se joue en entier (filet de sécurité à 10 min)
  const DISCORD_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];
  const GIF_SITES = ['tenor.com', 'giphy.com', 'klipy.com', 'klipy.co', 'imgur.com', 'gifdb.com'];

  let cfg = {
    position: 'top-right',
    maxWidthPct: 30,
    maxHeightPct: 35,
    durationSec: 10,
    volume: 50,
    showText: true,
    mediaBase: null,
    accessKey: '',
  };
  let queue = [];
  let current = null; // { token, el, timers: [], media }

  function hostAllowed(h) {
    return DISCORD_HOSTS.includes(h) || GIF_SITES.some((s) => h === s || h.endsWith('.' + s));
  }

  function safeUrl(u, allowData) {
    if (!u) return null;
    if (allowData && /^data:image\/(svg\+xml|png|gif|jpeg|webp);base64,/.test(u)) return u;
    try {
      const url = new URL(u);
      return url.protocol === 'https:' && hostAllowed(url.hostname) ? url.toString() : null;
    } catch {
      return null;
    }
  }

  // Média copié par notre serveur (prioritaire : le message Discord a pu être supprimé)
  function mediaUrl(m, isTest) {
    if (m.local && cfg.mediaBase && /^\/media\/[a-f0-9]+$/.test(m.local)) {
      return `${cfg.mediaBase}${m.local}?key=${encodeURIComponent(cfg.accessKey || '')}`;
    }
    return safeUrl(m.url, isTest);
  }

  function applyCfg() {
    document.body.className = 'pos-' + (cfg.position || 'top-right');
    document.documentElement.style.setProperty('--max-w', cfg.maxWidthPct + 'vw');
    document.documentElement.style.setProperty('--max-h', cfg.maxHeightPct + 'vh');
    if (current && current.media && current.media.tagName === 'VIDEO' && !current.media.muted) {
      current.media.volume = cfg.volume / 100;
    }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // jamais de innerHTML : le texte vient de Discord
    return e;
  }

  function buildHead(pop) {
    const head = el('div', 'head');
    const avatarUrl = safeUrl(pop.author && pop.author.avatar);
    const av = avatarUrl ? el('img', 'avatar') : el('div', 'avatar');
    if (avatarUrl) {
      av.src = avatarUrl;
      av.onerror = () => av.removeAttribute('src');
    }
    head.appendChild(av);
    head.appendChild(el('div', 'who outlined', (pop.author && pop.author.name) || 'Quelqu’un'));
    return head;
  }

  function finish(token) {
    if (!current || current.token !== token) return;
    const c = current;
    c.timers.forEach(clearTimeout);
    if (c.media && c.media.pause) c.media.pause();
    c.el.classList.add('out');
    current = { token: 'leaving', timers: [] };
    setTimeout(() => {
      c.el.remove();
      current = null;
      next();
    }, 150);
  }

  function after(token, seconds) {
    current.timers.push(setTimeout(() => finish(token), seconds * 1000));
  }

  function next() {
    if (current) return;
    const pop = queue.shift();
    if (!pop) {
      api.idle();
      return;
    }
    api.busy();
    const token = Symbol('pop');
    const card = el('div', 'pop');
    const block = el('div', 'block');
    card.appendChild(block);
    current = { token, el: card, timers: [], media: null };

    const m = pop.media;
    const url = m && mediaUrl(m, pop.test);
    const withText = cfg.showText;

    const show = (mediaEl) => {
      if (!current || current.token !== token) return;
      if (withText) block.appendChild(buildHead(pop));
      if (mediaEl) block.appendChild(mediaEl);
      if (withText && pop.text) card.appendChild(el('div', 'text outlined', pop.text));
      stage.appendChild(card);
    };
    // Si le média ne charge pas à temps, on passe au suivant
    current.timers.push(
      setTimeout(() => {
        if (!card.isConnected) finish(token);
      }, 15000)
    );

    if (!m || !url) {
      if (!pop.text || !withText) return finish(token);
      card.classList.add('text-only');
      show(null);
      after(token, TEXT_ONLY_SEC);
      return;
    }

    if (m.kind === 'image') {
      const img = el('img', 'media');
      img.decoding = 'async';
      img.onload = () => {
        show(img);
        after(token, m.gif || /\.gif(\?|$)/i.test(m.url || '') ? GIF_SEC : cfg.durationSec);
      };
      img.onerror = () => finish(token);
      img.src = url;
      current.media = img;
      return;
    }

    if (m.kind === 'video' || m.kind === 'audio') {
      const isAudio = m.kind === 'audio';
      const v = el(isAudio ? 'audio' : 'video', isAudio ? '' : 'media');
      v.autoplay = true;
      v.playsInline = true;
      v.preload = 'auto';
      if (m.gif) {
        // Les "gifs" Tenor/Klipy/Giphy sont des petites vidéos muettes en boucle
        v.muted = true;
        v.loop = true;
      } else {
        v.muted = false;
        v.volume = cfg.volume / 100;
      }
      let started = false;
      v.onloadeddata = () => {
        if (started) return;
        started = true;
        show(isAudio ? el('div', 'audio', '🔊') : v);
        v.play().catch(() => {
          // lecture avec le son refusée : on retente en muet plutôt que de ne rien montrer
          v.muted = true;
          v.play().catch(() => {});
        });
        // gif : 5 s ; vidéo / son : jusqu'à la fin (onended)
        after(token, m.gif ? GIF_SEC : VIDEO_SAFETY_SEC);
      };
      v.onended = () => finish(token);
      v.onerror = () => finish(token);
      v.src = url;
      current.media = v;
      return;
    }

    finish(token);
  }

  function clearAll() {
    queue = [];
    if (current && current.el) {
      current.timers.forEach(clearTimeout);
      if (current.media && current.media.pause) current.media.pause();
      current.el.remove();
    }
    current = null;
    stage.textContent = '';
    api.idle();
  }

  api.onOverlaySettings((s) => {
    cfg = { ...cfg, ...s };
    applyCfg();
  });
  api.onPop((pop) => {
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push(pop);
    next();
  });
  api.onClear(clearAll);
  applyCfg();
})();

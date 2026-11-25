// Affichage des "pops" : un à la fois, les suivants attendent dans une file.
(() => {
  const api = window.livechat;
  const stage = document.getElementById('stage');
  const MAX_QUEUE = 15;
  const ALLOWED_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

  let cfg = {
    position: 'top-right',
    maxWidthPct: 30,
    maxHeightPct: 35,
    durationSec: 10,
    maxVideoSec: 30,
    volume: 50,
    showText: true,
  };
  let queue = [];
  let current = null; // { el, timers: [], media }

  function safeUrl(u, allowData) {
    if (!u) return null;
    if (allowData && /^data:image\/(svg\+xml|png|gif|jpeg|webp);base64,/.test(u)) return u;
    try {
      const url = new URL(u);
      return url.protocol === 'https:' && ALLOWED_HOSTS.includes(url.hostname) ? url.toString() : null;
    } catch {
      return null;
    }
  }

  function applyCfg() {
    document.body.className = 'pos-' + (cfg.position || 'top-right');
    document.documentElement.style.setProperty('--max-w', cfg.maxWidthPct + 'vw');
    document.documentElement.style.setProperty('--max-h', cfg.maxHeightPct + 'vh');
    if (current && current.media && current.media.tagName === 'VIDEO') {
      current.media.volume = cfg.volume / 100;
    }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // jamais de innerHTML : le texte vient de Discord
    return e;
  }

  function buildCaption(pop) {
    if (!cfg.showText && pop.media) return null;
    const cap = el('div', 'caption');
    const avatarUrl = safeUrl(pop.author && pop.author.avatar);
    const av = avatarUrl ? el('img', 'avatar') : el('div', 'avatar');
    if (avatarUrl) {
      av.src = avatarUrl;
      av.onerror = () => (av.style.visibility = 'hidden');
    }
    cap.appendChild(av);
    const body = el('div');
    body.style.minWidth = '0';
    body.appendChild(el('div', 'who', (pop.author && pop.author.name) || 'Quelqu’un'));
    if (pop.text && cfg.showText) body.appendChild(el('div', 'text', pop.text));
    cap.appendChild(body);
    return cap;
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
    }, 250);
  }

  function startTimer(token, card, seconds) {
    const bar = el('div', 'bar');
    bar.style.animationDuration = seconds + 's';
    card.appendChild(bar);
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
    current = { token, el: card, timers: [], media: null };

    const m = pop.media;
    const url = m && safeUrl(m.url, pop.test);
    const caption = buildCaption(pop);

    const show = () => {
      if (!current || current.token !== token) return;
      if (caption) card.appendChild(caption);
      stage.appendChild(card);
    };
    // Si le média ne charge pas à temps, on passe au suivant
    current.timers.push(setTimeout(() => {
      if (!card.isConnected) finish(token);
    }, 12000));

    if (!m || !url) {
      if (!pop.text) return finish(token);
      card.classList.add('text-only');
      show();
      startTimer(token, card, Math.min(cfg.durationSec, 8));
      return;
    }

    if (m.kind === 'image') {
      const img = el('img', 'media');
      img.decoding = 'async';
      img.onload = () => {
        card.appendChild(img);
        show();
        startTimer(token, card, cfg.durationSec);
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
      v.volume = cfg.volume / 100;
      if (m.gif) {
        // Les "gifs" Tenor sont des petites vidéos muettes en boucle
        v.muted = true;
        v.loop = true;
      }
      let started = false;
      v.onloadeddata = () => {
        if (started) return;
        started = true;
        if (isAudio) card.appendChild(el('div', 'audio', '🔊'));
        else card.appendChild(v);
        show();
        v.play().catch(() => {});
        const len = m.gif || !isFinite(v.duration) ? cfg.durationSec : Math.min(v.duration, cfg.maxVideoSec);
        startTimer(token, card, Math.max(2, len + (m.gif ? 0 : 0.3)));
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

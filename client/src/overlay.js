// Affichage des "pops" : un à la fois, les suivants attendent dans une file.
(() => {
  const api = window.livechat;
  const stage = document.getElementById('stage');
  const MAX_QUEUE = 15;
  const TEXT_ONLY_SEC = 3; // texte seul
  const IMAGE_SEC = 5; // images et gifs
  const VIDEO_SAFETY_SEC = 600; // une vidéo se joue en entier (filet de sécurité à 10 min)
  const DISCORD_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];
  const GIF_SITES = ['tenor.com', 'giphy.com', 'klipy.com', 'klipy.co', 'imgur.com', 'gifdb.com'];

  let cfg = {
    position: 'top-right',
    maxWidthPct: 30,
    maxHeightPct: 35,
    volume: 50,
    showText: true,
    mediaBase: null,
    allowPlaced: true,
    accessKey: '',
  };
  let queue = [];

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
    document.body.className = 'pos-' + (cfg.position || 'top-right') + (cfg.lite ? ' lite' : '');
    document.documentElement.style.setProperty('--max-w', cfg.maxWidthPct + 'vw');
    document.documentElement.style.setProperty('--max-h', cfg.maxHeightPct + 'vh');
    for (const slot of [main, ...placedSlots]) {
      const md = slot.cur && slot.cur.media;
      if (md && md.tagName === 'VIDEO' && !md.muted) md.volume = cfg.volume / 100;
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

  // Un "emplacement" d'affichage : la file normale en a un seul (un pop à la fois) ;
  // chaque envoi placé a le sien, et s'affiche en même temps que le reste.
  const main = { cur: null, onDone: () => next() };
  const placedSlots = new Set();

  function anyBusy() {
    return !!main.cur || placedSlots.size > 0;
  }
  function maybeIdle() {
    if (!anyBusy() && !queue.length) api.idle();
  }

  function finish(slot, token) {
    if (!slot.cur || slot.cur.token !== token) return;
    const c = slot.cur;
    c.timers.forEach(clearTimeout);
    if (c.media && c.media.pause) c.media.pause();
    if (cfg.lite) {
      // pas d'animation de sortie
      c.el.remove();
      release(c.media);
      slot.cur = null;
      return slot.onDone();
    }
    c.el.classList.add('out');
    slot.cur = { token: 'leaving', timers: [] };
    setTimeout(() => {
      c.el.remove();
      release(c.media);
      slot.cur = null;
      slot.onDone();
    }, 150);
  }

  function next() {
    if (main.cur) return;
    const pop = queue.shift();
    if (!pop) return maybeIdle();
    play(pop, main);
  }

  function playPlaced(pop) {
    const slot = { cur: null };
    slot.onDone = () => {
      placedSlots.delete(slot);
      maybeIdle();
    };
    placedSlots.add(slot);
    play(pop, slot);
  }

  function play(pop, slot) {
    api.busy();
    const token = Symbol('pop');
    const card = el('div', 'pop');
    const block = el('div', 'block');
    card.appendChild(block);
    slot.cur = { token, el: card, timers: [], media: null };
    const done = () => finish(slot, token);
    const after = (seconds) => slot.cur.timers.push(setTimeout(done, seconds * 1000));

    const m = pop.media;
    const url = m && mediaUrl(m, pop.test);
    // Envoi "placé" depuis l'appli : position et taille choisies par l'envoyeur
    const placed = !!pop.layout && cfg.allowPlaced !== false;
    const bare = placed && !!pop.bare;
    const withText = cfg.showText && !bare;
    const withHead = withText && !pop.anonymous && !!(pop.author && pop.author.name);
    const imageSec = pop.fromApp ? pop.durationSec || IMAGE_SEC : IMAGE_SEC;
    const textSec = pop.fromApp ? pop.durationSec || TEXT_ONLY_SEC : TEXT_ONLY_SEC;
    if (placed) {
      card.classList.add('placed');
      if (bare) card.classList.add('bare');
      const { x, y, w, h } = pop.layout;
      card.style.left = x * 100 + 'vw';
      card.style.top = y * 100 + 'vh';
      card.style.width = w * 100 + 'vw';
      card.style.height = h * 100 + 'vh';
    }

    const show = (mediaEl) => {
      if (!slot.cur || slot.cur.token !== token) return;
      if (withHead) (placed ? card : block).appendChild(buildHead(pop));
      if (mediaEl) block.appendChild(mediaEl);
      if (withText && pop.text) (placed && !mediaEl ? block : card).appendChild(el('div', 'text outlined', pop.text));
      stage.appendChild(card);
    };
    // Si le média ne charge pas à temps, on passe au suivant
    slot.cur.timers.push(
      setTimeout(() => {
        if (!card.isConnected) done();
      }, 15000)
    );

    if (!m || !url) {
      if (!pop.text || !withText) return done();
      card.classList.add('text-only');
      show(null);
      after(textSec);
      return;
    }

    if (m.kind === 'image') {
      const img = el('img', 'media');
      img.decoding = 'async';
      img.onload = () => {
        show(img);
        after(imageSec);
      };
      img.onerror = done;
      img.src = url;
      slot.cur.media = img;
      return;
    }

    if (m.kind === 'video' || m.kind === 'audio') {
      const isAudio = m.kind === 'audio';
      const v = el(isAudio ? 'audio' : 'video', isAudio ? '' : 'media');
      v.autoplay = true;
      v.playsInline = true;
      v.preload = 'auto';
      const playFull = !m.gif && (!pop.fromApp || pop.playFull !== false);
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
        after(playFull ? VIDEO_SAFETY_SEC : imageSec);
      };
      v.onended = () => (playFull ? done() : v.play().catch(() => {}));
      v.onerror = done;
      v.src = url;
      slot.cur.media = v;
      return;
    }

    done();
  }

  // Libère le décodeur vidéo / l'image tout de suite (au lieu d'attendre le ramasse-miettes)
  function release(md) {
    if (!md) return;
    try {
      if (md.pause) md.pause();
      md.removeAttribute('src');
      if (md.load) md.load();
    } catch {
      /* rien */
    }
  }

  function clearSlot(slot) {
    if (slot.cur && slot.cur.el) {
      slot.cur.timers.forEach(clearTimeout);
      release(slot.cur.media);
      slot.cur.el.remove();
    }
    slot.cur = null;
  }

  function clearAll() {
    queue = [];
    clearSlot(main);
    placedSlots.forEach(clearSlot);
    placedSlots.clear();
    stage.textContent = '';
    api.idle();
  }

  api.onOverlaySettings((s) => {
    cfg = { ...cfg, ...s };
    applyCfg();
  });
  api.onPop((pop) => {
    // les envois placés s'affichent tout de suite, sans attendre la file
    if (pop.layout && cfg.allowPlaced !== false) return playPlaced(pop);
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push(pop);
    next();
  });
  api.onClear(clearAll);
  applyCfg();
})();

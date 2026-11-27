// Fenêtre « Envoyer » : choisir un média, les destinataires, et le placer
// au pixel près sur l'écran du destinataire.
(() => {
  const api = window.livechat;
  const $ = (id) => document.getElementById(id);

  let st = { connected: false, cid: null, clients: [], myScreen: { w: 1920, h: 1080 } };
  let target = { w: 1920, h: 1080 }; // résolution de l'écran affiché dans l'aperçu
  let mode = 'normal'; // 'normal' | 'placed'
  let L = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }; // placement, en fraction de l'écran
  let file = null; // { blob, type, name, url, uploaded: '/media/…' }
  let natural = null; // taille d'origine du média { w, h } en pixels
  const selected = new Set();
  let toAll = false;

  // ---------- Destinataires ----------
  function renderPeople() {
    const box = $('people');
    box.textContent = '';
    const list = st.clients || [];
    if (!st.connected) {
      box.innerHTML = '<div class="muted small">Pas connecté au serveur.</div>';
    } else if (!list.length) {
      box.innerHTML = '<div class="muted small">Personne n’est connecté.</div>';
    }
    for (const c of list) {
      const row = document.createElement('label');
      row.className = 'person' + (c.enabled === false ? ' off' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = toAll || selected.has(c.cid);
      cb.disabled = toAll;
      cb.addEventListener('change', () => {
        cb.checked ? selected.add(c.cid) : selected.delete(c.cid);
        renderPreviewChoices();
      });
      const name = document.createElement('span');
      name.textContent = c.name || 'anonyme';
      row.append(cb, name);
      if (c.cid === st.cid) {
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = '(moi, pour tester)';
        row.append(t);
      }
      if (c.enabled === false || c.allowPlaced === false) {
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = c.enabled === false ? 'réception coupée' : 'refuse le placement';
        row.append(t);
      }
      const res = document.createElement('span');
      res.className = 'res';
      res.textContent = c.screen ? `${c.screen.w}×${c.screen.h}` : '';
      row.append(res);
      box.append(row);
    }
    // on oublie les amis partis
    for (const cid of [...selected]) if (!list.some((c) => c.cid === cid)) selected.delete(cid);
    renderPreviewChoices();
  }

  // Depuis la page Amis : « Envoyer » sur la carte d'un ami
  window.addEventListener('lc:sendto', (e) => {
    toAll = false;
    $('toAll').checked = false;
    selected.clear();
    selected.add(e.detail);
    renderPeople();
  });

  $('toAll').addEventListener('change', (e) => {
    toAll = e.target.checked;
    renderPeople();
  });

  // Choix de l'écran affiché dans l'aperçu (parmi les destinataires)
  function renderPreviewChoices() {
    const sel = $('previewOf');
    const prev = sel.value;
    sel.textContent = '';
    const list = (st.clients || []).filter((c) => (toAll || selected.has(c.cid)) && c.screen);
    const opts = list.length ? list : [{ cid: '__me', name: 'moi', screen: st.myScreen }];
    for (const c of opts) {
      const o = new Option(`${c.cid === st.cid ? 'moi' : c.name} (${c.screen.w}×${c.screen.h})`, c.cid);
      o.dataset.w = c.screen.w;
      o.dataset.h = c.screen.h;
      sel.add(o);
    }
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    applyPreviewScreen();
  }
  $('previewOf').addEventListener('change', applyPreviewScreen);

  function applyPreviewScreen() {
    const o = $('previewOf').selectedOptions[0];
    const w = o ? Number(o.dataset.w) : st.myScreen.w;
    const h = o ? Number(o.dataset.h) : st.myScreen.h;
    if (w !== target.w || h !== target.h) {
      // on garde la taille en pixels et le centre de l'élément sur le nouvel écran
      const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
      L.w = (L.w * target.w) / w;
      L.h = (L.h * target.h) / h;
      L.x = cx - L.w / 2;
      L.y = cy - L.h / 2;
      target = { w, h };
    }
    $('screenRes').textContent = `${w} × ${h} px`;
    fitScreen();
  }

  // ---------- Aperçu à l'échelle ----------
  function fitScreen() {
    const wrap = $('stageWrap');
    const maxW = wrap.clientWidth - 36;
    const maxH = wrap.clientHeight - 36;
    const scale = Math.min(maxW / target.w, maxH / target.h);
    const scr = $('screen');
    scr.style.width = Math.max(100, Math.round(target.w * scale)) + 'px';
    scr.style.height = Math.max(60, Math.round(target.h * scale)) + 'px';
    drawBox();
  }
  window.addEventListener('resize', fitScreen);

  const px = (f, dim) => Math.round(f * dim);

  function drawBox() {
    const box = $('box');
    box.hidden = mode !== 'placed';
    $('normalHint').hidden = mode === 'placed';
    if (mode !== 'placed') return;
    box.style.left = L.x * 100 + '%';
    box.style.top = L.y * 100 + '%';
    box.style.width = L.w * 100 + '%';
    box.style.height = L.h * 100 + '%';
    const X = px(L.x, target.w), Y = px(L.y, target.h), W = px(L.w, target.w), H = px(L.h, target.h);
    $('boxLabel').textContent = `${X}, ${Y} · ${W}×${H}`;
    for (const [id, v] of [['nx', X], ['ny', Y], ['nw', W], ['nh', H]]) {
      if (document.activeElement !== $(id)) $(id).value = v;
    }
  }

  // ---------- Média ----------
  function setMedia(blob, name) {
    if (!/^(image|video|audio)\//.test(blob.type)) return result('Ce fichier n’est pas une image, un gif ou une vidéo.', 'err');
    if (file && file.url) URL.revokeObjectURL(file.url);
    file = { blob, type: blob.type, name: name || 'collé', url: URL.createObjectURL(blob), uploaded: null };
    $('link').value = '';
    $('fileName').textContent = `${file.name} (${Math.round(blob.size / 1024)} Ko)`;
    loadPreview(file.url, blob.type.split('/')[0]);
  }

  function clearMedia() {
    if (file && file.url) URL.revokeObjectURL(file.url);
    file = null;
    natural = null;
    $('file').value = '';
    $('link').value = '';
    $('fileName').textContent = 'Ou glisse un fichier ici, ou colle une image (Ctrl+V).';
    renderBoxContent(null);
  }

  function renderBoxContent(el) {
    const c = $('boxContent');
    c.textContent = '';
    if (el) c.append(el);
    else {
      const ph = document.createElement('div');
      ph.className = 'ph';
      ph.textContent = $('text').value || (($('link').value || '').trim() ? 'Lien (aperçu après envoi)' : 'Ton média ici');
      c.append(ph);
    }
  }

  function loadPreview(url, kind) {
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => {
        natural = { w: img.naturalWidth, h: img.naturalHeight };
        renderBoxContent(img);
        placeNative(true);
      };
      img.onerror = () => renderBoxContent(null);
      img.src = url;
    } else if (kind === 'video') {
      const v = document.createElement('video');
      v.muted = true;
      v.loop = true;
      v.autoplay = true;
      v.playsInline = true;
      v.onloadedmetadata = () => {
        natural = { w: v.videoWidth, h: v.videoHeight };
        renderBoxContent(v);
        placeNative(true);
      };
      v.onerror = () => renderBoxContent(null);
      v.src = url;
    } else {
      natural = null;
      renderBoxContent(null);
    }
  }

  $('pickFile').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', (e) => e.target.files[0] && setMedia(e.target.files[0], e.target.files[0].name));
  $('clearMedia').addEventListener('click', clearMedia);

  let linkTimer;
  $('link').addEventListener('input', () => {
    clearTimeout(linkTimer);
    linkTimer = setTimeout(() => {
      const u = $('link').value.trim();
      if (!u) return;
      if (file) {
        if (file.url) URL.revokeObjectURL(file.url);
        file = null;
        $('fileName').textContent = 'Lien choisi.';
      }
      natural = null;
      // Aperçu direct si c'est un fichier image/vidéo ; sinon (page de gif) le serveur s'en chargera
      if (/^https:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(u)) loadPreview(u, 'image');
      else if (/^https:\/\/\S+\.(mp4|webm)(\?\S*)?$/i.test(u)) loadPreview(u, 'video');
      else renderBoxContent(null);
    }, 400);
  });
  $('text').addEventListener('input', () => {
    if (!natural) renderBoxContent(null);
  });

  // Glisser-déposer et coller
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('dragover');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('dragover');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) {
      if (window.lcGo) window.lcGo('send');
      setMedia(f, f.name);
    }
  });
  document.addEventListener('paste', (e) => {
    if (!document.getElementById('page-send').classList.contains('on')) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file');
    if (item) {
      e.preventDefault();
      setMedia(item.getAsFile(), 'image collée');
    }
  });

  // ---------- Placement ----------
  function setMode(m) {
    mode = m;
    $('modeNormal').classList.toggle('on', m === 'normal');
    $('modePlaced').classList.toggle('on', m === 'placed');
    $('placedTools').hidden = m !== 'placed';
    drawBox();
  }
  $('modeNormal').addEventListener('click', () => setMode('normal'));
  $('modePlaced').addEventListener('click', () => setMode('placed'));

  const lockRatio = () => $('lockRatio').checked;
  // rapport largeur/hauteur du média, exprimé en fractions d'écran
  function fracRatio() {
    if (!natural) return null;
    return (natural.w / target.w) / (natural.h / target.h);
  }
  function keepRatio(from) {
    const r = fracRatio();
    if (!r) return;
    if (from === 'w') L.h = L.w / r;
    else L.w = L.h * r;
  }

  function placeNative(onlyIfNew) {
    if (!natural) return;
    let w = natural.w / target.w;
    let h = natural.h / target.h;
    const k = Math.min(1, 0.6 / w, 0.6 / h); // pas plus de 60 % de l'écran par défaut
    if (!onlyIfNew) {
      L.w = w;
      L.h = h;
    } else {
      L.w = w * k;
      L.h = h * k;
    }
    centerBox();
  }
  function centerBox() {
    L.x = (1 - L.w) / 2;
    L.y = (1 - L.h) / 2;
    drawBox();
  }
  $('center').addEventListener('click', centerBox);
  $('native').addEventListener('click', () => placeNative(false));
  $('fill').addEventListener('click', () => {
    L = { x: 0, y: 0, w: 1, h: 1 };
    drawBox();
  });

  // Saisie des valeurs en pixels
  for (const id of ['nx', 'ny', 'nw', 'nh']) {
    $(id).addEventListener('input', () => {
      const v = Number($(id).value);
      if (!Number.isFinite(v)) return;
      if (id === 'nx') L.x = v / target.w;
      if (id === 'ny') L.y = v / target.h;
      if (id === 'nw' && v > 0) {
        L.w = v / target.w;
        if (lockRatio()) keepRatio('w');
      }
      if (id === 'nh' && v > 0) {
        L.h = v / target.h;
        if (lockRatio()) keepRatio('h');
      }
      drawBox();
    });
  }

  // Glisser / redimensionner à la souris, avec aimant sur le centre et les bords
  let drag = null;
  $('box').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    $('box').focus();
    const rect = $('screen').getBoundingClientRect();
    drag = { h: e.target.dataset.h || 'move', sx: e.clientX, sy: e.clientY, L0: { ...L }, rect };
    $('box').setPointerCapture(e.pointerId);
  });
  $('box').addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.rect.width;
    const dy = (e.clientY - drag.sy) / drag.rect.height;
    const o = drag.L0;
    const MIN = 2 / target.w;
    let { x, y, w, h } = o;
    const hd = drag.h;
    if (hd === 'move') {
      x = o.x + dx;
      y = o.y + dy;
    } else {
      if (hd.includes('e')) w = Math.max(MIN, o.w + dx);
      if (hd.includes('s')) h = Math.max(MIN, o.h + dy);
      if (hd.includes('w')) {
        w = Math.max(MIN, o.w - dx);
        x = o.x + o.w - w;
      }
      if (hd.includes('n')) {
        h = Math.max(MIN, o.h - dy);
        y = o.y + o.h - h;
      }
      const r = fracRatio();
      if (lockRatio() && r) {
        if (hd === 'n' || hd === 's') w = h * r;
        else h = w / r;
        // garder le coin opposé fixe
        if (hd.includes('w')) x = o.x + o.w - w;
        if (hd.includes('n')) y = o.y + o.h - h;
        if (hd === 'n' || hd === 's') x = o.x + (o.w - w) / 2;
        if (hd === 'e' || hd === 'w') y = o.y + (o.h - h) / 2;
      }
    }
    // Aimant (désactivé avec Alt)
    let snapV = false, snapH = false;
    if (!e.altKey && hd === 'move') {
      const tolX = 8 / drag.rect.width, tolY = 8 / drag.rect.height;
      if (Math.abs(x + w / 2 - 0.5) < tolX) { x = 0.5 - w / 2; snapV = true; }
      if (Math.abs(y + h / 2 - 0.5) < tolY) { y = 0.5 - h / 2; snapH = true; }
      if (Math.abs(x) < tolX) x = 0;
      if (Math.abs(y) < tolY) y = 0;
      if (Math.abs(x + w - 1) < tolX) x = 1 - w;
      if (Math.abs(y + h - 1) < tolY) y = 1 - h;
    }
    document.querySelector('.gv').classList.toggle('snap', snapV);
    document.querySelector('.gh').classList.toggle('snap', snapH);
    L = { x, y, w, h };
    drawBox();
  });
  const endDrag = () => {
    drag = null;
    document.querySelectorAll('.guide').forEach((g) => g.classList.remove('snap'));
  };
  $('box').addEventListener('pointerup', endDrag);
  $('box').addEventListener('pointercancel', endDrag);

  // Flèches : 1 px (Maj : 10 px) sur l'écran du destinataire
  $('box').addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!moves[e.key]) return;
    e.preventDefault();
    L.x += moves[e.key][0] / target.w;
    L.y += moves[e.key][1] / target.h;
    drawBox();
  });

  // ---------- Options ----------
  const showDur = () => ($('durVal').textContent = $('duration').value + ' s');
  $('duration').addEventListener('input', showDur);
  // Envoyer avec Ctrl+Entrée
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && document.getElementById('page-send').classList.contains('on')) $('send').click();
  });
  showDur();

  function result(msg, cls) {
    const r = $('result');
    r.textContent = msg;
    r.className = 'result ' + (cls || '');
  }

  // ---------- Envoi ----------
  $('send').addEventListener('click', async () => {
    const to = toAll ? 'all' : [...selected];
    if (to !== 'all' && !to.length) return result('Choisis au moins un destinataire.', 'err');
    const link = $('link').value.trim();
    const text = $('text').value.trim();
    if (!file && !link && !text) return result('Ajoute un média, un lien ou un texte.', 'err');
    if (link && !/^https:\/\//i.test(link)) return result('Le lien doit commencer par https://', 'err');

    $('send').disabled = true;
    try {
      let local = null;
      if (file) {
        if (!file.uploaded) {
          result('Envoi du fichier au serveur…');
          const bytes = await file.blob.arrayBuffer();
          const up = await api.upload(bytes, file.type);
          if (up.error) return result(up.error, 'err');
          file.uploaded = up.local;
        }
        local = file.uploaded;
      }
      result('Envoi…');
      const payload = {
        to,
        local,
        link: !file && link ? link : null,
        text,
        layout: mode === 'placed' ? { ...L } : null,
        bare: mode === 'placed' && $('bare').checked,
        anonymous: $('anonymous').checked,
        durationSec: Number($('duration').value),
        playFull: $('playFull').checked,
      };
      let r = await api.submit(payload);
      if (r.error && /expiré/.test(r.error) && file) {
        // le serveur a oublié le fichier (15 min) : on le renvoie
        file.uploaded = null;
        const up = await api.upload(await file.blob.arrayBuffer(), file.type);
        if (up.error) return result(up.error, 'err');
        file.uploaded = up.local;
        r = await api.submit({ ...payload, local: up.local });
      }
      if (r.error) return result(r.error, 'err');
      result(`Envoyé à ${r.n} ami${r.n > 1 ? 's' : ''} ✔`, 'ok');
    } finally {
      $('send').disabled = false;
    }
  });

  // ---------- État / connexion ----------
  function renderConn() {
    const c = $('conn');
    c.className = 'hidden-status';
    c.textContent = st.connected ? `Connecté · ${(st.clients || []).length} en ligne` : 'Pas connecté au serveur (vérifie les paramètres)';
    $('send').disabled = !st.connected;
  }

  function update(s) {
    st = s;
    renderConn();
    renderPeople();
  }
  api.onSendStatus(update);
  api.sendState().then((s) => {
    update(s);
    renderBoxContent(null);
    fitScreen();
  });
})();

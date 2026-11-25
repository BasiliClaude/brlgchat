(() => {
  const api = window.livechat;
  const $ = (id) => document.getElementById(id);
  let state = null;

  const RANGES = {
    maxWidthPct: (v) => v + ' %',
    maxHeightPct: (v) => v + ' %',
    durationSec: (v) => v + ' s',
    volume: (v) => v + ' %',
  };

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  function renderStatus(st) {
    const el = $('status');
    el.className = 'status';
    if (!st.enabled) {
      el.textContent = 'Réception désactivée';
      el.classList.add('off');
    } else if (st.state === 'connected') {
      const names = (st.names || []).filter(Boolean);
      el.textContent = `Connecté · ${st.count} en ligne` + (names.length ? ` (${names.join(', ')})` : '');
      el.classList.add('ok');
    } else if (st.state === 'connecting') {
      el.textContent = st.error ? `Reconnexion… ${st.error}` : 'Connexion au serveur…';
      el.classList.add('wait');
    } else {
      el.textContent = st.error || 'Déconnecté';
      el.classList.add('off');
    }
  }

  function render(s) {
    state = s;
    const set = s.settings;
    for (const k of ['serverUrl', 'accessKey', 'nickname']) {
      if (document.activeElement !== $(k)) $(k).value = set[k] || '';
    }
    $('enabled').checked = set.enabled;
    $('enabledLabel').textContent = set.enabled ? 'ON' : 'OFF';
    $('showText').checked = set.showText;
    $('autoStart').checked = set.autoStart;
    for (const [k, fmt] of Object.entries(RANGES)) {
      $(k).value = set[k];
      $(k + 'Val').textContent = fmt(set[k]);
    }
    const sel = $('displayId');
    sel.textContent = '';
    const primary = new Option('Écran principal (par défaut)', '');
    sel.add(primary);
    for (const d of s.displays) sel.add(new Option(d.label, d.id));
    sel.value = set.displayId && s.displays.some((d) => d.id === String(set.displayId)) ? String(set.displayId) : '';
    document.querySelectorAll('#positionGrid button').forEach((b) => b.classList.toggle('on', b.dataset.pos === set.position));
    document.querySelectorAll('.hotkey').forEach((b) => {
      if (!b.classList.contains('recording')) b.textContent = pretty(set[b.dataset.key]) || 'Aucun';
    });
    document.querySelectorAll('[data-err]').forEach((e) => (e.textContent = (s.hotkeyErrors || {})[e.dataset.err] || ''));
    renderStatus(s.status);
  }

  async function save(patch, msg) {
    render(await api.save(patch));
    if (msg) toast(msg);
  }

  // Champs texte : sauvegarde après une courte pause de frappe
  for (const k of ['serverUrl', 'accessKey', 'nickname']) {
    let t;
    $(k).addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => save({ [k]: $(k).value.trim() }, 'Enregistré'), 700);
    });
  }
  $('showKey').addEventListener('click', () => {
    const i = $('accessKey');
    i.type = i.type === 'password' ? 'text' : 'password';
    $('showKey').textContent = i.type === 'password' ? 'Voir' : 'Cacher';
  });

  $('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }, e.target.checked ? 'Réception activée' : 'Réception désactivée'));
  $('showText').addEventListener('change', (e) => save({ showText: e.target.checked }));
  $('autoStart').addEventListener('change', (e) => save({ autoStart: e.target.checked }));
  $('displayId').addEventListener('change', (e) => save({ displayId: e.target.value || null }, 'Écran changé'));
  $('identify').addEventListener('click', () => api.identify());
  $('test').addEventListener('click', () => api.test());

  for (const [k, fmt] of Object.entries(RANGES)) {
    $(k).addEventListener('input', (e) => ($(k + 'Val').textContent = fmt(e.target.value)));
    $(k).addEventListener('change', (e) => save({ [k]: Number(e.target.value) }));
  }
  document.querySelectorAll('#positionGrid button').forEach((b) =>
    b.addEventListener('click', () => save({ position: b.dataset.pos }))
  );

  // ---------- Enregistrement des raccourcis ----------
  const isMac = navigator.platform.toLowerCase().includes('mac');

  function pretty(accel) {
    if (!accel) return '';
    return accel
      .replace('CommandOrControl', isMac ? 'Cmd' : 'Ctrl')
      .replace('Control', 'Ctrl')
      .replace('Command', 'Cmd')
      .split('+')
      .join(' + ');
  }

  function keyName(e) {
    const c = e.code;
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit[0-9]$/.test(c)) return c.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c;
    if (/^Numpad[0-9]$/.test(c)) return 'num' + c.slice(6);
    const map = {
      Space: 'Space', Tab: 'Tab', Enter: 'Enter', Insert: 'Insert', Delete: 'Delete',
      Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
      ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
      Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
      NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult',
      NumpadDivide: 'numdiv', NumpadDecimal: 'numdec', Pause: 'Pause', ScrollLock: 'Scrolllock',
    };
    return map[c] || null;
  }

  let recording = null;
  function stopRecording(btn) {
    btn.classList.remove('recording');
    recording = null;
    api.resumeHotkeys();
    btn.textContent = pretty(state.settings[btn.dataset.key]) || 'Aucun';
  }

  document.querySelectorAll('.hotkey').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (recording) stopRecording(recording);
      recording = btn;
      btn.classList.add('recording');
      btn.textContent = 'Appuie sur la combinaison…';
      api.pauseHotkeys();
    });
    btn.addEventListener('blur', () => recording === btn && stopRecording(btn));
  });

  window.addEventListener('keydown', async (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    const btn = recording;
    if (e.key === 'Escape') return stopRecording(btn);
    if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      btn.classList.remove('recording');
      recording = null;
      await save({ [btn.dataset.key]: '' }, 'Raccourci effacé');
      api.resumeHotkeys();
      return;
    }
    const k = keyName(e);
    if (!k) return; // touche modificatrice seule : on attend la suite
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.metaKey) mods.push(isMac ? 'Command' : 'Super');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (!mods.length && !/^F\d+$/.test(k)) {
      btn.textContent = 'Ajoute Ctrl, Alt ou Shift…';
      return;
    }
    const accel = [...mods, k].join('+');
    const other = btn.dataset.key === 'hotkeyHide' ? 'hotkeyToggle' : 'hotkeyHide';
    if (state.settings[other] === accel) {
      btn.textContent = 'Déjà utilisé pour l’autre action';
      return;
    }
    btn.classList.remove('recording');
    recording = null;
    await save({ [btn.dataset.key]: accel }, 'Raccourci enregistré');
    api.resumeHotkeys();
  });

  api.onStatus((st) => {
    if (state) state.status = st;
    renderStatus(st);
  });
  api.onState(render);
  api.getState().then(render);
})();

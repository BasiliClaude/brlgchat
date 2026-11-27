const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, shell, Notification } = require('electron');
const path = require('path');
const { SettingsStore } = require('./settings-store');
const { Connection } = require('./connection');
const { Updater } = require('./updater');
const updater = new Updater();
updater.on('state', (st) => {
  refreshTray();
  if (appWin) appWin.webContents.send('update:state', st);
});

// Une seule instance de l'appli à la fois
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const ASSETS = path.join(__dirname, '..', 'assets');

// Mode LITE : lu avant le démarrage, car certains réglages de Chromium
// (accélération matérielle) ne peuvent être changés qu'au lancement.
const LITE_AT_START = (() => {
  try {
    const f = path.join(app.getPath('userData'), 'settings.json');
    return !!JSON.parse(require('fs').readFileSync(f, 'utf8')).lite;
  } catch {
    return false;
  }
})();
if (LITE_AT_START) {
  app.disableHardwareAcceleration(); // pas de processus GPU permanent
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');
  app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,MediaRouter,BackForwardCache');
}
let store;
let tray = null;
let overlay = null;
let appWin = null;
let quitting = false;
const conn = new Connection();

// ---------- Fenêtre d'affichage (transparente, au premier plan, clics traversants) ----------

function targetDisplay() {
  const { displayId } = store.get();
  const all = screen.getAllDisplays();
  return all.find((d) => String(d.id) === String(displayId)) || screen.getPrimaryDisplay();
}

function createOverlay() {
  const d = targetDisplay();
  overlay = new BrowserWindow({
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadFile(path.join(__dirname, 'overlay.html'));
  overlay.webContents.on('did-finish-load', () => sendOverlaySettings());
  overlay.on('closed', () => (overlay = null));
  overlay.webContents.setBackgroundThrottling(true);
  // Bloque toute navigation / ouverture de fenêtre depuis l'overlay
  overlay.webContents.on('will-navigate', (e) => e.preventDefault());
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function placeOverlay() {
  reportScreen();
  if (!overlay) return;
  const d = targetDisplay();
  overlay.setBounds(d.bounds);
  sendOverlaySettings();
}

// Indique au serveur la résolution de l'écran d'affichage (pour l'éditeur des amis)
function screenOf(d) {
  return { w: Math.round(d.bounds.width * d.scaleFactor), h: Math.round(d.bounds.height * d.scaleFactor) };
}
function reportScreen() {
  conn.send({ type: 'screen', ...screenOf(targetDisplay()) });
}
conn.on('open', reportScreen);

function sendOverlaySettings() {
  if (!overlay) return;
  const s = store.get();
  overlay.webContents.send('overlay:settings', {
    position: s.position,
    maxWidthPct: s.maxWidthPct,
    maxHeightPct: s.maxHeightPct,
    durationSec: s.durationSec,
    maxVideoSec: s.maxVideoSec,
    volume: s.volume,
    showText: s.showText,
    allowPlaced: s.allowPlaced,
    lite: s.lite,
    mediaBase: mediaBase(s.serverUrl),
    accessKey: s.accessKey,
  });
}

// Adresse http(s) du serveur, d'où l'on télécharge les médias copiés
function mediaBase(serverUrl) {
  let u = String(serverUrl || '').trim();
  if (!u) return null;
  if (!/^[a-z]+:\/\//i.test(u)) u = 'wss://' + u;
  try {
    const url = new URL(u.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:'));
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

// En mode LITE, la fenêtre d'affichage est détruite quand rien ne s'affiche
// (libère sa mémoire) et recréée au prochain pop.
let overlayIdleTimer = null;
const LITE_OVERLAY_TTL_MS = 15000;

function showPop(pop) {
  clearTimeout(overlayIdleTimer);
  if (!overlay) createOverlay();
  const send = () => overlay.webContents.send('overlay:pop', pop);
  if (overlay.webContents.isLoading()) overlay.webContents.once('did-finish-load', send);
  else send();
}

function hideNow() {
  if (overlay) overlay.webContents.send('overlay:clear');
  reportState({ hidden: true });
}

ipcMain.on('overlay:busy', () => {
  clearTimeout(overlayIdleTimer);
  if (overlay && !overlay.isVisible()) {
    overlay.webContents.setBackgroundThrottling(false);
    overlay.showInactive();
    overlay.setAlwaysOnTop(true, 'screen-saver');
  }
});
ipcMain.on('overlay:idle', () => {
  if (!overlay) return;
  if (overlay.isVisible()) overlay.hide();
  // Fenêtre cachée : Chromium peut la mettre en veille
  overlay.webContents.setBackgroundThrottling(true);
  clearTimeout(overlayIdleTimer);
  if (store.get().lite) {
    overlayIdleTimer = setTimeout(() => {
      if (overlay && !overlay.isVisible()) overlay.destroy();
    }, LITE_OVERLAY_TTL_MS);
  }
});

// ---------- Réception ----------

conn.on('pop', (pop) => {
  if (!store.get().enabled) return;
  delete pop.test; // seul le bouton "Tester" local peut afficher une image intégrée
  showPop(pop);
});
conn.on('status', () => {
  if (appWin) appWin.webContents.send('send:status', senderState());
  refreshTray();
  if (appWin) appWin.webContents.send('settings:status', statusForUi());
});

// Code à taper sur Discord (!lier 123456) pour lier l'appli à son compte
const linkCode = String(require('crypto').randomInt(100000, 1000000));

conn.on('linked', (msg) => {
  store.set({ discordId: String(msg.id || ''), discordName: String(msg.name || '').slice(0, 64) });
  if (appWin) appWin.webContents.send('settings:state', fullState());
  if (Notification.isSupported()) {
    new Notification({ title: 'LiveChat', body: `Appli liée au compte Discord ${msg.name}.`, silent: true }).show();
  }
});

// On reste connecté même réception coupée : les amis voient ton statut,
// et le serveur ne t'envoie simplement plus rien.
function applyConnection() {
  const s = store.get();
  conn.connect({ ...s, linkCode });
}

function reportState(extra) {
  const s = store.get();
  conn.send({ type: 'state', enabled: s.enabled, lite: s.lite, allowPlaced: s.allowPlaced !== false, version: app.getVersion(), ...extra });
}
conn.on('open', () => reportState());

function statusForUi() {
  return { ...conn.status, enabled: store.get().enabled };
}

function setEnabled(on) {
  store.set({ enabled: on });
  if (!on && overlay) overlay.webContents.send('overlay:clear');
  reportState();
  refreshTray();
  if (appWin) appWin.webContents.send('settings:state', fullState());
}

// ---------- Raccourcis clavier globaux ----------

let hotkeyErrors = {};
function registerHotkeys() {
  globalShortcut.unregisterAll();
  hotkeyErrors = {};
  const s = store.get();
  const pairs = [
    ['hotkeyHide', s.hotkeyHide, hideNow],
    ['hotkeyToggle', s.hotkeyToggle, () => setEnabled(!store.get().enabled)],
  ];
  for (const [key, accel, fn] of pairs) {
    if (!accel) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(accel, fn);
    } catch {
      ok = false;
    }
    if (!ok) hotkeyErrors[key] = 'Raccourci déjà utilisé par une autre appli ou invalide';
  }
}

// ---------- Icône dans la barre des tâches ----------

function trayImage(on) {
  const img = nativeImage.createFromPath(path.join(ASSETS, on ? 'tray-on.png' : 'tray-off.png'));
  if (process.platform === 'darwin') return img.resize({ width: 18, height: 18 });
  return img;
}

function statusLabel() {
  const s = store.get();
  const st = conn.status;
  if (!s.enabled) return 'Réception désactivée';
  if (st.state === 'connected') return `Connecté · ${st.count} ami(s) en ligne`;
  if (st.state === 'connecting') return st.error ? `Reconnexion… (${st.error})` : 'Connexion…';
  return st.error || 'Déconnecté';
}

function refreshTray() {
  if (!tray) return;
  const s = store.get();
  tray.setImage(trayImage(s.enabled && conn.status.state === 'connected'));
  tray.setToolTip(`LiveChat - ${statusLabel()}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: statusLabel(), enabled: false },
      ...(updater.state.state === 'ready'
        ? [{ label: `Redémarrer pour mettre à jour (${updater.state.version})`, click: () => updater.install() }]
        : updater.state.state === 'manual'
          ? [{ label: `Télécharger la version ${updater.state.version}…`, click: () => updater.openDownload() }]
          : []),
      { type: 'separator' },
      {
        label: 'Réception activée',
        type: 'checkbox',
        checked: s.enabled,
        accelerator: s.hotkeyToggle || undefined,
        click: (item) => setEnabled(item.checked),
      },
      { label: 'Masquer ce qui s’affiche', accelerator: s.hotkeyHide || undefined, click: hideNow },
      { label: 'Tester l’affichage', click: testPop },
      { type: 'separator' },
      { label: 'Amis en ligne…', click: openFriends },
      { label: 'Envoyer quelque chose…', click: openSender },
      { label: 'Paramètres…', click: openSettings },
      { label: 'Quitter LiveChat', click: () => app.quit() },
    ])
  );
}

function createTray() {
  tray = new Tray(trayImage(false));
  tray.on('click', openFriends);
  refreshTray();
}

// ---------- Fenêtre de paramètres ----------

function displaysForUi() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label:
      `Écran ${i + 1}` +
      (d.label ? ` - ${d.label}` : '') +
      ` (${Math.round(d.size.width * d.scaleFactor)}×${Math.round(d.size.height * d.scaleFactor)})` +
      (d.id === primary ? ' · principal' : ''),
  }));
}

function fullState() {
  return { update: updater.state, liteAtStart: LITE_AT_START, settings: store.get(), displays: displaysForUi(), status: statusForUi(), hotkeyErrors, platform: process.platform, linkCode };
}

function senderState() {
  const st = conn.status;
  return {
    connected: st.state === 'connected',
    cid: st.cid,
    clients: st.clients || [],
    myScreen: screenOf(targetDisplay()),
    nickname: store.get().nickname,
  };
}

const openSettings = () => openApp('settings');
const openSender = () => openApp('send');
const openFriends = () => openApp('friends');

// Fenêtre principale (Amis / Envoyer / Réglages)
function openApp(tab) {
  if (appWin) {
    if (appWin.isMinimized()) appWin.restore();
    appWin.show();
    appWin.focus();
    if (tab) appWin.webContents.send('app:goto', tab);
    return;
  }
  const mac = process.platform === 'darwin';
  appWin = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    title: 'LiveChat',
    icon: path.join(ASSETS, 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#140f22',
    titleBarStyle: 'hidden',
    ...(mac ? { trafficLightPosition: { x: 18, y: 18 } } : { titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 44 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  appWin.setMenu(null);
  appWin.loadFile(path.join(__dirname, 'app.html'), { query: { tab: tab || 'friends', platform: process.platform } });
  appWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  appWin.webContents.on('will-navigate', (e) => e.preventDefault());
  appWin.on('closed', () => {
    appWin = null;
    registerHotkeys(); // au cas où la fenêtre a été fermée pendant l'enregistrement d'un raccourci
  });
}

ipcMain.handle('settings:get', () => fullState());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:install', () => updater.install());

ipcMain.handle('settings:save', (_e, patch) => {
  const before = store.get();
  const s = store.set(patch);
  if (s.serverUrl !== before.serverUrl || s.accessKey !== before.accessKey || s.nickname !== before.nickname || s.discordId !== before.discordId) {
    applyConnection();
  }
  if (s.displayId !== before.displayId) placeOverlay();
  if (s.hotkeyHide !== before.hotkeyHide || s.hotkeyToggle !== before.hotkeyToggle) registerHotkeys();
  if (s.autoStart !== before.autoStart && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: s.autoStart, openAsHidden: true });
  }
  if (s.enabled !== before.enabled || s.lite !== before.lite || s.allowPlaced !== before.allowPlaced) reportState();
  if (s.lite !== before.lite) {
    if (s.lite && overlay && !overlay.isVisible()) overlay.destroy();
    if (!s.lite && !overlay) createOverlay();
  }
  sendOverlaySettings();
  refreshTray();
  return fullState();
});

ipcMain.handle('settings:test', () => testPop());
ipcMain.handle('settings:open-sender', () => openSender());
ipcMain.handle('settings:relaunch', () => {
  app.relaunch();
  app.quit();
});

// ---------- Fenêtre « Envoyer » (envoi depuis l'appli, placement précis) ----------

ipcMain.handle('send:state', () => senderState());

// Envoie le fichier choisi au serveur ; renvoie { local: '/media/…' }
ipcMain.handle('send:upload', async (_e, { bytes, type }) => {
  const s = store.get();
  const base = mediaBase(s.serverUrl);
  if (!base) return { error: 'Serveur non configuré' };
  if (!/^(image|video|audio)\//.test(type || '')) return { error: 'Format non pris en charge' };
  try {
    const res = await fetch(`${base}/upload?key=${encodeURIComponent(s.accessKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: Buffer.from(bytes),
    });
    if (res.status === 413) return { error: 'Fichier trop gros pour le serveur' };
    if (!res.ok) return { error: `Erreur serveur (${res.status})` };
    return await res.json();
  } catch (e) {
    return { error: 'Envoi impossible : ' + e.message };
  }
});

let sendRef = 0;
ipcMain.handle('send:submit', (_e, payload) => {
  const ref = ++sendRef;
  return new Promise((resolve) => {
    const onReply = (msg) => {
      if (msg.ref !== ref) return;
      conn.off('reply', onReply);
      clearTimeout(t);
      resolve(msg.type === 'sent' ? { ok: true, n: msg.n } : { error: msg.error || 'Erreur' });
    };
    const t = setTimeout(() => {
      conn.off('reply', onReply);
      resolve({ error: 'Pas de réponse du serveur' });
    }, 60000);
    conn.on('reply', onReply);
    if (!conn.send({ ...payload, type: 'send', ref })) {
      conn.off('reply', onReply);
      clearTimeout(t);
      resolve({ error: 'Pas connecté au serveur' });
    }
  });
});
ipcMain.handle('settings:identify', () => identifyDisplays());
// Pendant qu'on enregistre un nouveau raccourci, on coupe les raccourcis globaux
ipcMain.on('settings:hotkeys-pause', () => globalShortcut.unregisterAll());
ipcMain.on('settings:hotkeys-resume', () => registerHotkeys());

// ---------- Tests / identification des écrans ----------

const TEST_SVG =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4d8d"/><stop offset="1" stop-color="#7c4dff"/></linearGradient></defs>
      <rect width="640" height="400" rx="28" fill="url(#g)"/>
      <text x="320" y="190" font-family="Segoe UI, Arial, sans-serif" font-size="64" font-weight="800" fill="#fff" text-anchor="middle">LiveChat</text>
      <text x="320" y="250" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#fff" text-anchor="middle" opacity=".9">Ça marche ! 🎉</text>
    </svg>`
  ).toString('base64');

function testPop() {
  showPop({
    type: 'pop',
    id: 'test-' + Date.now(),
    test: true,
    author: { name: store.get().nickname || 'Test', avatar: null },
    text: 'Ceci est un test : voilà la taille et la position actuelles.',
    media: { kind: 'image', url: TEST_SVG, width: 640, height: 400 },
  });
}

function identifyDisplays() {
  screen.getAllDisplays().forEach((d, i) => {
    const w = new BrowserWindow({
      x: d.bounds.x + Math.round(d.bounds.width / 2) - 150,
      y: d.bounds.y + Math.round(d.bounds.height / 2) - 150,
      width: 300,
      height: 300,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { sandbox: true },
    });
    w.setIgnoreMouseEvents(true);
    w.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<body style="margin:0;display:grid;place-items:center;height:100vh;background:transparent;font-family:Segoe UI,Arial,sans-serif">
             <div style="width:260px;height:260px;border-radius:40px;background:rgba(124,77,255,.92);color:#fff;display:grid;place-items:center;font-size:150px;font-weight:800">${i + 1}</div>
           </body>`
        )
    );
    w.once('ready-to-show', () => w.showInactive());
    setTimeout(() => !w.isDestroyed() && w.close(), 2500);
  });
}

// ---------- Démarrage ----------

app.on('second-instance', () => openFriends());
app.on('window-all-closed', (e) => {
  // On reste dans la barre des tâches même sans fenêtre
  if (!quitting) e.preventDefault?.();
});
app.on('before-quit', () => (quitting = true));
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  if (process.platform === 'win32') app.setAppUserModelId('fr.amis.livechat');

  store = new SettingsStore(app.getPath('userData'));
  createTray();
  if (!store.get().lite) createOverlay(); // en LITE, créée seulement au premier pop
  registerHotkeys();
  applyConnection();
  updater.start();

  screen.on('display-added', () => {
    placeOverlay();
    if (appWin) appWin.webContents.send('settings:state', fullState());
  });
  screen.on('display-removed', () => {
    placeOverlay();
    if (appWin) appWin.webContents.send('settings:state', fullState());
  });
  screen.on('display-metrics-changed', placeOverlay);

  // LIVECHAT_DEMO=1 : affiche un pop de test au lancement (pratique pour vérifier l'installation)
  if (['friends', 'send', 'settings'].includes(process.env.LIVECHAT_DEMO)) openApp(process.env.LIVECHAT_DEMO);
  else if (process.env.LIVECHAT_DEMO) setTimeout(testPop, 1500);

  const s = store.get();
  if (!s.serverUrl || !s.accessKey) {
    openSettings();
  } else if (Notification.isSupported()) {
    new Notification({
      title: 'LiveChat est lancé',
      body: `Il tourne dans la barre des tâches. ${s.hotkeyHide} masque l'affichage, ${s.hotkeyToggle} coupe la réception.`,
      silent: true,
    }).show();
  }
});

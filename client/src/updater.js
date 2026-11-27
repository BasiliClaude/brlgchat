// Mises à jour automatiques : l'appli regarde sur GitHub (Releases) s'il y a
// une nouvelle version, la télécharge en arrière-plan, puis propose de redémarrer.
// Sur Mac, Apple refuse d'installer une mise à jour d'appli non signée :
// on prévient seulement, avec un lien vers la page de téléchargement.
const { app, shell, Notification } = require('electron');
const { EventEmitter } = require('events');

const RELEASES_URL = 'https://github.com/BasiliClaude/brlgchat/releases/latest';
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000; // toutes les 3 h

class Updater extends EventEmitter {
  constructor() {
    super();
    // state : idle | checking | latest | available | downloading | ready | manual | error | dev
    this.state = { state: app.isPackaged ? 'idle' : 'dev', current: app.getVersion(), version: null, percent: 0, error: '' };
    this.au = null;
    this.manualOnly = process.platform === 'darwin';
    this.notified = null;
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  start() {
    if (!app.isPackaged) return; // en développement : rien
    try {
      this.au = require('electron-updater').autoUpdater;
    } catch {
      return;
    }
    const au = this.au;
    au.autoDownload = !this.manualOnly;
    au.autoInstallOnAppQuit = true; // si on quitte sans cliquer, ça s'installe quand même
    au.logger = null;

    au.on('checking-for-update', () => this.set({ state: 'checking', error: '' }));
    au.on('update-not-available', () => this.set({ state: 'latest' }));
    au.on('update-available', (info) => {
      this.set({ state: this.manualOnly ? 'manual' : 'downloading', version: info.version, percent: 0 });
      if (this.manualOnly) this.notify(`LiveChat ${info.version} est disponible. Clique pour le télécharger.`, () => this.openDownload());
    });
    au.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
    au.on('update-downloaded', (info) => {
      this.set({ state: 'ready', version: info.version, percent: 100 });
      this.notify(`Mise à jour ${info.version} prête. Clique pour redémarrer LiveChat.`, () => this.install());
    });
    au.on('error', (e) => this.set({ state: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 160) }));

    setTimeout(() => this.check(), 15000);
    setInterval(() => this.check(), CHECK_EVERY_MS).unref?.();
  }

  check() {
    if (!this.au) return Promise.resolve(this.state);
    if (['checking', 'downloading', 'ready'].includes(this.state.state)) return Promise.resolve(this.state);
    return this.au.checkForUpdates().then(() => this.state, () => this.state);
  }

  install() {
    if (this.state.state === 'ready' && this.au) {
      // isSilent : pas de fenêtre d'installation ; isForceRunAfter : relance l'appli après
      setImmediate(() => this.au.quitAndInstall(true, true));
    } else if (this.state.state === 'manual') this.openDownload();
  }

  openDownload() {
    shell.openExternal(RELEASES_URL);
  }

  notify(body, onClick) {
    if (this.notified === body || !Notification.isSupported()) return;
    this.notified = body;
    const n = new Notification({ title: 'LiveChat', body, silent: true });
    n.on('click', onClick);
    n.show();
  }
}

module.exports = { Updater, RELEASES_URL };

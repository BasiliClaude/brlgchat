// Connexion WebSocket au relais, avec reconnexion automatique
const { EventEmitter } = require('events');
const WebSocket = require('ws');

function buildUrl(serverUrl, accessKey, nickname) {
  let s = String(serverUrl || '').trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = 'wss://' + s;
  s = s.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!['ws:', 'wss:'].includes(url.protocol)) return null;
  url.searchParams.set('key', accessKey || '');
  if (nickname) url.searchParams.set('name', nickname);
  return url.toString();
}

class Connection extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.timer = null;
    this.delay = 2000;
    this.status = { state: 'off', count: 0, names: [], error: '' };
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  connect({ serverUrl, accessKey, nickname }) {
    this.disconnect();
    const url = buildUrl(serverUrl, accessKey, nickname);
    if (!url) {
      this.setStatus({ state: 'off', count: 0, names: [], error: serverUrl ? 'Adresse du serveur invalide' : 'Serveur non configuré' });
      return;
    }
    this.target = { serverUrl, accessKey, nickname };
    this.open(url);
  }

  open(url) {
    this.setStatus({ state: 'connecting', error: '' });
    const ws = new WebSocket(url, { handshakeTimeout: 10000 });
    this.ws = ws;
    let alive = null;
    const resetAlive = () => {
      clearTimeout(alive);
      // le serveur ping toutes les 25 s : sans nouvelles depuis 70 s, on relance
      alive = setTimeout(() => ws.terminate(), 70000);
    };

    ws.on('open', () => {
      this.delay = 2000;
      this.setStatus({ state: 'connected', error: '' });
      resetAlive();
    });
    ws.on('ping', resetAlive);
    ws.on('message', (data) => {
      resetAlive();
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'presence') this.setStatus({ count: msg.count || 0, names: msg.names || [] });
      else if (msg.type === 'pop') this.emit('pop', msg);
    });
    ws.on('unexpected-response', (_req, res) => {
      const err = res.statusCode === 401 ? 'Mot de passe refusé par le serveur' : `Erreur serveur (${res.statusCode})`;
      this.setStatus({ error: err });
      this.authFailed = res.statusCode === 401;
    });
    ws.on('error', (e) => {
      if (!this.status.error) this.setStatus({ error: e.code === 'ENOTFOUND' ? 'Serveur introuvable' : e.message });
    });
    ws.on('close', () => {
      clearTimeout(alive);
      if (this.ws !== ws) return; // déconnexion volontaire
      this.ws = null;
      this.setStatus({ state: 'connecting', count: 0, names: [] });
      // mauvais mot de passe : inutile d'insister souvent
      const wait = this.authFailed ? 60000 : this.delay;
      this.authFailed = false;
      this.delay = Math.min(this.delay * 2, 30000);
      this.timer = setTimeout(() => this.open(url), wait);
    });
  }

  disconnect() {
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.terminate();
      } catch {
        /* rien */
      }
    }
    this.setStatus({ state: 'off', count: 0, names: [] });
  }
}

module.exports = { Connection, buildUrl };

// Relais WebSocket : les applis LiveChat des amis s'y connectent,
// et chaque média posté dans le salon Discord leur est diffusé.
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createRelay({ port, accessKey, log = console.log, media = null, onClientMessage = null }) {
  if (!accessKey) throw new Error('ACCESS_KEY manquant');

  const server = http.createServer((req, res) => {
    // Médias copiés par le serveur : /media/<id>?key=MOT_DE_PASSE
    const m = /^\/media\/([a-f0-9]{24})(\?|$)/.exec(req.url || '');
    if (m && media) {
      let key = '';
      try {
        key = new URL(req.url, 'http://localhost').searchParams.get('key') || '';
      } catch {
        /* rien */
      }
      if (!safeEqual(key, accessKey)) {
        res.writeHead(401);
        return res.end();
      }
      return media.serve(req, res, m[1]);
    }
    // Envoi d'un fichier depuis l'appli : POST /upload?key=MOT_DE_PASSE
    if (req.method === 'POST' && /^\/upload(\?|$)/.test(req.url || '') && media) {
      let key = '';
      try {
        key = new URL(req.url, 'http://localhost').searchParams.get('key') || '';
      } catch {
        /* rien */
      }
      if (!safeEqual(key, accessKey)) {
        res.writeHead(401);
        return res.end();
      }
      const type = String(req.headers['content-type'] || '').split(';')[0];
      if (!/^(image|video|audio)\//.test(type)) {
        res.writeHead(415);
        return res.end();
      }
      media
        .storeStream(req, type)
        .then((id) => {
          res.writeHead(id ? 200 : 413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(id ? { id, local: `/media/${id}`, type } : { error: 'Fichier trop gros' }));
        })
        .catch(() => {
          res.writeHead(500);
          res.end();
        });
      return;
    }
    // Page de santé (utile pour les hébergeurs qui vérifient que le service tourne)
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`LiveChat relais OK - ${countClients()} ami(s) connecte(s)\n`);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    let key = '';
    let name = '';
    let uid = '';
    let code = '';
    try {
      const url = new URL(req.url, 'http://localhost');
      key = url.searchParams.get('key') || '';
      name = (url.searchParams.get('name') || '').slice(0, 32);
      uid = /^\d{5,25}$/.test(url.searchParams.get('uid') || '') ? url.searchParams.get('uid') : '';
      code = /^\d{6}$/.test(url.searchParams.get('code') || '') ? url.searchParams.get('code') : '';
    } catch {
      /* URL invalide */
    }
    if (!safeEqual(key, accessKey)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      log(`[relais] connexion refusée (mauvaise clé) depuis ${req.socket.remoteAddress}`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.clientName = name || 'anonyme';
      ws.discordId = uid || null; // compte Discord lié (via !lier)
      ws.linkCode = code || null; // code affiché dans l'appli pour la liaison
      ws.cid = crypto.randomBytes(6).toString('hex'); // identifiant de l'appli pour cette connexion
      ws.screen = null; // résolution de l'écran d'affichage { w, h }
      wss.emit('connection', ws, req);
    });
  });

  function countClients() {
    let n = 0;
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) n++;
    });
    return n;
  }

  function listClients() {
    const names = [];
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) names.push(c.clientName);
    });
    return names;
  }

  // onlyIds : si fourni, n'envoie qu'aux applis liées à ces comptes Discord
  function broadcast(obj, onlyIds = null) {
    const data = JSON.stringify(obj);
    let sent = 0;
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN && (!onlyIds || (c.discordId && onlyIds.includes(c.discordId)))) {
        c.send(data);
        sent++;
      }
    });
    return sent;
  }

  // Liaison : l'appli qui affiche ce code est rattachée au compte Discord
  function link(code, discordId, discordName) {
    let n = 0;
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN && c.linkCode && c.linkCode === code) {
        c.discordId = discordId;
        c.send(JSON.stringify({ type: 'linked', id: discordId, name: discordName }));
        n++;
      }
    });
    return n;
  }

  function linkedIds() {
    const ids = new Set();
    wss.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.discordId && ids.add(c.discordId));
    return ids;
  }

  function clientsInfo() {
    const list = [];
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) {
        list.push({ cid: c.cid, name: c.clientName, linked: !!c.discordId, screen: c.screen });
      }
    });
    return list;
  }

  // Envoi à des applis précises (par identifiant de connexion)
  function sendTo(cids, obj) {
    const data = JSON.stringify(obj);
    let sent = 0;
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN && cids.includes(c.cid)) {
        c.send(data);
        sent++;
      }
    });
    return sent;
  }

  let presenceTimer = null;
  function broadcastPresence() {
    clearTimeout(presenceTimer);
    presenceTimer = setTimeout(() => {
      broadcast({ type: 'presence', count: countClients(), names: listClients(), clients: clientsInfo() });
    }, 50);
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'screen') {
        const w = Math.round(Number(msg.w));
        const h = Math.round(Number(msg.h));
        if (w > 100 && h > 100 && w < 20000 && h < 20000) {
          ws.screen = { w, h };
          broadcastPresence();
        }
        return;
      }
      if (onClientMessage) {
        Promise.resolve(onClientMessage(ws, msg)).catch((e) => log('[relais] erreur', e));
      }
    });
    ws.on('close', () => {
      log(`[relais] ${ws.clientName} déconnecté`);
      broadcastPresence();
    });
    ws.on('error', () => {});
    log(`[relais] ${ws.clientName} connecté`);
    ws.send(JSON.stringify({ type: 'hello', version: 2, cid: ws.cid }));
    broadcastPresence();
  });

  // Ping régulier pour détecter les connexions mortes et garder le lien ouvert
  // derrière les proxys des hébergeurs.
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 25000);

  function listen() {
    return new Promise((resolve) => {
      server.listen(port, () => {
        log(`[relais] en écoute sur le port ${server.address().port}`);
        resolve(server.address().port);
      });
    });
  }

  function close() {
    clearInterval(heartbeat);
    wss.clients.forEach((c) => c.terminate());
    return new Promise((r) => server.close(() => r()));
  }

  return { listen, close, broadcast, sendTo, countClients, listClients, clientsInfo, link, linkedIds };
}

module.exports = { createRelay };

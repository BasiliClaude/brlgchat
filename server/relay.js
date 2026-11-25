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

function createRelay({ port, accessKey, log = console.log }) {
  if (!accessKey) throw new Error('ACCESS_KEY manquant');

  const server = http.createServer((req, res) => {
    // Page de santé (utile pour les hébergeurs qui vérifient que le service tourne)
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`LiveChat relais OK - ${countClients()} ami(s) connecte(s)\n`);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    let key = '';
    let name = '';
    try {
      const url = new URL(req.url, 'http://localhost');
      key = url.searchParams.get('key') || '';
      name = (url.searchParams.get('name') || '').slice(0, 32);
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

  function broadcast(obj) {
    const data = JSON.stringify(obj);
    let sent = 0;
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) {
        c.send(data);
        sent++;
      }
    });
    return sent;
  }

  function broadcastPresence() {
    broadcast({ type: 'presence', count: countClients(), names: listClients() });
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', () => {
      /* les clients n'envoient rien d'utile pour l'instant */
    });
    ws.on('close', () => {
      log(`[relais] ${ws.clientName} déconnecté`);
      broadcastPresence();
    });
    ws.on('error', () => {});
    log(`[relais] ${ws.clientName} connecté`);
    ws.send(JSON.stringify({ type: 'hello', version: 1 }));
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

  return { listen, close, broadcast, countClients, listClients };
}

module.exports = { createRelay };

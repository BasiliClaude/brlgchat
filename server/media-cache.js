// Copie temporaire des médias sur le serveur.
// Le bot supprime le message Discord (anti-spoil) : le lien Discord peut alors
// ne plus marcher, donc les applis téléchargent le média depuis notre serveur.
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const DIR = path.join(os.tmpdir(), 'livechat-media');
const TTL_MS = 15 * 60 * 1000; // un média reste disponible 15 minutes
const MAX_BYTES = Number(process.env.MEDIA_MAX_MB || 200) * 1024 * 1024;

const entries = new Map(); // id -> { file, type, size, at }

function init() {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  setInterval(cleanup, 60 * 1000).unref();
}

function cleanup() {
  const now = Date.now();
  for (const [id, e] of entries) {
    if (now - e.at > TTL_MS) {
      entries.delete(id);
      fsp.rm(e.file, { force: true }).catch(() => {});
    }
  }
}

// Télécharge l'URL et renvoie l'id local, ou null si impossible / trop gros
async function store(url, { fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const id = crypto.randomBytes(12).toString('hex');
  const file = path.join(DIR, id);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok || !res.body) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return null;
    let size = 0;
    const limited = Readable.fromWeb(res.body);
    limited.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) limited.destroy(new Error('trop gros'));
    });
    await pipeline(limited, fs.createWriteStream(file));
    const type = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0];
    entries.set(id, { file, type, size, at: Date.now() });
    return id;
  } catch {
    fsp.rm(file, { force: true }).catch(() => {});
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Sert /media/<id> (avec prise en charge des "Range" pour les vidéos)
function serve(req, res, id) {
  const e = entries.get(id);
  if (!e) {
    res.writeHead(404);
    return res.end();
  }
  const headers = {
    'Content-Type': e.type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=900',
    'Access-Control-Allow-Origin': '*',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && e.size > 0) {
    let start = range[1] === '' ? e.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : e.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, e.size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${e.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${e.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(e.file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': e.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(e.file).pipe(res);
}

module.exports = { init, store, serve, cleanup };

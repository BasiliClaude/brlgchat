// Envois faits directement depuis l'appli (fenêtre « Envoyer »)
const crypto = require('crypto');
const { resolveLink, GIF_SITES } = require('./extract');

const GIF_SITE_RE = new RegExp('^https?://([a-z0-9-]+\\.)*(' + GIF_SITES.map((h) => h.replace(/\./g, '\\.')).join('|') + ')/', 'i');

function createAppSender({ relay, media, avatarOf = async () => null, log = console.log }) {
  const num = (v, a, b, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d;
  };

  async function handleAppMessage(ws, msg) {
    if (msg.type !== 'send') return;
    const reply = (obj) => ws.readyState === 1 && ws.send(JSON.stringify({ ...obj, ref: msg.ref }));
    const now = Date.now();
    if (ws.lastSend && now - ws.lastSend < 1500)
      return reply({ type: 'send-error', error: 'Doucement ! Attends une seconde entre deux envois.' });
    ws.lastSend = now;

    const all = relay.clientsInfo().map((c) => c.cid);
    const to = msg.to === 'all' ? all : (Array.isArray(msg.to) ? msg.to : []).filter((c) => typeof c === 'string' && all.includes(c));
    if (!to.length) return reply({ type: 'send-error', error: 'Choisis au moins un destinataire connecté.' });

    // Média : fichier déjà envoyé (/media/<id>) ou lien à télécharger
    let m = null;
    if (typeof msg.local === 'string' && /^\/media\/[a-f0-9]{24}$/.test(msg.local)) {
      const inf = media.info(msg.local.slice(7));
      if (!inf) return reply({ type: 'send-error', error: 'Le fichier a expiré, renvoie-le.' });
      m = { local: msg.local, type: inf.type };
    } else if (typeof msg.link === 'string' && /^https:\/\//i.test(msg.link.trim())) {
      let url = msg.link.trim();
      let gifSite = false;
      if (GIF_SITE_RE.test(url)) {
        const r = await resolveLink(url);
        if (r) {
          url = r.url;
          gifSite = true;
        }
      }
      const id = await media.store(url);
      const inf = id && media.info(id);
      if (!inf || !/^(image|video|audio)\//.test(inf.type))
        return reply({ type: 'send-error', error: 'Impossible de lire ce lien (il faut une image, un gif ou une vidéo).' });
      m = { local: `/media/${id}`, type: inf.type, gif: gifSite };
    }
    const text = String(msg.text || '')
      .trim()
      .slice(0, 300);
    if (!m && !text) return reply({ type: 'send-error', error: 'Ajoute un média ou un texte.' });

    let layout = null;
    if (msg.layout && typeof msg.layout === 'object') {
      layout = {
        x: num(msg.layout.x, -1, 2, 0),
        y: num(msg.layout.y, -1, 2, 0),
        w: num(msg.layout.w, 0.002, 3, 0.2),
        h: num(msg.layout.h, 0.002, 3, 0.2),
      };
    }

    const anonymous = !!msg.anonymous;
    const pop = {
      type: 'pop',
      id: 'app-' + crypto.randomBytes(6).toString('hex'),
      at: now,
      fromApp: true,
      anonymous,
      author: anonymous ? { name: '', avatar: null } : { name: ws.clientName, avatar: await avatarOf(ws.discordId) },
      text,
      media: m
        ? {
            kind: m.type.split('/')[0],
            local: m.local,
            gif: m.gif || m.type === 'image/gif',
          }
        : null,
      layout,
      bare: !!msg.bare,
      durationSec: num(msg.durationSec, 1, 120, 5),
      playFull: msg.playFull !== false,
    };
    const n = relay.sendTo(to, pop);
    log(`[appli] ${ws.clientName}${anonymous ? ' (anonyme)' : ''} -> ${n} ami(s)${layout ? ' (placé)' : ''}`);
    reply({ type: 'sent', n });
  }

  return handleAppMessage;
}

module.exports = { createAppSender };

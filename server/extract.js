// Transforme un message Discord en "pop" à afficher chez les amis.
// Les applis n'acceptent que des URLs hébergées par Discord ou par les grands
// sites de GIF (liste MEDIA_HOSTS), pour ne pas envoyer l'IP des amis n'importe où.

const DISCORD_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];
// Sites de GIF dont on accepte les fichiers (le domaine et ses sous-domaines)
const GIF_SITES = ['tenor.com', 'giphy.com', 'klipy.com', 'klipy.co', 'imgur.com', 'gifdb.com'];

function hostOk(hostname, list) {
  return list.some((h) => hostname === h || hostname.endsWith('.' + h));
}

function isDiscordUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && DISCORD_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

function isAllowedMediaUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && (DISCORD_HOSTS.includes(url.hostname) || hostOk(url.hostname, GIF_SITES));
  } catch {
    return false;
  }
}

function kindFromAttachment(att) {
  const ct = (att.contentType || '').toLowerCase();
  const name = (att.name || '').toLowerCase();
  if (ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp)$/.test(name)) return 'image';
  if (ct.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/.test(name)) return 'video';
  if (ct.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|flac)$/.test(name)) return 'audio';
  return null;
}

function kindFromUrl(u) {
  const path = (() => {
    try {
      return new URL(u).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (/\.(mp4|webm|mov|m4v)$/.test(path)) return 'video';
  return 'image';
}

const pick = (o, a, b) => (o ? o[a] || o[b] : null);

function mediaFromEmbeds(embeds) {
  for (const e of embeds || []) {
    const data = e.data || e;
    const gifLike = data.type === 'gifv' || isGifSite(data.url) || (data.provider && /tenor|giphy|klipy|imgur/i.test(data.provider.name || ''));
    // 1) vidéo (les "gifs" Tenor/Klipy/Giphy sont des mp4 muets en boucle)
    const vurl = pick(data.video, 'proxy_url', 'proxyURL');
    if (vurl && isDiscordUrl(vurl) && (data.type === 'gifv' || gifLike || data.type === 'video')) {
      return { kind: 'video', url: vurl, width: data.video.width, height: data.video.height, gif: data.type === 'gifv' || gifLike };
    }
    // 2) image (aperçu d'un lien vers une image ou un gif)
    const img = data.image || data.thumbnail;
    const iurl = pick(img, 'proxy_url', 'proxyURL');
    if (iurl && isDiscordUrl(iurl) && (data.type === 'image' || gifLike)) {
      return { kind: 'image', url: iurl, width: img.width, height: img.height, gif: gifLike || /\.gif(\?|$)/i.test(data.url || iurl) };
    }
  }
  return null;
}

function isGifSite(u) {
  try {
    return hostOk(new URL(u).hostname, GIF_SITES);
  } catch {
    return false;
  }
}

function mediaFromMessage(message) {
  // 1) Pièces jointes (images, gifs, vidéos uploadés directement)
  const attachments = message.attachments ? [...message.attachments.values()] : [];
  for (const att of attachments) {
    const kind = kindFromAttachment(att);
    if (kind && isDiscordUrl(att.url)) {
      const gif = /gif/i.test(att.contentType || '') || /\.gif$/i.test(att.name || '');
      return { kind, url: att.url, width: att.width || null, height: att.height || null, gif };
    }
  }

  // 2) Stickers (images uniquement, pas les stickers Lottie)
  const stickers = message.stickers ? [...message.stickers.values()] : [];
  for (const st of stickers) {
    // format 1 = PNG, 2 = APNG, 4 = GIF ; 3 = Lottie (non supporté)
    if (st.format !== 3 && st.url && isDiscordUrl(st.url)) {
      return { kind: 'image', url: st.url, width: 320, height: 320, gif: st.format === 2 || st.format === 4 };
    }
  }

  // 3) Embeds (liens Tenor / Giphy / Klipy / images collées en lien)
  return mediaFromEmbeds(message.embeds);
}

// Retire du texte les liens qui ont servi de média (lien Tenor, etc.)
function cleanText(text, stripLinks) {
  let t = (text || '').trim();
  if (stripLinks) t = t.replace(/<?https?:\/\/\S+>?/g, '').replace(/\s{2,}/g, ' ').trim();
  if (t.length > 300) t = t.slice(0, 297) + '…';
  return t;
}

function authorOf(message) {
  const member = message.member;
  const author = message.author || {};
  const name = (member && member.displayName) || author.globalName || author.username || 'Quelqu’un';
  let avatar = null;
  try {
    avatar = (member && member.displayAvatarURL ? member : author).displayAvatarURL({ size: 128, extension: 'png' });
  } catch {
    avatar = null;
  }
  if (avatar && !isDiscordUrl(avatar)) avatar = null;
  return { name, avatar };
}

// linkMedia : média trouvé en lisant la page d'un lien (voir resolveLink)
function popFromMessage(message, { allowTextOnly = true, linkMedia = null } = {}) {
  let media = mediaFromMessage(message) || linkMedia;
  const fromLink = !!media && !(message.attachments && message.attachments.size) && !(message.stickers && message.stickers.size);
  const text = cleanText(message.cleanContent ?? message.content, fromLink);
  if (!media && (!allowTextOnly || !text)) return null;

  return {
    type: 'pop',
    id: message.id,
    at: Date.now(),
    author: authorOf(message),
    text,
    media,
  };
}

function firstLink(text) {
  const m = /https?:\/\/[^\s<>]+/.exec(text || '');
  return m ? m[0] : null;
}

function hasLink(text) {
  return !!firstLink(text);
}

// ---------- Lecture d'une page de GIF (quand Discord ne fournit pas d'aperçu) ----------

function metaContent(html, names) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name.replace(/[:.]/g, '\\$&')}["'][^>]*>`,
      'i'
    );
    const tag = re.exec(html);
    if (tag) {
      const c = /content=["']([^"']+)["']/i.exec(tag[0]);
      if (c) return c[1].replace(/&amp;/g, '&');
    }
  }
  return null;
}

async function resolveLink(link, { fetchImpl = globalThis.fetch, timeoutMs = 6000 } = {}) {
  if (!link || !isGifSite(link)) return null;
  // Lien direct vers le fichier
  if (/\.(gif|webp|png|jpe?g|mp4|webm)(\?|$)/i.test(new URL(link).pathname + new URL(link).search)) {
    return isAllowedMediaUrl(link) ? { kind: kindFromUrl(link), url: link, gif: true } : null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(link, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 600000);
    const candidates = [
      metaContent(html, ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream']),
      metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']),
    ];
    for (const c of candidates) {
      if (!c) continue;
      const abs = new URL(c, link).toString();
      if (isAllowedMediaUrl(abs)) {
        const kind = kindFromUrl(abs);
        return { kind, url: abs, gif: true };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { popFromMessage, mediaFromMessage, isDiscordUrl, isAllowedMediaUrl, hasLink, firstLink, resolveLink, GIF_SITES };

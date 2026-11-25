// Transforme un message Discord en "pop" à afficher chez les amis.
// On ne garde que des URLs hébergées par Discord (cdn / media proxy) :
// les applis refusent tout autre domaine, ce qui évite d'envoyer l'IP
// des amis à des sites tiers.

const DISCORD_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

function isDiscordUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && DISCORD_HOSTS.includes(url.hostname);
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

function mediaFromMessage(message) {
  // 1) Pièces jointes (images, gifs, vidéos uploadés directement)
  const attachments = message.attachments ? [...message.attachments.values()] : [];
  for (const att of attachments) {
    const kind = kindFromAttachment(att);
    if (kind && isDiscordUrl(att.url)) {
      return { kind, url: att.url, width: att.width || null, height: att.height || null };
    }
  }

  // 2) Stickers (images uniquement, pas les stickers Lottie)
  const stickers = message.stickers ? [...message.stickers.values()] : [];
  for (const st of stickers) {
    // format 1 = PNG, 2 = APNG, 4 = GIF ; 3 = Lottie (non supporté)
    if (st.format !== 3 && st.url && isDiscordUrl(st.url)) {
      return { kind: 'image', url: st.url, width: 320, height: 320 };
    }
  }

  // 3) Embeds (liens Tenor / Giphy / images collées en lien)
  for (const e of message.embeds || []) {
    const data = e.data || e;
    if (data.type === 'gifv' && data.video) {
      const url = data.video.proxy_url || data.video.proxyURL;
      if (url && isDiscordUrl(url)) {
        return { kind: 'video', url, width: data.video.width, height: data.video.height, gif: true };
      }
    }
    if (data.type === 'video' && data.video) {
      const url = data.video.proxy_url || data.video.proxyURL;
      if (url && isDiscordUrl(url)) {
        return { kind: 'video', url, width: data.video.width, height: data.video.height };
      }
    }
    const img = data.image || (data.type === 'image' ? data.thumbnail : null);
    if (img) {
      const url = img.proxy_url || img.proxyURL;
      if (url && isDiscordUrl(url)) {
        return { kind: 'image', url, width: img.width, height: img.height };
      }
    }
  }
  return null;
}

// Retire du texte les liens qui ont servi de média (lien Tenor, etc.)
function cleanText(text, hadEmbedMedia) {
  let t = (text || '').trim();
  if (hadEmbedMedia) t = t.replace(/https?:\/\/\S+/g, '').trim();
  if (t.length > 300) t = t.slice(0, 297) + '…';
  return t;
}

function popFromMessage(message, { allowTextOnly = true } = {}) {
  const media = mediaFromMessage(message);
  const fromEmbed = !!media && !(message.attachments && message.attachments.size);
  const text = cleanText(message.cleanContent ?? message.content, fromEmbed);
  if (!media && (!allowTextOnly || !text)) return null;

  const member = message.member;
  const author = message.author || {};
  const name = (member && member.displayName) || author.globalName || author.username || 'Quelqu’un';
  let avatar = null;
  try {
    avatar = (member && member.displayAvatarURL ? member : author).displayAvatarURL({ size: 64, extension: 'png' });
  } catch {
    avatar = null;
  }
  if (avatar && !isDiscordUrl(avatar)) avatar = null;

  return {
    type: 'pop',
    id: message.id,
    at: Date.now(),
    author: { name, avatar },
    text,
    media,
  };
}

function hasLink(text) {
  return /https?:\/\/\S+/.test(text || '');
}

module.exports = { popFromMessage, mediaFromMessage, isDiscordUrl, hasLink };

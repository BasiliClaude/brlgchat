require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events, cleanContent } = require('discord.js');
const { createRelay } = require('./relay');
const media = require('./media-cache');
const { popFromMessage, firstLink, resolveLink, GIF_SITES } = require('./extract');
const GIF_SITE_RE = new RegExp('^https?://([a-z0-9-]+\\.)*(' + GIF_SITES.map((h) => h.replace(/\./g, '\\.')).join('|') + ')/', 'i');

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_IDS = (process.env.CHANNEL_IDS || process.env.CHANNEL_ID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ACCESS_KEY = process.env.ACCESS_KEY;
const PORT = Number(process.env.PORT || 8080);
const ALLOW_TEXT_ONLY = (process.env.ALLOW_TEXT_ONLY || 'true').toLowerCase() !== 'false';
const ACK_EMOJI = process.env.ACK_EMOJI ?? '📺';
// Supprime le message du salon une fois envoyé aux amis (anti-spoil)
const DELETE_MESSAGES = (process.env.DELETE_MESSAGES || 'true').toLowerCase() !== 'false';

function fail(msg) {
  console.error(`\n[config] ${msg}\nVoir server/.env.example\n`);
  process.exit(1);
}
if (!TOKEN) fail('DISCORD_TOKEN manquant');
if (!CHANNEL_IDS.length) fail('CHANNEL_IDS manquant');
if (!ACCESS_KEY || ACCESS_KEY.length < 8) fail('ACCESS_KEY manquant ou trop court (8 caractères minimum)');

media.init();
const relay = createRelay({ port: PORT, accessKey: ACCESS_KEY, media });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message],
});

const sentIds = new Set();
function remember(id) {
  sentIds.add(id);
  if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value);
}

async function handle(message) {
  if (!CHANNEL_IDS.includes(message.channelId)) return;
  if (message.author?.bot) return;
  if (sentIds.has(message.id)) return;

  // Commande d'aide : "!lc" -> qui est connecté
  if (message.content?.trim().toLowerCase() === '!lc') {
    const names = relay.listClients();
    await message
      .reply(names.length ? `📺 ${names.length} connecté(s) : ${names.join(', ')}` : '📺 Personne n’est connecté pour l’instant.')
      .catch(() => {});
    return;
  }

  // Liaison de l'appli : "!lier 123456" (code affiché dans les paramètres de l'appli)
  const linkCmd = /^!(?:lier|link)\s+(\d{6})\s*$/i.exec(message.content || '');
  if (linkCmd) {
    const name = message.member?.displayName || message.author.globalName || message.author.username;
    const n = relay.link(linkCmd[1], message.author.id, name);
    const reply = await message
      .reply(n ? `✅ Appli liée à ton compte, ${name}. Tu recevras les messages où on te @mentionne.` : '❌ Code inconnu. Vérifie que ton appli est ouverte et connectée, puis recopie le code affiché dans les paramètres.')
      .catch(() => null);
    setTimeout(() => {
      message.delete().catch(() => {});
      reply?.delete().catch(() => {});
    }, 8000);
    return;
  }

  // @mentions de personnes : le message ne part qu'à elles
  const targets = [...new Set([...(message.content || '').matchAll(/<@!?(\d+)>/g)].map((m) => m[1]))].filter(
    (id) => id !== client.user.id
  );

  let pop = popFromMessage(message, { allowTextOnly: ALLOW_TEXT_ONLY });

  // Un lien (Tenor, Klipy, Giphy…) : Discord ajoute l'aperçu (embed) un peu après.
  // On regarde à nouveau le message, puis on lit la page du lien si besoin.
  const link = firstLink(message.content);
  if ((!pop || !pop.media) && link && !(message.attachments?.size)) {
    for (const wait of [1500, 2000]) {
      await new Promise((r) => setTimeout(r, wait));
      let fresh;
      try {
        fresh = await message.channel.messages.fetch({ message: message.id, force: true });
      } catch {
        return; // message supprimé entre-temps
      }
      const p = popFromMessage(fresh, { allowTextOnly: ALLOW_TEXT_ONLY });
      if (p && p.media) {
        pop = p;
        break;
      }
    }
    if (!pop || !pop.media) {
      const linkMedia = await resolveLink(link);
      if (linkMedia) pop = popFromMessage(message, { allowTextOnly: ALLOW_TEXT_ONLY, linkMedia });
      else if (pop && GIF_SITE_RE.test(link)) pop = null; // lien de gif illisible : on n'affiche pas juste l'URL
    }
  }
  if (!pop) return;

  remember(message.id);

  // Copie du média sur le serveur : les applis le téléchargent ici,
  // ce qui permet de supprimer le message Discord sans casser l'affichage.
  let cached = false;
  if (pop.media) {
    const id = await media.store(pop.media.url);
    if (id) {
      pop.media.local = `/media/${id}`;
      cached = true;
    }
  }

  if (targets.length) {
    // On retire les @mentions du texte affiché
    pop.text = cleanContent((message.content || '').replace(/<@!?\d+>/g, ''), message.channel)
      .replace(pop.media && !message.attachments?.size ? /<?https?:\/\/\S+>?/g : /$^/, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 300);
    pop.private = true;
    if (!pop.media && !pop.text) return; // juste "@quelqu'un" sans rien d'autre
  }

  const n = relay.broadcast(pop, targets.length ? targets : null);
  console.log(
    `[bot] ${pop.author.name}: ${pop.media ? pop.media.kind + (cached ? ' (copié)' : '') : 'texte'} -> ${n} ami(s)` +
      (targets.length ? ` (privé : ${targets.length} mention(s))` : '')
  );

  // Personne de mentionné n'a reçu : on prévient l'envoyeur (message qui s'efface)
  if (targets.length && n === 0) {
    const linked = relay.linkedIds();
    const missing = targets.filter((id) => !linked.has(id)).map((id) => `<@${id}>`);
    message.channel
      .send({
        content: `⚠️ ${message.author}, personne n'a reçu ton message : ${missing.join(', ')} n'a pas l'appli ouverte ou pas liée (\`!lier CODE\`).`,
        allowedMentions: { users: [message.author.id] },
      })
      .then((w) => setTimeout(() => w.delete().catch(() => {}), 10000))
      .catch(() => {});
  }

  if (DELETE_MESSAGES) {
    // Si la copie a échoué, on laisse le temps aux applis de charger le lien Discord
    const delay = !pop.media || cached ? 800 : 20000;
    setTimeout(() => {
      message.delete().catch((e) => {
        if (e.code === 50013) console.error('[bot] Impossible de supprimer : donne la permission "Gérer les messages" au bot.');
      });
    }, delay);
  } else if (ACK_EMOJI && n > 0) {
    message.react(ACK_EMOJI).catch(() => {});
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`[bot] connecté en tant que ${c.user.tag}, salon(s) écouté(s) : ${CHANNEL_IDS.join(', ')}`);
});
client.on(Events.MessageCreate, (m) => handle(m).catch((e) => console.error('[bot]', e)));
client.on('error', (e) => console.error('[bot]', e));

(async () => {
  await relay.listen();
  await client.login(TOKEN);
})().catch((e) => {
  console.error(e);
  if (String(e).includes('disallowed intents')) {
    console.error('\nActive "MESSAGE CONTENT INTENT" dans le Developer Portal > Bot > Privileged Gateway Intents.\n');
  }
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await relay.close();
    client.destroy();
    process.exit(0);
  });
}

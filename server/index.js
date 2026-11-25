require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { createRelay } = require('./relay');
const { popFromMessage, hasLink } = require('./extract');

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_IDS = (process.env.CHANNEL_IDS || process.env.CHANNEL_ID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ACCESS_KEY = process.env.ACCESS_KEY;
const PORT = Number(process.env.PORT || 8080);
const ALLOW_TEXT_ONLY = (process.env.ALLOW_TEXT_ONLY || 'true').toLowerCase() !== 'false';
const ACK_EMOJI = process.env.ACK_EMOJI ?? '📺';

function fail(msg) {
  console.error(`\n[config] ${msg}\nVoir server/.env.example\n`);
  process.exit(1);
}
if (!TOKEN) fail('DISCORD_TOKEN manquant');
if (!CHANNEL_IDS.length) fail('CHANNEL_IDS manquant');
if (!ACCESS_KEY || ACCESS_KEY.length < 8) fail('ACCESS_KEY manquant ou trop court (8 caractères minimum)');

const relay = createRelay({ port: PORT, accessKey: ACCESS_KEY });

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

  let pop = popFromMessage(message, { allowTextOnly: ALLOW_TEXT_ONLY });

  // Un lien Tenor/Giphy : Discord ajoute l'aperçu (embed) une seconde après.
  if ((!pop || !pop.media) && hasLink(message.content) && !(message.attachments?.size)) {
    await new Promise((r) => setTimeout(r, 1800));
    try {
      const fresh = await message.channel.messages.fetch({ message: message.id, force: true });
      pop = popFromMessage(fresh, { allowTextOnly: ALLOW_TEXT_ONLY }) || pop;
    } catch {
      /* message supprimé entre-temps */
      return;
    }
  }
  if (!pop) return;

  remember(message.id);
  const n = relay.broadcast(pop);
  console.log(`[bot] ${pop.author.name}: ${pop.media ? pop.media.kind : 'texte'} -> ${n} ami(s)`);
  if (ACK_EMOJI && n > 0) message.react(ACK_EMOJI).catch(() => {});
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

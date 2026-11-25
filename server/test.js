// Test local : node test.js
const assert = require('assert');
const WebSocket = require('ws');
const { createRelay } = require('./relay');
const http = require('http');
const media = require('./media-cache');
const { popFromMessage, resolveLink } = require('./extract');

(async () => {
  // extraction
  const att = new Map([['1', { url: 'https://cdn.discordapp.com/attachments/1/2/chat.gif?ex=1', contentType: 'image/gif', name: 'chat.gif', width: 200, height: 100 }]]);
  let p = popFromMessage({ id: '1', attachments: att, embeds: [], cleanContent: 'regardez ça', author: { username: 'bob', displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png' } });
  assert.equal(p.media.kind, 'image'); assert.equal(p.text, 'regardez ça'); assert.equal(p.author.name, 'bob');
  p = popFromMessage({ id: '2', attachments: new Map(), embeds: [{ data: { type: 'gifv', video: { proxy_url: 'https://media.discordapp.net/x.mp4', width: 1, height: 1 } } }], cleanContent: 'mdr https://tenor.com/view/x', author: { username: 'al', displayAvatarURL: () => 'https://evil.com/a.png' } });
  assert.equal(p.media.kind, 'video'); assert.equal(p.media.gif, true); assert.equal(p.text, 'mdr'); assert.equal(p.author.avatar, null);
  p = popFromMessage({ id: '3', attachments: new Map([['1', { url: 'https://evil.com/a.png', contentType: 'image/png' }]]), embeds: [], cleanContent: '', author: { username: 'x' } });
  assert.equal(p, null);
  p = popFromMessage({ id: '4', attachments: new Map(), embeds: [], cleanContent: 'juste du texte', author: { username: 'x' } });
  assert.equal(p.media, null);
  assert.equal(popFromMessage({ id: '4', attachments: new Map(), embeds: [], cleanContent: 'txt', author: {} }, { allowTextOnly: false }), null);
  // embed Klipy de type "link" avec une vidéo
  p = popFromMessage({ id: '5', attachments: new Map(), embeds: [{ data: { type: 'link', url: 'https://klipy.com/gifs/hop', provider: { name: 'KLIPY' }, video: { proxy_url: 'https://media.discordapp.net/k.mp4' }, thumbnail: { proxy_url: 'https://media.discordapp.net/k.png' } } }], cleanContent: 'https://klipy.com/gifs/hop', author: { username: 'm' } });
  assert.equal(p.media.kind, 'video'); assert.equal(p.media.gif, true); assert.equal(p.text, '');
  // un article de presse ne doit pas faire pop son image
  p = popFromMessage({ id: '6', attachments: new Map(), embeds: [{ data: { type: 'article', url: 'https://lemonde.fr/x', thumbnail: { proxy_url: 'https://media.discordapp.net/a.png' } } }], cleanContent: 'lisez https://lemonde.fr/x', author: { username: 'm' } });
  assert.equal(p.media, null);
  // lecture de la page quand Discord ne donne pas d'aperçu
  const fakeFetch = async () => ({ ok: true, text: async () => '<html><meta property="og:image" content="https://static.klipy.com/a/b.gif"><meta property="og:video" content="https://static.klipy.com/a/b.mp4"></html>' });
  let m = await resolveLink('https://klipy.com/gifs/hop-on-overwatch-reaper', { fetchImpl: fakeFetch });
  assert.deepEqual(m, { kind: 'video', url: 'https://static.klipy.com/a/b.mp4', gif: true });
  const evilFetch = async () => ({ ok: true, text: async () => '<meta property="og:image" content="https://evil.com/x.gif">' });
  assert.equal(await resolveLink('https://klipy.com/gifs/x', { fetchImpl: evilFetch }), null);
  assert.equal(await resolveLink('https://evil.com/gifs/x', { fetchImpl: fakeFetch }), null);
  m = await resolveLink('https://media.tenor.com/abc/x.gif');
  assert.equal(m.kind, 'image');
  p = popFromMessage({ id: '7', attachments: new Map(), embeds: [], cleanContent: 'mdr https://klipy.com/gifs/hop', author: { username: 'm' } }, { linkMedia: m });
  assert.equal(p.text, 'mdr'); assert.equal(p.media.url, 'https://media.tenor.com/abc/x.gif');
  console.log('extraction OK');

  // relais
  // copie des médias
  media.init();
  const payload = Buffer.alloc(5000, 7);
  const src = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'video/mp4' }); r.end(payload); });
  await new Promise((r) => src.listen(0, r));
  const mid = await media.store(`http://localhost:${src.address().port}/v.mp4`);
  assert.ok(mid);
  src.close();

  const relay = createRelay({ port: 0, accessKey: 'secret-123', log: () => {}, media });
  const port = await relay.listen();
  const bad = await new Promise((r) => { const w = new WebSocket(`ws://localhost:${port}/?key=nope`); w.on('unexpected-response', (_q, res) => r(res.statusCode)); w.on('error', () => {}); });
  assert.equal(bad, 401);
  const msgs = [];
  const ws = new WebSocket(`ws://localhost:${port}/?key=secret-123&name=Basile`);
  ws.on('message', (d) => msgs.push(JSON.parse(d)));
  await new Promise((r) => ws.on('open', r));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(relay.countClients(), 1);
  assert.deepEqual(relay.listClients(), ['Basile']);
  relay.broadcast({ type: 'pop', text: 'hey' });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(msgs.map((m) => m.type), ['hello', 'presence', 'pop']);
  let r = await fetch(`http://localhost:${port}/media/${mid}?key=secret-123`);
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'video/mp4'); assert.equal((await r.arrayBuffer()).byteLength, 5000);
  r = await fetch(`http://localhost:${port}/media/${mid}?key=secret-123`, { headers: { Range: 'bytes=100-199' } });
  assert.equal(r.status, 206); assert.equal((await r.arrayBuffer()).byteLength, 100);
  r = await fetch(`http://localhost:${port}/media/${mid}?key=faux`);
  assert.equal(r.status, 401);
  console.log('médias OK');
  // envoi ciblé + liaison
  const msgs2 = [];
  const ws2 = new WebSocket(`ws://localhost:${port}/?key=secret-123&name=Tom&code=123456`);
  ws2.on('message', (d) => msgs2.push(JSON.parse(d)));
  await new Promise((r) => ws2.on('open', r));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(relay.broadcast({ type: 'pop', text: 'privé' }, ['999999']), 0);
  assert.equal(relay.link('000000', '999999', 'Tom'), 0);
  assert.equal(relay.link('123456', '999999', 'Tom'), 1);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(msgs2.some((m) => m.type === 'linked' && m.id === '999999'));
  const before = msgs.length;
  assert.equal(relay.broadcast({ type: 'pop', text: 'privé' }, ['999999']), 1);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(msgs.length, before); // Basile ne l'a pas reçu
  assert.equal(msgs2.filter((m) => m.type === 'pop').length, 1);
  ws2.close();
  // reconnexion avec uid déjà lié
  const ws3 = new WebSocket(`ws://localhost:${port}/?key=secret-123&name=Tom&uid=999999`);
  await new Promise((r) => ws3.on('open', r));
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(relay.linkedIds().has('999999'));
  ws3.close();
  console.log('mentions OK');
  ws.close(); await relay.close();
  console.log('relais OK');
})().catch((e) => { console.error(e); process.exit(1); });

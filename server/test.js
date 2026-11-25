// Test local : node test.js
const assert = require('assert');
const WebSocket = require('ws');
const { createRelay } = require('./relay');
const { popFromMessage } = require('./extract');

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
  console.log('extraction OK');

  // relais
  const relay = createRelay({ port: 0, accessKey: 'secret-123', log: () => {} });
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
  ws.close(); await relay.close();
  console.log('relais OK');
})().catch((e) => { console.error(e); process.exit(1); });

// Génère les icônes PNG de l'appli sans dépendance (node tools/make-icons.js)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, shade) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = shade(x / size, y / size, 1 / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Bulle de discussion avec un triangle "play" dedans
function makeShade(colorA, colorB) {
  return (u, v, px) => {
    const aa = (d) => Math.max(0, Math.min(1, 0.5 - d / (px * 1.2)));
    // carré arrondi
    const rr = 0.22, m = 0.04;
    const qx = Math.max(Math.abs(u - 0.5) - (0.5 - m - rr), 0);
    const qy = Math.max(Math.abs(v - 0.5) - (0.5 - m - rr), 0);
    const dBox = Math.hypot(qx, qy) - rr;
    const aBox = aa(dBox);
    if (aBox <= 0) return [0, 0, 0, 0];
    const t = (u + v) / 2;
    let r = colorA[0] + (colorB[0] - colorA[0]) * t;
    let g = colorA[1] + (colorB[1] - colorA[1]) * t;
    let b = colorA[2] + (colorB[2] - colorA[2]) * t;
    // bulle blanche (ellipse + queue)
    const ex = (u - 0.5) / 0.32, ey = (v - 0.47) / 0.26;
    const dEl = (Math.hypot(ex, ey) - 1) * 0.27;
    const inTail = v > 0.62 && v < 0.82 && u > 0.3 && u < 0.46 && (u - 0.3) < (0.82 - v) * 0.9;
    let w = Math.max(aa(dEl), inTail ? 1 : 0);
    // triangle play (coloré) dans la bulle
    const tx = u - 0.45, ty = v - 0.47;
    const inTri = tx > -0.06 && tx < 0.13 && Math.abs(ty) < (0.13 - tx) * 0.62;
    if (inTri) w = 0;
    r = r * (1 - w) + 255 * w; g = g * (1 - w) + 255 * w; b = b * (1 - w) + 255 * w;
    return [Math.round(r), Math.round(g), Math.round(b), Math.round(255 * aBox)];
  };
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const on = makeShade([255, 77, 141], [124, 77, 255]);
const off = makeShade([120, 120, 130], [70, 70, 80]);
fs.writeFileSync(path.join(out, 'icon.png'), png(512, on));
fs.writeFileSync(path.join(out, 'tray-on.png'), png(32, on));
fs.writeFileSync(path.join(out, 'tray-on@2x.png'), png(64, on));
fs.writeFileSync(path.join(out, 'tray-off.png'), png(32, off));
fs.writeFileSync(path.join(out, 'tray-off@2x.png'), png(64, off));
console.log('icônes générées dans', out);

// 아이콘 PNG 생성: 파란 배경에 흰 침대 모양. node scripts/make-icons.js
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');

const BG = [0x31, 0x82, 0xf6], FG = [255, 255, 255];

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
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function inRoundedRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
  const cx = Math.max(rx + r, Math.min(x, rx + rw - r)), cy = Math.max(ry + r, Math.min(y, ry + rh - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const u = size / 16;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const bed = inRoundedRect(x, y, 3 * u, 8 * u, 10 * u, 3.2 * u, 0.6 * u)     // 매트리스
        || inRoundedRect(x, y, 3 * u, 5.2 * u, 3.6 * u, 2.8 * u, 0.6 * u)       // 베개
        || inRoundedRect(x, y, 3 * u, 11.2 * u, 1.2 * u, 1.6 * u, 0.3 * u)     // 다리
        || inRoundedRect(x, y, 11.8 * u, 11.2 * u, 1.2 * u, 1.6 * u, 0.3 * u);
      const c = bed ? FG : BG;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const s of [192, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), png(s));
console.log('icons written');

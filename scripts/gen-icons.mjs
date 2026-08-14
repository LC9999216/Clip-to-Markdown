/**
 * 生成占位图标（蓝底白圆）。仅用于开发期占位，正式图标后续替换。
 * 零依赖：手写最小 PNG 编码器（RGB、filter none、zlib deflate）。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function png(size, [r, g, b]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const raw = Buffer.alloc(size * (1 + size * 3));
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const rad = size * 0.34;
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const off = row + 1 + x * 3;
      const inCircle = (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
      raw[off] = inCircle ? 255 : r;
      raw[off + 1] = inCircle ? 255 : g;
      raw[off + 2] = inCircle ? 255 : b;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const iconsDir = join(root, 'src/icons');
mkdirSync(iconsDir, { recursive: true });
const brand = [30, 100, 220];
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(iconsDir, `icon-${size}.png`), png(size, brand));
}
console.log('图标已生成到 src/icons/');

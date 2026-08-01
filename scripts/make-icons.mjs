/**
 * Genera los íconos PNG de la PWA sin depender de librerías nativas.
 * Se dibuja a mano en un buffer RGBA y se codifica el PNG con zlib.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [13, 15, 20];
const GOLD = [217, 164, 65];
const CYAN = [94, 200, 217];

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 10..12 = compresión / filtro / entrelazado, todos 0

  // Cada scanline lleva adelante un byte de filtro (0 = sin filtro).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const dst = y * (width * 4 + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Cobertura antialiaseada: 1 dentro del trazo, 0 fuera, suave en el borde. */
function stroke(distance, halfWidth, feather = 1.2) {
  const d = Math.abs(distance) - halfWidth;
  if (d <= -feather) return 1;
  if (d >= feather) return 0;
  return (feather - d) / (2 * feather);
}

function blend(px, i, color, alpha) {
  if (alpha <= 0) return;
  for (let c = 0; c < 3; c++) px[i + c] = Math.round(px[i + c] * (1 - alpha) + color[c] * alpha);
}

/**
 * El ícono es la marca de la app: un óvalo (la cara ideal) cruzado por la línea
 * horizontal de medición de pómulos.
 */
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const rx = size * 0.235;
  const ry = size * 0.315;
  const lw = Math.max(1.5, size * 0.035); // grosor de trazo
  const feather = Math.max(0.8, size / 220);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      px[i] = BG[0];
      px[i + 1] = BG[1];
      px[i + 2] = BG[2];
      px[i + 3] = 255;

      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;

      // Óvalo: distancia aproximada al contorno de la elipse.
      const k = Math.hypot(dx / rx, dy / ry);
      const grad = Math.hypot(dx / (rx * rx), dy / (ry * ry)) || 1e-6;
      blend(px, i, GOLD, stroke((k - 1) / grad, lw / 2, feather));

      // Línea de pómulos: horizontal, contenida dentro del óvalo.
      const inside = Math.hypot(dx / (rx * 0.99), dy / (ry * 0.99)) < 1;
      if (inside) blend(px, i, CYAN, stroke(dy + ry * 0.12, lw * 0.4, feather));
    }
  }
  return px;
}

mkdirSync(OUT, { recursive: true });
for (const size of [180, 192, 512]) {
  writeFileSync(resolve(OUT, `icon-${size}.png`), encodePng(size, size, drawIcon(size)));
  console.log(`icon-${size}.png`);
}

// Versión SVG, para la pestaña del navegador.
writeFileSync(
  resolve(OUT, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0d0f14"/>
  <ellipse cx="256" cy="256" rx="120" ry="161" fill="none" stroke="#d9a441" stroke-width="18"/>
  <line x1="141" y1="237" x2="371" y2="237" stroke="#5ec8d9" stroke-width="14"/>
</svg>
`
);
console.log('icon.svg');

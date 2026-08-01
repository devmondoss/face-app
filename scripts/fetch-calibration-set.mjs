/**
 * Baja a public/_test un set de retratos frontales de dominio público
 * (retratos oficiales del Congreso de EE.UU. y de la NASA) para calibrar los
 * prototipos de forma de rostro contra caras reales.
 *
 *   node scripts/fetch-calibration-set.mjs
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'public/_test';
const UA = 'faceapp-calibration/1.0 (local dev tool)';
const API = 'https://commons.wikimedia.org/w/api.php';

const QUERIES = [
  { q: 'official portrait 118th Congress', limit: 70 },
  { q: 'official portrait 119th Congress', limit: 40 },
  { q: 'NASA astronaut official portrait spacesuit', limit: 25 },
];

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function search(q, limit) {
  const d = await api({ action: 'query', list: 'search', srsearch: q, srnamespace: '6', srlimit: String(limit) });
  return (d.query?.search || []).map((s) => s.title);
}

/** Resuelve títulos a URLs de miniatura de 800 px (de a 50, que es el tope de la API). */
async function thumbUrls(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += 50) {
    const d = await api({
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: '800',
      titles: titles.slice(i, i + 50).join('|'),
    });
    for (const p of Object.values(d.query?.pages || {})) {
      const info = p.imageinfo?.[0];
      if (info?.thumburl) out.push({ title: p.title, url: info.thumburl });
    }
  }
  return out;
}

const slug = (t) =>
  t
    .replace(/^File:/, '')
    .replace(/\.[a-z]+$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .slice(0, 48);

mkdirSync(OUT, { recursive: true });

const titles = [];
for (const { q, limit } of QUERIES) titles.push(...(await search(q, limit)));
const unique = [...new Set(titles)].filter((t) => /\.(jpe?g|png)$/i.test(t));
console.log(`${unique.length} archivos encontrados`);

const files = await thumbUrls(unique);
console.log(`${files.length} miniaturas resueltas`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wikimedia devuelve 429 si se le pide muy seguido: se espera y se reintenta. */
async function download(url, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 429) return null;
    await sleep(1500 * (i + 1));
  }
  return null;
}

let ok = 0;
let fail = 0;
for (const f of files) {
  const path = `${OUT}/${slug(f.title)}.jpg`;
  if (existsSync(path)) continue;
  try {
    const buf = await download(f.url);
    if (!buf) {
      fail++;
      continue;
    }
    writeFileSync(path, buf);
    ok++;
  } catch {
    fail++;
  }
  await sleep(300); // ritmo amable con los servidores de Wikimedia
}
if (fail) console.log(`${fail} descargas fallaron (se ignoran)`);
console.log(`${ok} fotos descargadas en ${OUT}/`);

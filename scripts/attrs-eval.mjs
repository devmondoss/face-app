/**
 * Corre la detección de piel, pelo y ojos sobre todas las fotos de
 * public/_test y muestra la distribución.
 *
 * Para qué: un detector de color roto no falla con un error, falla devolviendo
 * un valor plausible. La única forma de darse cuenta es mirar la distribución
 * sobre muchas caras — si el 40% sale "pelirrojo", está muestreando el fondo.
 *
 *   npm run dev                 (en otra terminal)
 *   node scripts/attrs-eval.mjs
 */
import puppeteer from 'puppeteer-core';
import { readdirSync, existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ORIGIN = process.env.ORIGIN || 'https://localhost:5173';
const DIR = process.env.DIR || 'public/_test';

if (!existsSync(CHROME)) {
  console.error('No se encontró Chrome en', CHROME);
  process.exit(1);
}

const files = readdirSync(DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
console.log(`midiendo ${files.length} fotos de ${DIR}…\n`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--ignore-certificate-errors'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
await page.goto(`${ORIGIN}/tools/calibrar.html`, { waitUntil: 'networkidle0', timeout: 60000 });

const rows = [];
for (const f of files) {
  try {
    const r = await page.evaluate((u) => window.measureAttrs(u), `${ORIGIN}/${DIR.replace('public/', '')}/${f}`);
    if (!r.error) rows.push({ file: f, ...r });
  } catch {
    /* foto ilegible */
  }
}
await browser.close();

console.log(`${rows.length} caras detectadas\n`);

function dist(label, pick) {
  const counts = {};
  for (const r of rows) {
    const v = pick(r) || 'desconocido';
    counts[v] = (counts[v] || 0) + 1;
  }
  console.log(label);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const pct = ((v / rows.length) * 100).toFixed(0);
    console.log(`  ${k.padEnd(20)} ${String(v).padStart(3)}  ${pct.padStart(3)}%  ${'█'.repeat(Math.round(v / rows.length * 30))}`);
  }
  console.log('');
}

dist('TONO DE PIEL', (r) => r.skin?.label);
dist('COLOR DE PELO', (r) => r.hair?.label);
dist('COLOR DE OJOS', (r) => r.eyes?.label);
dist('CALIDAD DE LUZ', (r) => r.quality?.level);

const itas = rows.map((r) => r.skin?.ita).filter((n) => typeof n === 'number').sort((a, b) => a - b);
if (itas.length)
  console.log(
    `ITA° (ángulo de tipificación de piel): min ${itas[0]}  mediana ${itas[Math.floor(itas.length / 2)]}  max ${itas[itas.length - 1]}`
  );

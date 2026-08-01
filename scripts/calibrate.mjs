/**
 * Mide todas las fotos de public/_test con el detector real y calcula la
 * media y el desvío de cada proporción.
 *
 * Para qué: las categorías de forma de rostro son inherentemente relativas
 * ("más larga que el promedio", "mandíbula más ancha que el promedio"). Sin
 * saber cuánto mide una cara promedio CON ESTOS landmarks, cualquier umbral
 * es un número inventado. Estas estadísticas son las que se cargan en
 * NORM dentro de src/faceShape.js.
 *
 *   npm run dev                 (en otra terminal)
 *   node scripts/calibrate.mjs
 */
import puppeteer from 'puppeteer-core';
import { readdirSync, existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ORIGIN = process.env.ORIGIN || 'https://localhost:5173';
const MAX_YAW = 12; // fotos más giradas que esto no sirven para calibrar

if (!existsSync(CHROME)) {
  console.error('No se encontró Chrome en', CHROME, '— definí CHROME_PATH.');
  process.exit(1);
}

const files = readdirSync('public/_test').filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
console.log(`midiendo ${files.length} fotos…`);

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
    const r = await page.evaluate((u) => window.measureUrl(u), `${ORIGIN}/_test/${f}`);
    if (!r.error) rows.push({ file: f, ...r });
  } catch {
    /* foto ilegible, se saltea */
  }
}
await browser.close();

const usable = rows.filter((r) => Math.abs(r.pose.yaw) <= MAX_YAW && Math.abs(r.pose.roll) <= 15);
console.log(`${rows.length} caras detectadas, ${usable.length} suficientemente frontales\n`);

const KEYS = [
  'lengthOverWidth',
  'jawOverCheek',
  'foreheadOverCheek',
  'chinAngle',
  'foreheadHeightRatio',
  'jawOverForehead',
  // Usadas por el estimador de género (src/gender.js): sin su entrada en NORM,
  // toZScores las saltea en silencio y el clasificador queda ciego a ellas.
  'browGapRatio',
  'lipHeightRatio',
  'noseWidthRatio',
];

const stats = {};
for (const k of KEYS) {
  const v = usable.map((r) => r.ratios[k]).sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
  const q = (p) => v[Math.floor(p * (v.length - 1))];
  stats[k] = { mean, sd, min: v[0], p10: q(0.1), p50: q(0.5), p90: q(0.9), max: v[v.length - 1] };
}

const f3 = (n) => n.toFixed(3).padStart(8);
console.log('proporción              media       sd      min      p10      p50      p90      max');
for (const k of KEYS) {
  const s = stats[k];
  console.log(
    k.padEnd(22),
    f3(s.mean),
    f3(s.sd),
    f3(s.min),
    f3(s.p10),
    f3(s.p50),
    f3(s.p90),
    f3(s.max)
  );
}

console.log('\n// Pegar en src/faceShape.js:');
console.log('const NORM = {');
for (const k of KEYS) console.log(`  ${k}: { mean: ${stats[k].mean.toFixed(3)}, sd: ${stats[k].sd.toFixed(3)} },`);
console.log('};');

// Distribución de formas con los prototipos actuales, para ver si alguna
// categoría se come a todas las demás.
const counts = {};
for (const r of usable) counts[r.best] = (counts[r.best] || 0) + 1;
console.log('\nclasificación actual:');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.padEnd(12)} ${String(v).padStart(3)}  ${'█'.repeat(Math.round((v / usable.length) * 40))}`);

// La confianza que se le muestra al usuario tiene que ser interpretable: con
// 7 categorías el azar es 14%, así que un 23% "gana" pero se lee como que la
// app no tiene idea. Estas estadísticas sirven para ajustar T en faceShape.js.
// Las notas de rasgos secundarios (frente alta, mentón en punta, etc.) usan
// umbrales en z. Si nunca se disparan, o se disparan siempre, están mal.
const noteCounts = {};
let withNotes = 0;
for (const r of usable) {
  if (r.notes?.length) withNotes++;
  for (const n of r.notes || []) noteCounts[n] = (noteCounts[n] || 0) + 1;
}
console.log(`\nnotas de rasgos: ${withNotes}/${usable.length} caras reciben al menos una`);
for (const [k, v] of Object.entries(noteCounts).sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.padEnd(18)} ${v}`);

// Barrido de la temperatura de la softmax, reprocesando las distancias ya
// medidas. Se busca el T que deje la confianza del ganador en un rango
// interpretable sin marcar a casi todo el mundo como caso mixto.
console.log('\nbarrido de temperatura (T de la softmax en faceShape.js):');
console.log('    T     p10  mediana   p90   mixtos');
for (const T of [0.9, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3]) {
  const tops = [];
  let mixed = 0;
  for (const r of usable) {
    const d = r.distances.map((x) => x.distance).sort((a, b) => a - b);
    const exps = d.map((x) => Math.exp(-(x * x) / (2 * T * T)));
    const sum = exps.reduce((a, b) => a + b, 0) || 1;
    const top = exps[0] / sum;
    tops.push(top);
    if (top - exps[1] / sum < 0.12) mixed++;
  }
  tops.sort((a, b) => a - b);
  const q = (p) => tops[Math.floor(p * (tops.length - 1))];
  console.log(
    `  ${T.toFixed(2)}   ${(q(0.1) * 100).toFixed(0).padStart(3)}%   ${(q(0.5) * 100)
      .toFixed(0)
      .padStart(3)}%   ${(q(0.9) * 100).toFixed(0).padStart(3)}%   ${String(mixed).padStart(3)}/${usable.length}`
  );
}

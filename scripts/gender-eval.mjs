/**
 * Mide la precisión del estimador de género contra el set ETIQUETADO de
 * public/_gender/ y busca los mejores pesos.
 *
 * Por qué existe: se puede escribir una heurística que suene muy sensata
 * ("mandíbula ancha = hombre") y que acierte al 55%, o sea apenas mejor que
 * tirar una moneda. Sin un set etiquetado no hay forma de saber cuál de las
 * dos cosas se construyó. Este script da el número.
 *
 * Tres decisiones por escala (con ~1000 caras en vez de 70):
 *  - Las mediciones se cachean en measurements.json. Medir es lo caro
 *    (~1s por foto en el navegador); probar modelos sobre datos ya medidos es
 *    instantáneo. Así se puede iterar sin volver a medir todo.
 *  - Validación cruzada en 5 pliegues en vez de dejando-uno-afuera: con 1000
 *    muestras, LOO significa 1000 ajustes completos y tarda una eternidad.
 *  - Se comparan tres modelos, incluida una regresión logística, que con
 *    suficientes datos suele ganarle a la búsqueda por descenso.
 *
 *   npm run dev                  (en otra terminal)
 *   node scripts/gender-eval.mjs
 */
import puppeteer from 'puppeteer-core';
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ORIGIN = process.env.ORIGIN || 'https://localhost:5173';
const CACHE = 'public/_gender/measurements.json';
const MAX_YAW = 18;

const FEATURES = [
  'jawOverCheek',
  'chinAngle',
  'browGapRatio',
  'lipHeightRatio',
  'noseWidthRatio',
  'lengthOverWidth',
  'foreheadOverCheek',
  'foreheadHeightRatio',
  'jawOverForehead',
];

/* ══════════ 1. reunir las fotos etiquetadas ══════════ */

const targets = [];
for (const label of ['hombre', 'mujer']) {
  const dir = `public/_gender/${label}`;
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => /\.(jpe?g|png)$/i.test(x)))
    targets.push({ id: `${label}/${f}`, label, url: `${ORIGIN}/_gender/${label}/${f}` });
}
// Fotos de public/_test etiquetadas por nombre con scripts/label-test-set.mjs.
const labelsPath = 'public/_gender/labels.json';
if (existsSync(labelsPath)) {
  const labels = JSON.parse(readFileSync(labelsPath, 'utf8'));
  for (const [f, label] of Object.entries(labels))
    if (existsSync(`public/_test/${f}`))
      targets.push({ id: `_test/${f}`, label, url: `${ORIGIN}/_test/${f}` });
}
console.log(`${targets.length} fotos etiquetadas en disco`);

/* ══════════ 2. medir (con caché) ══════════ */

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const pendientes = targets.filter((t) => !cache[t.id]);
console.log(`${targets.length - pendientes.length} ya medidas, ${pendientes.length} por medir`);

if (pendientes.length) {
  if (!existsSync(CHROME)) {
    console.error('No se encontró Chrome en', CHROME);
    process.exit(1);
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--ignore-certificate-errors'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  await page.goto(`${ORIGIN}/tools/calibrar.html`, { waitUntil: 'networkidle0', timeout: 60000 });

  const t0 = Date.now();
  let hechas = 0;
  for (const t of pendientes) {
    try {
      const r = await page.evaluate((u) => window.measureAttrs(u), t.url);
      // Se guarda también lo inservible, con motivo, para no reintentarlo.
      cache[t.id] = r.error
        ? { skip: 'sin cara' }
        : Math.abs(r.pose.yaw) > MAX_YAW
          ? { skip: 'de perfil' }
          : { label: t.label, ratios: r.ratios };
    } catch {
      cache[t.id] = { skip: 'ilegible' };
    }
    if (++hechas % 100 === 0) {
      const porMin = hechas / ((Date.now() - t0) / 60000);
      console.log(`  ${hechas}/${pendientes.length}  (${porMin.toFixed(0)} fotos/min)`);
      writeFileSync(CACHE, JSON.stringify(cache)); // guardado parcial por si se corta
    }
  }
  await browser.close();
  writeFileSync(CACHE, JSON.stringify(cache));
}

/* ══════════ 3. pasar a z-scores ══════════ */

const usables = targets.map((t) => cache[t.id]).filter((c) => c && !c.skip);
const descartes = {};
for (const t of targets) {
  const c = cache[t.id];
  if (c?.skip) descartes[c.skip] = (descartes[c.skip] || 0) + 1;
}
console.log(
  `\n${usables.length} caras usables` +
    (Object.keys(descartes).length
      ? `  (descartadas: ${Object.entries(descartes).map(([k, v]) => `${v} ${k}`).join(', ')})`
      : '')
);

const { NORM } = await import('../src/faceShape.js');
const samples = usables.map((u) => {
  const z = {};
  for (const f of FEATURES) if (NORM[f]) z[f] = (u.ratios[f] - NORM[f].mean) / NORM[f].sd;
  return { label: u.label, z };
});

const conteo = { hombre: 0, mujer: 0 };
for (const s of samples) conteo[s.label]++;
console.log(`  ${conteo.hombre} hombres / ${conteo.mujer} mujeres`);

if (samples.length < 40) {
  console.error('Muy pocas muestras para evaluar nada.');
  process.exit(1);
}

/* ══════════ 4. métrica ══════════ */

/** Precisión balanceada: promedia el acierto de cada clase por separado. Con
 *  clases de distinto tamaño, la precisión cruda premia adivinar la mayoritaria. */
function evaluateOn(rows, weights, bias) {
  const hit = { hombre: 0, mujer: 0 };
  const total = { hombre: 0, mujer: 0 };
  for (const s of rows) {
    let score = bias;
    for (const f of FEATURES) if (typeof s.z[f] === 'number') score += (weights[f] || 0) * s.z[f];
    total[s.label]++;
    if ((score >= 0 ? 'hombre' : 'mujer') === s.label) hit[s.label]++;
  }
  const rec = {
    hombre: hit.hombre / Math.max(1, total.hombre),
    mujer: hit.mujer / Math.max(1, total.mujer),
  };
  return { balanced: (rec.hombre + rec.mujer) / 2, rec, total };
}

/* ══════════ 5. modelos ══════════ */

/** Búsqueda directa: mueve un peso por vez buscando maximizar el acierto. */
function fitCoordinate(rows) {
  let best = { weights: Object.fromEntries(FEATURES.map((f) => [f, 0])), bias: 0 };
  best.score = evaluateOn(rows, best.weights, best.bias).balanced;
  for (let pass = 0; pass < 4; pass++) {
    for (const f of [...FEATURES, '__bias']) {
      let bestVal = f === '__bias' ? best.bias : best.weights[f];
      let bestScore = best.score;
      for (let v = -1.6; v <= 1.6001; v += 0.1) {
        const w = { ...best.weights };
        let b = best.bias;
        if (f === '__bias') b = v;
        else w[f] = v;
        const s = evaluateOn(rows, w, b).balanced;
        if (s > bestScore) {
          bestScore = s;
          bestVal = v;
        }
      }
      if (f === '__bias') best.bias = bestVal;
      else best.weights[f] = bestVal;
      best.score = bestScore;
    }
  }
  return { weights: best.weights, bias: best.bias };
}

/** Centroides (LDA diagonal): el peso es cuánto separa cada rasgo a las clases. */
function fitCentroid(rows) {
  const weights = {};
  let bias = 0;
  for (const f of FEATURES) {
    const mean = (lbl) => {
      const v = rows.filter((s) => s.label === lbl).map((s) => s.z[f]).filter((n) => typeof n === 'number');
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    };
    const h = mean('hombre');
    const m = mean('mujer');
    weights[f] = h - m;
    bias -= weights[f] * ((h + m) / 2);
  }
  return { weights, bias };
}

/**
 * Regresión logística por descenso de gradiente, con pesos de clase para
 * compensar el desbalance y una regularización L2 suave.
 */
function fitLogistic(rows, { epochs = 400, lr = 0.08, l2 = 0.004 } = {}) {
  const weights = Object.fromEntries(FEATURES.map((f) => [f, 0]));
  let bias = 0;
  const n = { hombre: rows.filter((r) => r.label === 'hombre').length, mujer: 0 };
  n.mujer = rows.length - n.hombre;
  // Cada clase pesa lo mismo en total, sin importar cuántas muestras tenga.
  const peso = { hombre: rows.length / (2 * Math.max(1, n.hombre)), mujer: rows.length / (2 * Math.max(1, n.mujer)) };

  for (let e = 0; e < epochs; e++) {
    const grad = Object.fromEntries(FEATURES.map((f) => [f, 0]));
    let gb = 0;
    for (const s of rows) {
      let z = bias;
      for (const f of FEATURES) if (typeof s.z[f] === 'number') z += weights[f] * s.z[f];
      const p = 1 / (1 + Math.exp(-z));
      const y = s.label === 'hombre' ? 1 : 0;
      const err = (p - y) * peso[s.label];
      for (const f of FEATURES) if (typeof s.z[f] === 'number') grad[f] += err * s.z[f];
      gb += err;
    }
    for (const f of FEATURES) weights[f] -= (lr * (grad[f] / rows.length + l2 * weights[f]));
    bias -= lr * (gb / rows.length);
  }
  return { weights, bias };
}

/* ══════════ 6. validación cruzada en 5 pliegues ══════════ */

/** Pliegues estratificados: cada uno conserva la proporción de clases. */
function makeFolds(rows, k) {
  const folds = Array.from({ length: k }, () => []);
  for (const label of ['hombre', 'mujer']) {
    const grupo = rows.filter((r) => r.label === label);
    grupo.forEach((r, i) => folds[i % k].push(r));
  }
  return folds;
}

function crossValidate(fitter, k = 5) {
  const folds = makeFolds(samples, k);
  const hit = { hombre: 0, mujer: 0 };
  const total = { hombre: 0, mujer: 0 };
  for (let i = 0; i < k; i++) {
    const test = folds[i];
    const train = folds.filter((_, j) => j !== i).flat();
    const m = fitter(train);
    const r = evaluateOn(test, m.weights, m.bias);
    hit.hombre += r.rec.hombre * r.total.hombre;
    hit.mujer += r.rec.mujer * r.total.mujer;
    total.hombre += r.total.hombre;
    total.mujer += r.total.mujer;
  }
  const rec = { hombre: hit.hombre / total.hombre, mujer: hit.mujer / total.mujer };
  return { balanced: (rec.hombre + rec.mujer) / 2, rec };
}

/* ══════════ 7. resultados ══════════ */

console.log('\nseparación por rasgo (media de z en cada clase):');
console.log('rasgo                  hombre   mujer   diferencia');
const sep = FEATURES.map((f) => {
  const m = (lbl) => {
    const v = samples.filter((s) => s.label === lbl).map((s) => s.z[f]).filter((n) => typeof n === 'number');
    return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  };
  return { f, h: m('hombre'), w: m('mujer') };
}).sort((a, b) => Math.abs(b.h - b.w) - Math.abs(a.h - a.w));
for (const s of sep)
  console.log(
    `${s.f.padEnd(22)} ${s.h.toFixed(2).padStart(6)}  ${s.w.toFixed(2).padStart(6)}  ${(s.h - s.w).toFixed(2).padStart(6)}`
  );

const actual = await import('../src/gender.js');
console.log(
  `\npesos actuales en el código: ${(evaluateOn(samples, actual.GENDER_WEIGHTS, actual.GENDER_BIAS).balanced * 100).toFixed(1)}%`
);

console.log('\nvalidación cruzada en 5 pliegues — el número honesto:');
const candidatos = [
  ['descenso coordenado', fitCoordinate],
  ['centroides (LDA diag.)', fitCentroid],
  ['regresión logística', fitLogistic],
];
let winner = null;
for (const [name, fitter] of candidatos) {
  const cv = crossValidate(fitter);
  console.log(
    `  ${name.padEnd(24)} ${(cv.balanced * 100).toFixed(1)}%  (hombre ${(cv.rec.hombre * 100).toFixed(0)}%, mujer ${(cv.rec.mujer * 100).toFixed(0)}%)`
  );
  if (!winner || cv.balanced > winner.cv.balanced) winner = { name, fitter, cv };
}

// Margen de error aproximado de la clase minoritaria (95%).
const nMin = Math.min(conteo.hombre, conteo.mujer);
const err = 1.96 * Math.sqrt((winner.cv.balanced * (1 - winner.cv.balanced)) / nMin);
console.log(`  margen de error aprox. ±${(err * 100).toFixed(1)} puntos (clase menor: ${nMin})`);

const chosen = winner.fitter(samples);
console.log(`\nelegido: ${winner.name} — ${(winner.cv.balanced * 100).toFixed(1)}% validado`);
console.log('\n// Pegar en src/gender.js:');
console.log('export const GENDER_WEIGHTS = {');
for (const f of FEATURES) console.log(`  ${f}: ${chosen.weights[f].toFixed(3)},`);
console.log('};');
console.log(`export const GENDER_BIAS = ${chosen.bias.toFixed(3)};`);

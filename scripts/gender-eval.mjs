/**
 * Mide la precisión del estimador de género contra el set ETIQUETADO de
 * public/_gender/{hombre,mujer}/ y busca mejores pesos.
 *
 * Por qué existe: se puede escribir una heurística que suene muy sensata
 * ("mandíbula ancha = hombre") y que acierte al 55%, o sea apenas mejor que
 * tirar una moneda. Sin un set etiquetado no hay forma de saber cuál de las
 * dos cosas se construyó. Este script da el número.
 *
 *   npm run dev                  (en otra terminal)
 *   node scripts/gender-eval.mjs
 */
import puppeteer from 'puppeteer-core';
import { readdirSync, existsSync, readFileSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ORIGIN = process.env.ORIGIN || 'https://localhost:5173';
const MAX_YAW = 18;

if (!existsSync(CHROME) || !existsSync('public/_gender')) {
  console.error('Falta Chrome o el set: node scripts/fetch-gender-set.mjs');
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

/**
 * Dos fuentes de etiquetas, porque bajar imágenes nuevas de Wikimedia es
 * lentísimo y hay que aprovechar todo lo que haya:
 *  - public/_gender/{hombre,mujer}/  → etiqueta por carpeta
 *  - public/_test/ + labels.json     → fotos ya descargadas, etiquetadas por
 *                                       nombre con scripts/label-test-set.mjs
 */
const targets = [];
for (const label of ['hombre', 'mujer']) {
  const dir = `public/_gender/${label}`;
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => /\.(jpe?g|png)$/i.test(x)))
    targets.push({ label, url: `${ORIGIN}/_gender/${label}/${f}`, file: f });
}
const labelsPath = 'public/_gender/labels.json';
if (existsSync(labelsPath)) {
  const labels = JSON.parse(readFileSync(labelsPath, 'utf8'));
  for (const [f, label] of Object.entries(labels))
    if (existsSync(`public/_test/${f}`)) targets.push({ label, url: `${ORIGIN}/_test/${f}`, file: f });
}

const samples = [];
for (const t of targets) {
  try {
    const r = await page.evaluate((u) => window.measureAttrs(u), t.url);
    if (!r.error && Math.abs(r.pose.yaw) <= MAX_YAW)
      samples.push({ label: t.label, ratios: r.ratios, file: t.file });
  } catch {
    /* foto ilegible */
  }
}
for (const label of ['hombre', 'mujer'])
  console.log(`${label}: ${samples.filter((s) => s.label === label).length} caras usables`);

// Los z-scores se calculan en el navegador con el mismo NORM que usa la app.
const zs = await page.evaluate(async (rows) => {
  const { toZScores } = await import('/src/faceShape.js');
  return rows.map((r) => toZScores(r));
}, samples.map((s) => s.ratios));
samples.forEach((s, i) => (s.z = zs[i]));

await browser.close();

if (samples.length < 20) {
  console.error('Muy pocas muestras para evaluar nada.');
  process.exit(1);
}

const FEATURES = [
  'jawOverCheek',
  'chinAngle',
  'browGapRatio',
  'lipHeightRatio',
  'noseWidthRatio',
  'lengthOverWidth',
];

/** Precisión balanceada: promedia el acierto en cada clase por separado. Con
 *  clases de distinto tamaño, la precisión cruda premia adivinar la mayoritaria. */
const evaluate = (weights, bias) => evaluateOn(samples, weights, bias);

function evaluateOn(rows, weights, bias) {
  const hit = { hombre: 0, mujer: 0 };
  const total = { hombre: 0, mujer: 0 };
  for (const s of rows) {
    let score = bias;
    for (const f of FEATURES) if (typeof s.z[f] === 'number') score += (weights[f] || 0) * s.z[f];
    const pred = score >= 0 ? 'hombre' : 'mujer';
    total[s.label]++;
    if (pred === s.label) hit[s.label]++;
  }
  const rec = {
    hombre: hit.hombre / Math.max(1, total.hombre),
    mujer: hit.mujer / Math.max(1, total.mujer),
  };
  return {
    balanced: (rec.hombre + rec.mujer) / 2,
    raw: (hit.hombre + hit.mujer) / Math.max(1, rows.length),
    rec,
    total,
  };
}

/* ── separación de cada rasgo por sí solo ── */
console.log('\nseparación por rasgo (media de z en cada clase):');
console.log('rasgo                hombre   mujer    diferencia');
for (const f of FEATURES) {
  const m = (lbl) => {
    const v = samples.filter((s) => s.label === lbl).map((s) => s.z[f]).filter((n) => typeof n === 'number');
    return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  };
  const h = m('hombre');
  const w = m('mujer');
  console.log(
    `${f.padEnd(20)} ${h.toFixed(2).padStart(6)}  ${w.toFixed(2).padStart(6)}   ${(h - w).toFixed(2).padStart(6)}`
  );
}

/* ── punto de partida: los pesos que están en el código ── */
const current = await import('../src/gender.js').catch(() => null);
if (current) {
  const r = evaluate(current.GENDER_WEIGHTS, current.GENDER_BIAS);
  console.log(
    `\npesos actuales: ${(r.balanced * 100).toFixed(1)}% balanceada  (hombre ${(r.rec.hombre * 100).toFixed(0)}%, mujer ${(r.rec.mujer * 100).toFixed(0)}%)`
  );
}

/* ── búsqueda por descenso coordenado ── */
function fit(rows) {
  const score = (w, b) => evaluateOn(rows, w, b).balanced;
  let best = { weights: Object.fromEntries(FEATURES.map((f) => [f, 0])), bias: 0 };
  best.score = score(best.weights, best.bias);

  for (let pass = 0; pass < 6; pass++) {
    for (const f of [...FEATURES, '__bias']) {
      let bestVal = f === '__bias' ? best.bias : best.weights[f];
      let bestScore = best.score;
      for (let v = -1.6; v <= 1.6001; v += 0.1) {
        const w = { ...best.weights };
        let b = best.bias;
        if (f === '__bias') b = v;
        else w[f] = v;
        const s = score(w, b);
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
  return best;
}

/**
 * Modelo de centroides (LDA diagonal): el peso de cada rasgo es directamente
 * cuánto separa a las dos clases, y el umbral queda en el punto medio.
 *
 * Tiene muchos menos grados de libertad que el descenso coordenado —estima
 * solo dos medias por rasgo, en vez de buscar el valor que maximiza el
 * acierto— así que se sobreajusta mucho menos con una muestra chica.
 */
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

const best = fit(samples);
const r = evaluate(best.weights, best.bias);
console.log(
  `\nmejores pesos encontrados: ${(r.balanced * 100).toFixed(1)}% balanceada  (hombre ${(r.rec.hombre * 100).toFixed(0)}%, mujer ${(r.rec.mujer * 100).toFixed(0)}%)`
);
console.log(`muestras: ${r.total.hombre} hombres / ${r.total.mujer} mujeres`);
/* ── validación cruzada dejando uno afuera ──
 * El número de arriba está medido sobre las mismas caras con las que se
 * ajustaron los pesos, así que está inflado. Acá se reajusta desde cero para
 * cada cara, dejándola afuera, y se predice esa cara sola. Es el único número
 * que dice algo sobre caras que el modelo nunca vio. */
function crossValidate(fitter) {
  const hit = { hombre: 0, mujer: 0 };
  const total = { hombre: 0, mujer: 0 };
  for (let i = 0; i < samples.length; i++) {
    const held = samples[i];
    const m = fitter(samples.filter((_, j) => j !== i));
    let score = m.bias;
    for (const f of FEATURES) if (typeof held.z[f] === 'number') score += (m.weights[f] || 0) * held.z[f];
    total[held.label]++;
    if ((score >= 0 ? 'hombre' : 'mujer') === held.label) hit[held.label]++;
  }
  const rec = {
    hombre: hit.hombre / Math.max(1, total.hombre),
    mujer: hit.mujer / Math.max(1, total.mujer),
  };
  return { balanced: (rec.hombre + rec.mujer) / 2, rec, total };
}

/* ── validación cruzada dejando uno afuera ──
 * Los números de arriba están medidos sobre las mismas caras con las que se
 * ajustaron los pesos, así que están inflados. Acá se reajusta desde cero para
 * cada cara, dejándola afuera, y se predice esa cara sola. Es el único número
 * que dice algo sobre caras que el modelo nunca vio. */
console.log('\nvalidación cruzada (dejando uno afuera) — el número honesto:');
const candidates = [
  ['descenso coordenado', fit],
  ['centroides (LDA diag.)', fitCentroid],
];
let winner = null;
for (const [name, fitter] of candidates) {
  const cv = crossValidate(fitter);
  console.log(
    `  ${name.padEnd(24)} ${(cv.balanced * 100).toFixed(1)}%  (hombre ${(cv.rec.hombre * 100).toFixed(0)}%, mujer ${(cv.rec.mujer * 100).toFixed(0)}%)`
  );
  if (!winner || cv.balanced > winner.cv.balanced) winner = { name, fitter, cv };
}

const totalMujeres = samples.filter((s) => s.label === 'mujer').length;
if (totalMujeres < 25)
  console.log(
    `  ⚠ solo ${totalMujeres} mujeres en la muestra: el porcentaje femenino tiene un margen de error grande.`
  );

const chosen = winner.fitter(samples);
console.log(`\nelegido: ${winner.name} (${(winner.cv.balanced * 100).toFixed(1)}% validado)`);
console.log('\n// Pegar en src/gender.js:');
console.log('export const GENDER_WEIGHTS = {');
for (const f of FEATURES) console.log(`  ${f}: ${chosen.weights[f].toFixed(2)},`);
console.log('};');
console.log(`export const GENDER_BIAS = ${chosen.bias.toFixed(2)};`);

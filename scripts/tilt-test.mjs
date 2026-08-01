/**
 * Verifica que las líneas de medición sigan cayendo sobre la cara cuando la
 * cabeza está inclinada.
 *
 * Es la trampa fácil de este código: para medir hay que anular la inclinación
 * (rotar los puntos hasta que la línea de los ojos quede horizontal), pero para
 * DIBUJAR hay que usar los puntos sin rotar. Si se mezclan, con la cabeza
 * derecha no se nota nada y con la cabeza ladeada las líneas se van de la cara.
 *
 *   npm run dev                  (en otra terminal)
 *   node scripts/tilt-test.mjs
 */
import puppeteer from 'puppeteer-core';
import { readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ORIGIN = process.env.ORIGIN || 'https://localhost:5173';
const ANGLE = Number(process.env.ANGLE || 14);
const SHOTS = 'tmp-screenshots';

const photo = readdirSync('public/_test').find((f) => /\.(jpe?g|png)$/i.test(f));
if (!photo || !existsSync(CHROME)) {
  console.error('Falta Chrome o una foto en public/_test/');
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--ignore-certificate-errors'],
});
const fail = async (m) => {
  console.error('FALLO:', m);
  await browser.close();
  process.exit(1);
};

// 1) Se genera una copia rotada de la foto usando el propio navegador.
const rotator = await browser.newPage();
await rotator.goto(`${ORIGIN}/tools/calibrar.html`, { waitUntil: 'domcontentloaded' });
const rotatedB64 = await rotator.evaluate(
  async (url, deg) => {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const rad = (deg * Math.PI) / 180;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    return c.toDataURL('image/jpeg', 0.92).split(',')[1];
  },
  `${ORIGIN}/_test/${photo}`,
  ANGLE
);
const tiltedPath = resolve(SHOTS, 'tilted-input.jpg');
writeFileSync(tiltedPath, Buffer.from(rotatedB64, 'base64'));
console.log(`✓ foto rotada ${ANGLE}° generada`);

// 2) Se corre la app con esa foto.
const page = await browser.newPage();
// hasTouch/isMobile son necesarios: la app se bloquea sola en escritorio.
await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await page.goto(ORIGIN, { waitUntil: 'networkidle0', timeout: 60000 });
const input = await page.$('#file-input');
await input.uploadFile(tiltedPath);
await page
  .waitForFunction(() => document.getElementById('screen-result')?.classList.contains('active'), {
    timeout: 90000,
  })
  .catch(() => fail('no llegó a resultados con la foto rotada'));

await page.click('#btn-mesh');
await new Promise((r) => setTimeout(r, 300));

// 3) Comprobación: los puntos de dibujo tienen que estar inclinados (siguen la
//    cara real) y los de medición tienen que estar horizontales (corregidos).
const check = await page.evaluate(() => {
  const m = window.__lastAnalysis;
  if (!m) return null;
  const ang = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const L = 234;
  const R = 454;
  return {
    dibujo: ang(m.points[L], m.points[R]),
    medicion: ang(m.pointsAligned[L], m.pointsAligned[R]),
    roll: m.pose.roll,
    yaw: m.pose.yaw,
    aviso: document.getElementById('pose-warn').hidden
      ? null
      : document.getElementById('pose-warn').textContent,
  };
});
if (!check) await fail('la app no expuso el análisis (window.__lastAnalysis)');

console.log(`  inclinación detectada (roll):        ${check.roll.toFixed(1)}°`);
console.log(`  línea de pómulos para DIBUJAR:       ${check.dibujo.toFixed(1)}° (debe seguir la cara)`);
console.log(`  línea de pómulos para MEDIR:         ${check.medicion.toFixed(1)}° (debe dar ~0°)`);

if (Math.abs(check.medicion) > 3)
  await fail(`los puntos de medición no quedaron alineados (${check.medicion.toFixed(1)}°)`);
if (Math.abs(check.dibujo) < 4)
  await fail('los puntos de dibujo salieron horizontales: se están usando los rotados para dibujar');

// Una foto solamente ladeada no tiene que reportarse como "cara girada".
console.log(`  giro (yaw) estimado:                 ${check.yaw.toFixed(1)}° (debe dar ~0°)`);
if (Math.abs(check.yaw) > 8)
  await fail(`una inclinación pura se está midiendo como giro de ${check.yaw.toFixed(1)}°`);
if (check.aviso && /girada hacia un costado/.test(check.aviso))
  await fail('avisa "cara girada" cuando en realidad está ladeada');
console.log('  aviso de pose:', check.aviso ? check.aviso.slice(0, 60) + '…' : 'ninguno');

await page.screenshot({ path: `${SHOTS}/5-inclinada.png` });
console.log('✓ dibujo y medición usan sistemas de coordenadas distintos, como corresponde');

await browser.close();

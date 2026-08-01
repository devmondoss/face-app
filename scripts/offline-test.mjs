/**
 * Verifica que el service worker deje la app usable sin conexión.
 * Corre contra el build de producción:
 *
 *   npm run build && npm run preview     (en otra terminal)
 *   ORIGIN=https://localhost:4173 node scripts/offline-test.mjs
 */
import puppeteer from 'puppeteer-core';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ORIGIN = process.env.ORIGIN || 'https://localhost:4173';

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
// hasTouch/isMobile son necesarios: la app se bloquea sola en escritorio.
await page.setViewport({ width: 414, height: 896, hasTouch: true, isMobile: true });

const fail = async (msg) => {
  console.error('FALLO:', msg);
  await browser.close();
  process.exit(1);
};

await page.goto(ORIGIN, { waitUntil: 'networkidle0', timeout: 60000 });

const swActive = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.ready;
  return !!r.active;
});
if (!swActive) await fail('el service worker no quedó activo');
console.log('✓ service worker activo');

// El precache del modelo (3,7 MB) y del WASM tarda; se espera a que termine.
await page
  .waitForFunction(
    async () => {
      const names = (await caches.keys()).filter((n) => n.startsWith('faceapp-'));
      if (!names.length) return false;
      const c = await caches.open(names[0]);
      const keys = await c.keys();
      return keys.some((k) => k.url.includes('face_landmarker.task'));
    },
    { timeout: 60000, polling: 1000 }
  )
  .catch(() => fail('el modelo nunca se guardó en la caché'));

const cached = await page.evaluate(async () => {
  const names = (await caches.keys()).filter((n) => n.startsWith('faceapp-'));
  const c = await caches.open(names[0]);
  return (await c.keys()).map((k) => new URL(k.url).pathname);
});
console.log(`✓ ${cached.length} archivos en caché`);
console.log('  modelo:', cached.some((u) => u.includes('face_landmarker.task')));
console.log('  wasm:  ', cached.filter((u) => u.includes('/wasm/')).length, 'archivos');
console.log('  js/css:', cached.filter((u) => u.includes('/assets/')).length, 'archivos');

if (!cached.filter((u) => u.includes('/wasm/')).length) await fail('el WASM no quedó cacheado');
if (!cached.filter((u) => u.includes('/assets/')).length) await fail('el bundle no quedó cacheado');

// Ahora sin red.
await page.setOfflineMode(true);
await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => fail('no cargó offline'));

const offline = await page.evaluate(() => ({
  title: document.title,
  start: document.getElementById('screen-start')?.classList.contains('active'),
  blocked: document.body.classList.contains('is-desktop'),
  // fontFamily solo dice qué pide el CSS. document.fonts.check dice si el
  // archivo .woff2 realmente está disponible, que es lo que importa offline.
  poppins: document.fonts.check('600 16px Poppins'),
}));

if (!offline.title) await fail('la página offline vino vacía');
if (!offline.start) await fail('la pantalla de inicio no quedó activa offline');
if (offline.blocked) await fail('offline se comportó como escritorio');
if (!offline.poppins) await fail('la tipografía Poppins no salió de la caché offline');

console.log('✓ sin conexión: la app carga y el JS corre');

// Lo que de verdad importa: que el análisis completo funcione sin red. El
// modelo y el WASM tienen que salir de la caché.
const photo = readdirSync('public/_test').find((f) => /\.(jpe?g|png)$/i.test(f));
if (photo) {
  const input = await page.$('#file-input');
  await input.uploadFile(resolve('public/_test', photo));
  await page
    .waitForFunction(() => document.getElementById('screen-result')?.classList.contains('active'), {
      timeout: 90000,
    })
    .catch(() => fail('el análisis no funcionó sin conexión'));
  const shape = await page.evaluate(() => ({
    name: document.getElementById('shape-name').textContent,
    cards: document.querySelectorAll('#recommended .card').length,
  }));
  if (!shape.name || shape.name === '—' || !shape.cards)
    await fail('sin conexión no se generó el resultado');
  console.log(`✓ sin conexión: analizó la foto → ${shape.name}, ${shape.cards} cortes`);
} else {
  console.log('· (sin fotos en public/_test, se saltea la prueba de análisis offline)');
}

await browser.close();
console.log('\nOffline OK.');

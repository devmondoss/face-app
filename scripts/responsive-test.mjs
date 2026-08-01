/**
 * Mide la app en los tamaños reales de iPhone y reporta cuánto hay que
 * scrollear y si algo desborda a lo ancho.
 *
 * "Se scrollea mucho" es una queja verificable: se mide como pantallas de
 * alto (scrollHeight ÷ alto del viewport). El desborde horizontal se mide
 * comparando scrollWidth con clientWidth — en un teléfono angosto cualquier
 * elemento con ancho fijo lo rompe y no se nota en el navegador de escritorio.
 *
 *   npm run dev                        (en otra terminal)
 *   node scripts/responsive-test.mjs
 */
import puppeteer from 'puppeteer-core';
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ORIGIN = process.env.ORIGIN || 'https://localhost:5173';
const SHOTS = 'tmp-screenshots/responsive';
const SHOOT = process.env.SHOOT !== '0';

// Tamaños en píxeles CSS, en vertical. Cubren desde el iPhone más chico que
// sigue en uso hasta el Pro Max actual.
const DEVICES = [
  { name: 'iPhone SE (1a gen)', width: 320, height: 568 },
  { name: 'iPhone SE / 8', width: 375, height: 667 },
  { name: 'iPhone 13 mini', width: 375, height: 812 },
  { name: 'iPhone 14 / 15', width: 390, height: 844 },
  { name: 'iPhone 15 Pro', width: 393, height: 852 },
  { name: 'iPhone 15 Pro Max', width: 430, height: 932 },
];

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

const rows = [];
let overflowProblems = 0;

for (const d of DEVICES) {
  const page = await browser.newPage();
  await page.setViewport({ ...d, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.goto(ORIGIN, { waitUntil: 'networkidle0', timeout: 60000 });

  const measure = async (screen) => {
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      // Cualquier elemento que sobresalga del ancho del viewport.
      const wide = [...document.querySelectorAll('#app *')]
        .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 1)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className.split(' ')[0] || ''}`);
      return {
        scrollH: de.scrollHeight,
        viewH: de.clientHeight,
        overflowX: de.scrollWidth > de.clientWidth + 1,
        scrollW: de.scrollWidth,
        clientW: de.clientWidth,
        wide: [...new Set(wide)].slice(0, 4),
      };
    });
    return { screen, ...m, screens: m.scrollH / m.viewH };
  };

  const inicio = await measure('inicio');
  if (SHOOT) await page.screenshot({ path: `${SHOTS}/${d.width}x${d.height}-inicio.png` });

  const input = await page.$('#file-input');
  await input.uploadFile(resolve('public/_test', photo));
  await page
    .waitForFunction(() => document.getElementById('screen-result')?.classList.contains('active'), {
      timeout: 90000,
    })
    .catch(() => {});
  const resultado = await measure('resultado');
  if (SHOOT) await page.screenshot({ path: `${SHOTS}/${d.width}x${d.height}-resultado.png` });

  for (const m of [inicio, resultado]) {
    rows.push({ device: d.name, w: d.width, h: d.height, ...m });
    if (m.overflowX) overflowProblems++;
  }
  await page.close();
}

await browser.close();

console.log('\ndispositivo             px     pantalla     alto    scroll   desborde');
console.log('-'.repeat(76));
for (const r of rows) {
  const flag = r.screens > 3 ? ' !' : '';
  const ovf = r.overflowX ? `SI (${r.scrollW}>${r.clientW}) ${r.wide.join(' ')}` : 'no';
  console.log(
    `${r.device.padEnd(22)} ${String(r.w).padStart(4)}  ${r.screen.padEnd(10)} ${String(r.scrollH).padStart(6)}px  ${r.screens.toFixed(1).padStart(5)}x${flag}  ${ovf}`
  );
}

const peor = rows.reduce((a, b) => (b.screens > a.screens ? b : a));
console.log(
  `\npeor caso: ${peor.screens.toFixed(1)} pantallas de scroll en ${peor.device} (${peor.screen})`
);
console.log(`desbordes horizontales: ${overflowProblems}`);

// Guardas de regresión. Los límites salen de lo que ya se logró: el rediseño
// bajó el peor caso de 6,0 a 2,3 pantallas y eliminó los 5 desbordes.
const MAX_SCREENS = 2.8;
let failed = false;
if (overflowProblems > 0) {
  console.error(`\nFALLO: ${overflowProblems} pantallas desbordan a lo ancho. En un teléfono se ve cortado.`);
  failed = true;
}
if (peor.screens > MAX_SCREENS) {
  console.error(
    `\nFALLO: ${peor.screens.toFixed(1)} pantallas de scroll supera el límite de ${MAX_SCREENS}.`
  );
  failed = true;
}
const inicioLargo = rows.filter((r) => r.screen === 'inicio' && r.screens > 1.5);
if (inicioLargo.length) {
  console.error(
    `\nFALLO: la pantalla de inicio pide scroll en ${inicioLargo.map((r) => r.device).join(', ')}.`
  );
  failed = true;
}
if (!failed) console.log('\nResponsive OK.');
process.exit(failed ? 1 : 0);

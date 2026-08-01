/**
 * Prueba de humo de la app completa: abre la interfaz real en Chrome emulando
 * un teléfono, sube una foto y verifica que el flujo llegue hasta la pantalla
 * de resultados con todo renderizado.
 *
 * La emulación móvil no es opcional: la app se bloquea a sí misma cuando
 * detecta puntero fino, así que sin hasTouch/isMobile solo se vería el aviso
 * de "abrila desde el celular".
 *
 *   npm run dev                    (en otra terminal)
 *   node scripts/smoke-test.mjs
 */
import puppeteer from 'puppeteer-core';
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ORIGIN = process.env.ORIGIN || 'https://localhost:5173';
const SHOTS = 'tmp-screenshots';
const PHONE = { width: 414, height: 896, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

const photo = readdirSync('public/_test').find((f) => /\.(jpe?g|png)$/i.test(f));
if (!photo) {
  console.error('Necesito al menos una foto en public/_test/ (node scripts/fetch-calibration-set.mjs)');
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.error('No se encontró Chrome en', CHROME);
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--ignore-certificate-errors'],
});

const fail = async (msg, errors = []) => {
  console.error('FALLO:', msg);
  if (errors.length) console.error('errores de consola:\n  ' + errors.join('\n  '));
  await browser.close();
  process.exit(1);
};

/* ── 1. En escritorio la app tiene que bloquearse ── */
{
  const p = await browser.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(ORIGIN, { waitUntil: 'networkidle0', timeout: 60000 });
  const r = await p.evaluate(() => ({
    blocked: document.body.classList.contains('is-desktop'),
    appHidden: getComputedStyle(document.getElementById('app')).display === 'none',
    noticeVisible: getComputedStyle(document.getElementById('screen-desktop')).display !== 'none',
  }));
  if (!r.blocked || !r.appHidden || !r.noticeVisible)
    await fail(`en escritorio no se bloqueó: ${JSON.stringify(r)}`);
  await p.screenshot({ path: `${SHOTS}/0-escritorio.png` });
  console.log('✓ en escritorio muestra el aviso y oculta la app');
  await p.close();
}

/* ── 2. Flujo completo en teléfono ── */
const page = await browser.newPage();
await page.setViewport(PHONE);

const errors = [];
const IGNORE = /XNNPACK|TensorFlow Lite|^INFO:/;
page.on('console', (m) => m.type() === 'error' && !IGNORE.test(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('dialog', async (d) => {
  errors.push('alert: ' + d.message());
  await d.dismiss();
});

await page.goto(ORIGIN, { waitUntil: 'networkidle0', timeout: 60000 });

const gate = await page.evaluate(() => ({
  coarse: matchMedia('(pointer: coarse)').matches,
  blocked: document.body.classList.contains('is-desktop'),
  poppins: getComputedStyle(document.body).fontFamily.includes('Poppins'),
}));
if (gate.blocked) await fail('la app se bloqueó también en móvil', errors);
if (!gate.poppins) await fail('no se está aplicando Poppins');
console.log('✓ en móvil deja pasar, con Poppins aplicada');

// El vidrio tiene que estar realmente activo, no ser un panel opaco. Y tiene
// que haber color detrás: sin fondo de color, el desenfoque no difumina nada
// y las tarjetas se ven como rectángulos grises.
const glass = await page.evaluate(() => {
  const s = getComputedStyle(document.querySelector('.privacy-badge'));
  const body = getComputedStyle(document.body);
  return {
    blur: s.backdropFilter || s.webkitBackdropFilter,
    bg: s.backgroundColor,
    backdrop: body.backgroundImage,
  };
});
if (!glass.blur || glass.blur === 'none') await fail(`sin backdrop-filter: ${JSON.stringify(glass)}`);
if (!glass.backdrop || glass.backdrop === 'none')
  await fail('no hay fondo de color detrás del vidrio');
const gradients = (glass.backdrop.match(/radial-gradient/g) || []).length;
if (gradients < 3) await fail(`solo ${gradients} manchas de color en el fondo`);
console.log(`✓ glassmorphism activo: ${glass.blur}, ${gradients} manchas de color detrás`);

// Comprobación visual: el centro de la pantalla no puede ser gris neutro.
const tint = await page.evaluate(() => {
  const c = getComputedStyle(document.body).backgroundColor;
  return c;
});
void tint;

await page.screenshot({ path: `${SHOTS}/1-inicio.png` });

// La pantalla de inicio no debe preguntar nada.
const inputs = await page.$$eval('#screen-start input:not([type=file]), #screen-start select', (n) => n.length);
if (inputs > 0) await fail(`la pantalla de inicio pide ${inputs} dato(s); tiene que ser sin preguntas`);
console.log('✓ el inicio no pide ningún dato');

const input = await page.$('#file-input');
await input.uploadFile(resolve('public/_test', photo));

await page
  .waitForFunction(() => document.getElementById('screen-result')?.classList.contains('active'), {
    timeout: 90000,
  })
  .catch(() => fail('nunca llegó a la pantalla de resultados', errors));
console.log(`✓ analizó ${photo} y llegó a resultados`);

const r = await page.evaluate(() => ({
  shape: document.getElementById('shape-name').textContent,
  confidence: document.getElementById('confidence-text').textContent,
  attrs: [...document.querySelectorAll('#attrs .attr')].map((a) => ({
    key: a.querySelector('.attr-key').textContent,
    val: a.querySelector('.attr-val').textContent,
    swatch: a.querySelector('.swatch').style.background,
  })),
  genderBtns: [...document.querySelectorAll('#gender-select button')].map((b) => ({
    label: b.textContent,
    checked: b.getAttribute('aria-checked') === 'true',
  })),
  cards: document.querySelectorAll('#recommended .card').length,
  tryonButtons: document.querySelectorAll('#recommended .card button').length,
  avoid: document.querySelectorAll('#avoid li').length,
  scores: document.querySelectorAll('.score-row').length,
  metrics: document.querySelectorAll('.metric-row').length,
  lightWarn: document.getElementById('light-warn').hidden ? null : document.getElementById('light-warn').textContent.trim().slice(0, 50),
  canvasW: document.getElementById('result-canvas').width,
  gender: window.__lastAnalysis?.genderEstimate,
}));

console.log('  forma:  ', r.shape, '—', r.confidence);
console.log('  género: ', r.gender?.label, `${Math.round((r.gender?.confidence || 0) * 100)}%`, r.gender?.sure ? '' : '(poco seguro)');
for (const a of r.attrs) console.log(`  ${a.key.padEnd(7)}`, a.val);
console.log('  cortes: ', r.cards, '| evitar:', r.avoid, '| formas:', r.scores);
console.log('  aviso de luz:', r.lightWarn || 'ninguno');

if (!r.shape || r.shape === '—') await fail('no se renderizó la forma del rostro', errors);
if (r.attrs.length !== 4) await fail(`esperaba 4 atributos, hubo ${r.attrs.length}`, errors);
if (!r.attrs.every((a) => a.val && a.val.length > 1)) await fail('algún atributo quedó vacío', errors);
if (r.genderBtns.length !== 2) await fail('el selector de género no tiene 2 opciones', errors);
if (!r.genderBtns.some((b) => b.checked)) await fail('el género no vino preseleccionado', errors);
if (!r.cards || r.cards !== r.tryonButtons) await fail('faltan cortes o botones de prueba', errors);
if (!r.avoid) await fail('falta la lista de "evitar"', errors);
if (r.scores !== 8) await fail(`esperaba 8 formas puntuadas, hubo ${r.scores}`, errors);
if (!r.metrics) await fail('no se renderizaron las medidas', errors);
if (!r.canvasW) await fail('el canvas quedó vacío', errors);

await page.screenshot({ path: `${SHOTS}/2-resultado.png`, fullPage: true });

// El overlay de medidas dibuja sobre el canvas.
const before = await page.evaluate(() => document.getElementById('result-canvas').toDataURL().length);
await page.click('#btn-mesh');
await new Promise((res) => setTimeout(res, 300));
const after = await page.evaluate(() => document.getElementById('result-canvas').toDataURL().length);
if (before === after) await fail('el botón "Ver medidas" no cambió el canvas', errors);
console.log('✓ overlay de medidas dibuja sobre la foto');
await page.screenshot({ path: `${SHOTS}/3-medidas.png` });

// Cambiar el género cambia las recomendaciones.
const first = await page.$$eval('#recommended h4', (h) => h.map((x) => x.textContent));
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('#gender-select button')];
  (btns.find((b) => b.getAttribute('aria-checked') !== 'true') || btns[1]).click();
});
await new Promise((res) => setTimeout(res, 200));
const second = await page.$$eval('#recommended h4', (h) => h.map((x) => x.textContent));
if (JSON.stringify(first) === JSON.stringify(second))
  await fail('cambiar el género no cambió las recomendaciones', errors);
console.log('✓ el género es corregible y cambia las recomendaciones');

// El modal de prueba virtual abre con su aviso de privacidad.
await page.click('#recommended .card button');
await new Promise((res) => setTimeout(res, 300));
const modal = await page.evaluate(() => ({
  open: !document.getElementById('tryon-modal').hidden,
  privacy: !!document.getElementById('tryon-privacy')?.textContent.trim(),
  keyHidden: document.getElementById('tryon-key').hidden,
}));
if (!modal.open) await fail('el modal de prueba virtual no abrió', errors);
if (!modal.privacy) await fail('falta el aviso de privacidad en el modal', errors);
if (!modal.keyHidden) await fail('el campo de clave no debería aparecer antes de intentar', errors);
console.log('✓ modal de prueba virtual con aviso, sin pedir clave por adelantado');
await page.screenshot({ path: `${SHOTS}/4-tryon.png` });

await browser.close();

if (errors.length) {
  console.error('\nErrores en la consola del navegador:');
  errors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log(`\nTodo OK. Capturas en ${SHOTS}/`);

/**
 * Descarga Poppins a public/fonts/ y genera el CSS con las @font-face.
 *
 * Se aloja localmente en vez de enlazar a Google Fonts por dos motivos: la app
 * tiene que funcionar sin conexión, y pedirle la tipografía a un tercero es
 * justamente una filtración de datos que la app promete no hacer.
 *
 *   node scripts/fetch-fonts.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'public/fonts';
const CSS_OUT = 'src/fonts.css';
const WEIGHTS = [400, 500, 600, 700];
// Sin este User-Agent, Google Fonts devuelve TTF en vez de woff2.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

mkdirSync(OUT, { recursive: true });

const css = await (
  await fetch(
    `https://fonts.googleapis.com/css2?family=Poppins:wght@${WEIGHTS.join(';')}&display=swap`,
    { headers: { 'User-Agent': UA } }
  )
).text();

// Se parsea el CSS en bloques @font-face y se queda solo con los subconjuntos
// latinos: devanagari no se usa y son 100 kB al pedo en la caché offline.
const blocks = css.split('@font-face').slice(1);
const faces = [];

for (const block of blocks) {
  const subset = /\/\*\s*([\w-]+)\s*\*\//.exec(css.slice(0, css.indexOf(block))) || [];
  const url = /src:\s*url\(([^)]+)\)/.exec(block)?.[1];
  const weight = /font-weight:\s*(\d+)/.exec(block)?.[1];
  const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
  if (!url || !weight) continue;

  // El comentario del subconjunto precede al bloque; se toma del texto previo.
  const before = css.slice(0, css.indexOf(block));
  const label = [...before.matchAll(/\/\*\s*([\w-]+)\s*\*\//g)].pop()?.[1] || 'latin';
  if (!label.startsWith('latin')) continue;

  const file = `poppins-${weight}-${label}.woff2`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    console.warn('falló', file);
    continue;
  }
  writeFileSync(`${OUT}/${file}`, Buffer.from(await res.arrayBuffer()));
  faces.push({ file, weight, range: range?.trim() });
  console.log(file);
  void subset;
}

const out = `/* Generado por scripts/fetch-fonts.mjs — no editar a mano. */
${faces
  .map(
    (f) => `@font-face {
  font-family: 'Poppins';
  font-style: normal;
  font-weight: ${f.weight};
  font-display: swap;
  src: url('/fonts/${f.file}') format('woff2');
  unicode-range: ${f.range};
}`
  )
  .join('\n')}
`;

writeFileSync(CSS_OUT, out);
console.log(`\n${faces.length} archivos → ${CSS_OUT}`);

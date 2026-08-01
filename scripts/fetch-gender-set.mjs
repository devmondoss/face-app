/**
 * Baja un set de retratos ETIQUETADOS por género desde Wikidata, a
 * public/_gender/{hombre,mujer}/.
 *
 * Sin etiquetas no se puede saber si el clasificador de género funciona: se
 * puede escribir una heurística que suene razonable y que acierte al 55%. Con
 * este set, scripts/gender-eval.mjs mide la precisión de verdad.
 *
 * Dos cosas medidas que hacen que esto tarde minutos y no horas
 * (ver scripts/probe-throughput.mjs):
 *
 *  1. El User-Agent tiene que cumplir la política de Wikimedia — nombre,
 *     versión y un contacto. Sin contacto rechazan la mitad de los pedidos
 *     con 429; con contacto, ninguno.
 *  2. La concurrencia óptima es 3–4. Con 8 en paralelo el servidor rechaza
 *     el 90% y el rendimiento cae por debajo del secuencial.
 *
 *   node scripts/fetch-gender-set.mjs
 *   PER_CLASS=500 node scripts/fetch-gender-set.mjs
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const UA = 'faceapp-calibration/1.0 (https://github.com/devmondoss/face-app)';
const PER_CLASS = Number(process.env.PER_CLASS || 500);
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);

/**
 * Se piden muchos más candidatos que el objetivo porque una parte se cae en
 * el camino: fotos sin cara detectable, de perfil, grupales o de estatuas.
 *
 * Ocupaciones variadas y de varios países a propósito. La muestra anterior
 * era toda de políticos estadounidenses en retrato de estudio, o sea una
 * distribución muy angosta: el clasificador tiene que funcionar con selfies
 * de teléfono, no solo con fotos oficiales. El filtro por año de nacimiento
 * evita mezclar retratos modernos con fotos en blanco y negro de otra época.
 */
const OCCUPATIONS = [
  'wd:Q82955', // político
  'wd:Q33999', // actor
  'wd:Q2066131', // deportista
  'wd:Q901', // científico
  'wd:Q177220', // cantante
  'wd:Q1930187', // periodista
  'wd:Q36180', // escritor
];

const GENDERS = { mujer: 'wd:Q6581072', hombre: 'wd:Q6581097' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(genderId, limit) {
  const query = `
    SELECT ?person ?image WHERE {
      ?person wdt:P31 wd:Q5 ;
              wdt:P18 ?image ;
              wdt:P21 ${genderId} ;
              wdt:P569 ?dob ;
              wdt:P106 ?occ .
      VALUES ?occ { ${OCCUPATIONS.join(' ')} }
      FILTER(YEAR(?dob) > 1960)
    }
    LIMIT ${limit}`;

  const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query), {
    headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
  });
  if (!res.ok) throw new Error(`SPARQL ${res.status}`);
  return (await res.json()).results.bindings.map((r) => r.image.value);
}

async function download(url, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status !== 429) return null;
    } catch {
      /* corte de red puntual: se reintenta igual que un 429 */
    }
    await sleep(1200 * (i + 1));
  }
  return null;
}

/**
 * El nombre se trunca a 44 caracteres y se le pega un hash corto de la URL
 * completa. Sin el hash colisionaban el 24% de los archivos: muchos nombres
 * de Wikimedia comparten un prefijo largo ("File:Official portrait of…") y se
 * sobrescribían entre sí. El contador decía 502 descargas y en disco había 382.
 */
const slug = (url) => {
  const base = decodeURIComponent(url.split('/').pop().split('?')[0])
    .replace(/\.[a-z]+$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .slice(0, 44);
  return `${base}-${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;
};

/** Nombre viejo, sin hash: se sigue reconociendo para no rebajar lo ya bajado. */
const slugLegacy = (url) =>
  decodeURIComponent(url.split('/').pop().split('?')[0])
    .replace(/\.[a-z]+$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .slice(0, 50);

const DIR = { hombre: 'public/_gender/hombre', mujer: 'public/_gender/mujer' };
for (const d of Object.values(DIR)) mkdirSync(d, { recursive: true });

console.log(`objetivo: ${PER_CLASS} por clase, ${CONCURRENCY} descargas en paralelo\n`);

for (const [label, genderId] of Object.entries(GENDERS)) {
  const dir = DIR[label];
  const yaTengo = readdirSync(dir).filter((f) => /\.jpg$/i.test(f)).length;
  if (yaTengo >= PER_CLASS) {
    console.log(`${label}: ya hay ${yaTengo}, se saltea`);
    continue;
  }

  // Se pide el doble del objetivo: bastantes fotos no sirven.
  const urls = await sparql(genderId, PER_CLASS * 2);
  console.log(`${label}: ${urls.length} candidatos de Wikidata (${yaTengo} ya en disco)`);

  const queue = urls.filter(
    (u) => !existsSync(`${dir}/${slug(u)}.jpg`) && !existsSync(`${dir}/${slugLegacy(u)}.jpg`)
  );
  let bajadas = yaTengo;
  let fallos = 0;
  const t0 = Date.now();

  const worker = async () => {
    while (queue.length && bajadas < PER_CLASS) {
      const url = queue.shift();
      const buf = await download(url + '?width=600');
      if (buf && buf.length > 8000) {
        writeFileSync(`${dir}/${slug(url)}.jpg`, buf);
        // Se cuenta lo que hay en disco, no los intentos: con el bug del slug
        // el contador iba muy por delante de la realidad.
        bajadas = readdirSync(dir).filter((f) => /\.jpg$/i.test(f)).length;
        if (bajadas % 50 === 0) {
          const porMin = (bajadas - yaTengo) / ((Date.now() - t0) / 60000);
          console.log(`  ${bajadas}/${PER_CLASS}  (${porMin.toFixed(0)} img/min)`);
        }
      } else {
        fallos++;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const mins = (Date.now() - t0) / 60000;
  console.log(`${label}: ${bajadas} fotos, ${fallos} fallidas, ${mins.toFixed(1)} min\n`);
}

for (const [label, dir] of Object.entries(DIR))
  console.log(`${label}: ${readdirSync(dir).filter((f) => /\.jpg$/i.test(f)).length} archivos en ${dir}`);

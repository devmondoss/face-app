/**
 * Baja un set de retratos ETIQUETADOS por género desde Wikidata, a
 * public/_gender/{hombre,mujer}/.
 *
 * Sin etiquetas no se puede saber si el clasificador de género funciona: se
 * puede escribir una heurística que suene razonable y que acierte al 55%. Con
 * este set, scripts/gender-eval.mjs mide la precisión de verdad.
 *
 *   node scripts/fetch-gender-set.mjs
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const UA = 'faceapp-calibration/1.0 (local dev tool)';
const PER_CLASS = Number(process.env.PER_CLASS || 70);

// Miembros del Congreso de EE.UU., senadores y astronautas: retratos oficiales
// frontales, de dominio público y con género declarado en Wikidata.
//
// El filtro por año de nacimiento NO es cosmético. Sin él, la consulta devuelve
// hombres del Congreso actual (retratos en color, modernos) y mujeres de los
// años 40 (blanco y negro, de otra época fotográfica). Un clasificador ajustado
// sobre eso aprende "foto vieja = mujer" en vez de aprender rasgos del rostro.
const SPARQL = `
SELECT ?person ?genderLabel ?image WHERE {
  ?person wdt:P31 wd:Q5 ;
          wdt:P18 ?image ;
          wdt:P21 ?gender ;
          wdt:P569 ?dob .
  { ?person wdt:P39 wd:Q13218630 }
  UNION { ?person wdt:P39 wd:Q4416090 }
  UNION { ?person wdt:P106 wd:Q11631 }
  VALUES ?gender { wd:Q6581097 wd:Q6581072 }
  FILTER(YEAR(?dob) > 1955)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 900`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// upload.wikimedia.org tira 429 con facilidad; conviene ir despacio y
// reintentar en vez de perder la mitad de la muestra.
async function download(url, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 429) return null;
    await sleep(2500 * (i + 1));
  }
  return null;
}

console.log('consultando Wikidata…');
const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(SPARQL), {
  headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
});
if (!res.ok) {
  console.error('SPARQL falló:', res.status);
  process.exit(1);
}
const rows = (await res.json()).results.bindings;
console.log(`${rows.length} personas con imagen y género declarado`);

const byGender = { male: [], female: [] };
for (const r of rows) {
  const g = r.genderLabel?.value;
  if (g === 'male' || g === 'female') byGender[g].push(r);
}
console.log(`  male ${byGender.male.length} / female ${byGender.female.length}`);

const DIR = { male: 'public/_gender/hombre', female: 'public/_gender/mujer' };
for (const d of Object.values(DIR)) mkdirSync(d, { recursive: true });

// Se alternan las dos clases en vez de terminar una y después la otra. Con el
// rate limiting de Wikimedia, hacerlo secuencial significa que si el proceso
// se corta antes de tiempo queda un set con una sola clase, que no sirve para
// medir nada.
const queues = { male: [...byGender.male], female: [...byGender.female] };
const have = { male: readdirSync(DIR.male).length, female: readdirSync(DIR.female).length };

let progress = true;
while (progress && (have.male < PER_CLASS || have.female < PER_CLASS)) {
  progress = false;
  for (const gender of ['female', 'male']) {
    if (have[gender] >= PER_CLASS || !queues[gender].length) continue;
    const row = queues[gender].shift();
    progress = true;

    // P18 devuelve la URL del original; Special:FilePath acepta ?width para
    // pedir una miniatura y no bajar archivos de 10 MB.
    const url = row.image.value + '?width=700';
    const name = decodeURIComponent(url.split('/').pop().split('?')[0])
      .replace(/\.[a-z]+$/i, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .slice(0, 44);
    const path = `${DIR[gender]}/${name}.jpg`;
    if (existsSync(path)) continue;

    const buf = await download(url);
    if (buf && buf.length > 5000) {
      writeFileSync(path, buf);
      have[gender]++;
      if ((have.male + have.female) % 10 === 0)
        console.log(`  ${have.male} hombres / ${have.female} mujeres`);
    }
    await sleep(900);
  }
}
console.log(`listo: ${have.male} hombres / ${have.female} mujeres`);

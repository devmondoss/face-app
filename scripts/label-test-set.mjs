/**
 * Etiqueta por género las fotos que YA están en public/_test, consultando
 * Wikidata a partir del nombre que viene en el nombre de archivo.
 *
 * Por qué así: bajar un set nuevo de imágenes desde Wikimedia es lentísimo por
 * el rate limiting de upload.wikimedia.org. Las fotos ya descargadas son
 * retratos oficiales cuyo nombre de archivo trae el nombre de la persona, y la
 * API de Wikidata (que no está limitada igual) puede decir el género. Se
 * reaprovecha lo que ya está en disco en vez de volver a pelear con el 429.
 *
 * Escribe public/_gender/labels.json → { "archivo.jpg": "hombre" | "mujer" }
 *
 *   node scripts/label-test-set.mjs
 */
import { readdirSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const UA = 'faceapp-calibration/1.0 (local dev tool)';
const API = 'https://www.wikidata.org/w/api.php';
const OUT = 'public/_gender/labels.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Saca el nombre de la persona del nombre de archivo del retrato oficial. */
function nameFromFile(file) {
  const stop = /^(official|portrait|congress|\d+th|\d+|us|senate|house|nasa|astronaut|photo|cropped|jpg|jpeg|png)$/i;
  const honorific = /^(sen|senator|rep|representative|dr|mr|mrs|ms|gov|governor)$/i;

  const tokens = file
    .replace(/\.[a-z]+$/i, '')
    .split('-')
    .filter(Boolean);

  const out = [];
  for (const t of tokens) {
    if (stop.test(t)) break; // a partir de acá empieza el "official portrait…"
    if (honorific.test(t) && out.length === 0) continue;
    // Los retratos suelen terminar en "-d-az" o "-r-tx" (partido y estado).
    // Son tokens de 1–2 letras y ensucian la búsqueda: "mark kelly d az" no
    // encuentra a nadie, "mark kelly" sí.
    if (t.length <= 2 && out.length >= 2) break;
    out.push(t);
  }
  return out.join(' ').trim();
}

/**
 * La API de Wikidata responde el límite de tasa con texto plano ("You are
 * making too many requests"), no con JSON ni con un 429. Si se hace
 * res.json() a ciegas, el error de parseo cae en el catch de arriba y se
 * cuenta como "no se encontró la persona": así la primera versión reportó 53
 * fotos sin resolver cuando en realidad estaba rebotando contra el límite.
 */
async function api(params, attempts = 4) {
  const url = `${API}?${new URLSearchParams({ format: 'json', maxlag: '5', ...params })}`;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const text = await res.text();
    if (res.ok && text.startsWith('{')) {
      const json = JSON.parse(text);
      if (!json.error) return json;
      if (json.error.code !== 'maxlag') throw new Error(json.error.code);
    }
    await sleep(2500 * (i + 1));
  }
  throw new Error('límite de tasa');
}

/** Busca la persona y devuelve su género solo si la entidad es un humano. */
async function genderOf(name) {
  const search = await api({
    action: 'wbsearchentities',
    search: name,
    language: 'en',
    type: 'item',
    limit: '5',
  });
  const ids = (search.search || []).map((s) => s.id);
  if (!ids.length) return null;

  const ents = await api({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims' });
  for (const id of ids) {
    const claims = ents.entities?.[id]?.claims;
    if (!claims) continue;
    // P31 = instancia de; Q5 = ser humano. Sin este chequeo se pueden colar
    // ciudades, canciones o empresas que comparten nombre con alguien.
    const isHuman = (claims.P31 || []).some((c) => c.mainsnak?.datavalue?.value?.id === 'Q5');
    if (!isHuman) continue;
    const g = claims.P21?.[0]?.mainsnak?.datavalue?.value?.id;
    if (g === 'Q6581097') return 'hombre';
    if (g === 'Q6581072') return 'mujer';
    return null; // humano, pero con género no binario o no declarado
  }
  return null;
}

const files = readdirSync('public/_test').filter((f) => /\.(jpe?g|png)$/i.test(f));
mkdirSync('public/_gender', { recursive: true });

const labels = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
let nuevos = 0;
let sinResolver = 0;

for (const f of files) {
  if (labels[f]) continue;
  const name = nameFromFile(f);
  if (name.split(' ').length < 2) {
    sinResolver++;
    continue;
  }
  try {
    const g = await genderOf(name);
    if (g) {
      labels[f] = g;
      nuevos++;
    } else {
      console.log(`  sin género: "${name}"`);
      sinResolver++;
    }
  } catch (err) {
    console.log(`  falló "${name}": ${err.message}`);
    sinResolver++;
  }
  await sleep(900);
}

writeFileSync(OUT, JSON.stringify(labels, null, 2));

const counts = Object.values(labels).reduce((a, g) => ((a[g] = (a[g] || 0) + 1), a), {});
console.log(`${nuevos} etiquetas nuevas, ${sinResolver} sin resolver`);
console.log(`total: ${counts.hombre || 0} hombres / ${counts.mujer || 0} mujeres → ${OUT}`);

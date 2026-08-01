/**
 * Mide cuántas imágenes por minuto deja bajar Wikimedia con distintos
 * User-Agent y niveles de concurrencia.
 *
 * Wikimedia rechaza con 429 a los clientes que no cumplen su política de
 * User-Agent (piden nombre, versión y un contacto). Antes de encarar una
 * descarga de cientos de fotos conviene saber si el cuello de botella es la
 * política o el volumen: la diferencia es entre horas y minutos.
 */

const CANDIDATES = {
  'sin contacto': 'faceapp-calibration/1.0 (local dev tool)',
  'con contacto': 'faceapp-calibration/1.0 (https://github.com/devmondoss/face-app)',
};

const SPARQL = `
SELECT ?image WHERE {
  ?p wdt:P31 wd:Q5 ; wdt:P18 ?image ; wdt:P21 wd:Q6581072 ; wdt:P569 ?dob .
  ?p wdt:P106 wd:Q82955 .
  FILTER(YEAR(?dob) > 1960)
} LIMIT 60`;

const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(SPARQL), {
  headers: { 'User-Agent': CANDIDATES['con contacto'], Accept: 'application/sparql-results+json' },
});
const urls = (await res.json()).results.bindings.map((r) => r.image.value + '?width=500');
console.log(`${urls.length} URLs de prueba\n`);

async function trial(label, ua, concurrency, slice) {
  const t0 = Date.now();
  let ok = 0;
  let rate429 = 0;
  let other = 0;

  const queue = [...slice];
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const r = await fetch(url, { headers: { 'User-Agent': ua } });
        if (r.ok) {
          await r.arrayBuffer();
          ok++;
        } else if (r.status === 429) rate429++;
        else other++;
      } catch {
        other++;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const secs = (Date.now() - t0) / 1000;
  console.log(
    `${label.padEnd(28)} ${String(ok).padStart(2)}/${slice.length} ok, ${rate429} rechazos, ${other} otros  ` +
      `— ${secs.toFixed(1)}s → ${((ok / secs) * 60).toFixed(0)} img/min`
  );
  return (ok / secs) * 60;
}

// Cada prueba usa URLs distintas para que no responda la caché.
await trial('sin contacto, secuencial', CANDIDATES['sin contacto'], 1, urls.slice(0, 12));
await trial('con contacto, secuencial', CANDIDATES['con contacto'], 1, urls.slice(12, 24));
await trial('con contacto, 4 en paralelo', CANDIDATES['con contacto'], 4, urls.slice(24, 40));
await trial('con contacto, 8 en paralelo', CANDIDATES['con contacto'], 8, urls.slice(40, 60));

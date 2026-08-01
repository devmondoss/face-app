/**
 * Clasificación de la forma del rostro.
 *
 * Idea central: las categorías de forma de rostro son RELATIVAS. "Cara larga"
 * significa más larga que el promedio, no "largo/ancho mayor a 1,6". Y qué
 * cuenta como promedio depende de con qué puntos se mida — los landmarks de
 * MediaPipe no miden lo mismo que una cinta métrica sobre la cabeza.
 *
 * Por eso cada proporción se convierte primero a z-score (cuántos desvíos
 * estándar se aleja del promedio) usando NORM, y recién ahí se compara contra
 * los prototipos, que están definidos también en z-scores. Sin este paso la
 * clasificación se rompe: con umbrales absolutos inventados, todas las caras
 * medidas caían en la misma categoría.
 *
 * NORM sale de medir retratos frontales reales con estos mismos landmarks.
 * Para regenerarlo: `node scripts/calibrate.mjs` (ver README).
 */

// ── Distribución medida sobre la muestra de calibración ──────────────────
// Generado por scripts/calibrate.mjs. No editar a mano.
const NORM = {
  lengthOverWidth: { mean: 1.188, sd: 0.047 },
  jawOverCheek: { mean: 0.818, sd: 0.016 },
  foreheadOverCheek: { mean: 0.84, sd: 0.023 },
  chinAngle: { mean: 106.09, sd: 5.723 },
  foreheadHeightRatio: { mean: 0.201, sd: 0.016 },
  jawOverForehead: { mean: 0.974, sd: 0.04 },
  // Rasgos dimórficos, usados por src/gender.js.
  browGapRatio: { mean: 0.112, sd: 0.017 },
  lipHeightRatio: { mean: 0.123, sd: 0.035 },
  noseWidthRatio: { mean: 0.284, sd: 0.019 },
};

/**
 * Cada forma es un punto en el espacio de z-scores. Los valores codifican la
 * definición de cada forma: "cuadrado" = mandíbula y frente anchas respecto
 * del promedio, cara corta y mentón poco afilado; "corazón" = frente ancha,
 * mandíbula angosta y mentón en punta; etc.
 */
const PROTOTYPES = {
  ovalado: {
    label: 'Ovalado',
    z: { lengthOverWidth: 0.35, jawOverCheek: -0.25, foreheadOverCheek: 0.1, chinAngle: -0.15 },
    blurb:
      'Largo algo mayor que el ancho, frente apenas más ancha que la mandíbula y mentón redondeado. Es la forma más equilibrada: casi todo le queda bien.',
  },
  redondo: {
    label: 'Redondo',
    z: { lengthOverWidth: -1.3, jawOverCheek: 0.2, foreheadOverCheek: 0.15, chinAngle: 0.7 },
    blurb:
      'Ancho y largo casi iguales, con pómulos anchos y mandíbula suave, sin ángulos marcados. La idea es estilizar: sumar altura y quitar volumen a los costados.',
  },
  cuadrado: {
    label: 'Cuadrado',
    z: { lengthOverWidth: -0.75, jawOverCheek: 1.35, foreheadOverCheek: 0.9, chinAngle: 1.25 },
    blurb:
      'Frente, pómulos y mandíbula miden casi lo mismo, con el ángulo de la mandíbula bien marcado. Rostro fuerte: conviene suavizar o, si te gusta, remarcarlo.',
  },
  alargado: {
    label: 'Alargado',
    z: { lengthOverWidth: 1.7, jawOverCheek: -0.1, foreheadOverCheek: 0.1, chinAngle: -0.1 },
    blurb:
      'Bastante más largo que ancho, con anchos parejos de arriba a abajo. Acá el objetivo es el contrario al redondo: sumar ancho y no sumar altura.',
  },
  rectangular: {
    label: 'Rectangular',
    z: { lengthOverWidth: 1.5, jawOverCheek: 1.2, foreheadOverCheek: 0.85, chinAngle: 1.1 },
    blurb:
      'Larga como la alargada, pero con la mandíbula marcada y los anchos parejos de arriba a abajo. Hay que hacer dos cosas a la vez: sumar ancho y suavizar los ángulos.',
  },
  corazon: {
    label: 'Corazón',
    z: { lengthOverWidth: 0.35, jawOverCheek: -1.35, foreheadOverCheek: 0.95, chinAngle: -1.15 },
    blurb:
      'Frente ancha que va afinando hasta un mentón angosto o en punta. Se trata de equilibrar: menos volumen arriba, más a la altura de la mandíbula.',
  },
  diamante: {
    label: 'Diamante',
    z: { lengthOverWidth: 0.8, jawOverCheek: -1.05, foreheadOverCheek: -1.35, chinAngle: -0.85 },
    blurb:
      'Pómulos claramente como punto más ancho, con frente angosta y mentón en punta. Conviene dar ancho arriba y abajo, y no marcar los pómulos.',
  },
  triangular: {
    label: 'Triangular',
    z: { lengthOverWidth: 0.0, jawOverCheek: 1.25, foreheadOverCheek: -1.25, chinAngle: 0.45 },
    blurb:
      'Mandíbula más ancha que la frente. La estrategia es sumar volumen arriba, en la zona de la coronilla y las sienes, para compensar.',
  },
};

/**
 * Cuánto pesa cada rasgo. El largo y el ancho de mandíbula son los que más
 * definen la forma percibida; el ángulo del mentón es el más ruidoso de medir
 * (depende de barba, papada y sombras), así que pesa menos.
 */
const WEIGHTS = {
  lengthOverWidth: 1.6,
  jawOverCheek: 1.3,
  foreheadOverCheek: 1.1,
  chinAngle: 0.6,
};

const FEATURES = Object.keys(WEIGHTS);

/** Pasa las proporciones crudas a desvíos estándar respecto del promedio. */
export function toZScores(ratios) {
  const z = {};
  for (const k of Object.keys(NORM)) {
    if (typeof ratios[k] === 'number') z[k] = (ratios[k] - NORM[k].mean) / NORM[k].sd;
  }
  return z;
}

export function classifyFaceShape(ratios) {
  const z = toZScores(ratios);

  const scored = Object.entries(PROTOTYPES).map(([key, proto]) => {
    let sumSq = 0;
    let sumW = 0;
    for (const f of FEATURES) {
      const d = z[f] - proto.z[f];
      sumSq += WEIGHTS[f] * d * d;
      sumW += WEIGHTS[f];
    }
    return { key, label: proto.label, blurb: proto.blurb, distance: Math.sqrt(sumSq / sumW) };
  });

  scored.sort((a, b) => a.distance - b.distance);

  // Softmax sobre -distancia² para pasar de distancias a algo interpretable
  // como confianza. T controla qué tan tajante es el veredicto: se eligió
  // barriendo valores contra la muestra de calibración (scripts/calibrate.mjs).
  // Con T=0.45 la confianza del ganador queda en una mediana del 54% y ~1 de
  // cada 5 caras se marca como mixta. Con T más alto todo daba ~26% y casi
  // todas las caras salían "mixtas", que no le sirve a nadie.
  const T = 0.45;
  const exps = scored.map((s) => Math.exp(-(s.distance * s.distance) / (2 * T * T)));
  const total = exps.reduce((a, b) => a + b, 0) || 1;
  scored.forEach((s, i) => {
    s.confidence = exps[i] / total;
  });

  const [best, second] = scored;
  return {
    best,
    second,
    all: scored,
    zScores: z,
    // Si el segundo lugar pisa los talones al primero, la cara es mixta y
    // decirlo es más útil que fingir un veredicto único.
    isMixed: second && best.confidence - second.confidence < 0.12,
  };
}

/**
 * Rasgos secundarios que cambian la recomendación aunque la forma sea la misma
 * (por ejemplo: frente alta => flequillo; mandíbula muy marcada => barba).
 */
export function describeFeatures(ratios) {
  const z = toZScores(ratios);
  const notes = [];

  if (z.foreheadHeightRatio > 1)
    notes.push({
      key: 'frenteAlta',
      text: 'Frente alta: un flequillo o unos mechones sueltos al frente la acortan visualmente.',
    });
  if (z.foreheadHeightRatio < -1)
    notes.push({
      key: 'frenteBaja',
      text: 'Frente baja: mejor evitar el flequillo tupido, tapa demasiado y achica la cara.',
    });
  if (z.chinAngle > 1)
    notes.push({
      key: 'mandibulaMarcada',
      text: 'Mandíbula marcada: te banca cortes cortos y definidos sin perder proporción.',
    });
  if (z.chinAngle < -1)
    notes.push({
      key: 'mentonEnPunta',
      text: 'Mentón en punta: el largo a la altura de la mandíbula ayuda a redondearlo.',
    });
  if (z.jawOverForehead > 1)
    notes.push({
      key: 'baseAncha',
      text: 'La mandíbula es más ancha que la frente: sumá volumen arriba y restale a los costados de abajo.',
    });
  if (z.jawOverForehead < -1)
    notes.push({
      key: 'baseAngosta',
      text: 'La frente domina sobre la mandíbula: buscá volumen a la altura del mentón, no en la coronilla.',
    });

  return notes;
}

export { PROTOTYPES, NORM };

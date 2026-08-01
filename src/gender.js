/**
 * Estimación del género a partir de la geometría del rostro.
 *
 * ADVERTENCIA HONESTA, que la interfaz también refleja: esto no es un dato, es
 * una estimación. Ninguna medida de la cara determina el género de nadie, y hay
 * muchísima superposición entre poblaciones. Por eso el resultado se usa
 * únicamente para PRESELECCIONAR qué set de recomendaciones mostrar, y la app
 * deja cambiarlo con un toque. Nunca se le dice al usuario "sos un hombre":
 * se le dice "recomendaciones para", con el botón ya elegido.
 *
 * Los rasgos usados tienen dimorfismo sexual documentado (mandíbula más ancha,
 * mentón menos afilado, ceja más baja, labio más fino, nariz más ancha en
 * promedio en hombres). Los pesos y el sesgo salen de medir un set etiquetado
 * de Wikidata — ver scripts/gender-eval.mjs y el README.
 */

import { toZScores } from './faceShape.js';

/**
 * Peso positivo = el rasgo empuja hacia "hombre".
 *
 * Ajustados con scripts/gender-eval.mjs sobre 71 retratos etiquetados.
 * Precisión balanceada medida con validación cruzada: **66,5%**. O sea,
 * bastante mejor que tirar una moneda (50%) y bastante peor que un dato.
 * Alrededor de 1 de cada 3 personas recibe la preselección equivocada, y por
 * eso la interfaz siempre invita a corregirla con un toque.
 *
 * Dato interesante que salió de medir: la intuición de "mandíbula ancha y
 * mentón cuadrado = hombre" NO se sostiene con estos landmarks — la separación
 * medida iba en la dirección contraria. Toda la señal útil está en el grosor
 * del labio y en la separación ceja–ojo. Los pesos de mandíbula, mentón,
 * nariz y largo quedaron casi en cero justamente por eso.
 */
export const GENDER_WEIGHTS = {
  jawOverCheek: -0.1,
  chinAngle: 0.1,
  browGapRatio: -0.4,
  lipHeightRatio: -0.9,
  noseWidthRatio: 0.1,
  lengthOverWidth: 0.0,
};

/** Corrimiento del umbral. Se ajusta con el set etiquetado. */
export const GENDER_BIAS = 0;

export function genderScore(ratios, weights = GENDER_WEIGHTS, bias = GENDER_BIAS) {
  const z = toZScores(ratios);
  let s = bias;
  for (const [k, w] of Object.entries(weights)) {
    if (typeof z[k] === 'number') s += w * z[k];
  }
  return s;
}

/**
 * @returns {{key:'hombre'|'mujer', label:string, confidence:number, score:number, sure:boolean}}
 */
export function estimateGender(ratios, weights = GENDER_WEIGHTS, bias = GENDER_BIAS) {
  const score = genderScore(ratios, weights, bias);
  // Logística sobre el score: da una probabilidad interpretable en vez de un
  // sí/no seco. El divisor amortigua la pendiente para que no dé 99% siempre.
  const p = 1 / (1 + Math.exp(-score / 1.35));
  const isMale = p >= 0.5;
  return {
    key: isMale ? 'hombre' : 'mujer',
    label: isMale ? 'Hombre' : 'Mujer',
    confidence: isMale ? p : 1 - p,
    score,
    // Umbral ancho a propósito. Con 66,5% de precisión real, presentar la
    // estimación como resuelta sería mentir: solo se considera "segura"
    // cuando el margen es grande de verdad.
    sure: Math.abs(p - 0.5) > 0.3,
  };
}

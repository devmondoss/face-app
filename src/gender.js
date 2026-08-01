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
 * Son los coeficientes de una regresión logística ajustada con
 * scripts/gender-eval.mjs sobre 756 rostros etiquetados desde Wikidata
 * (395 hombres / 361 mujeres), de varias ocupaciones y países.
 *
 * Precisión balanceada con validación cruzada en 5 pliegues: **76,1%**
 * (75% en hombres, 77% en mujeres, ±4,4 puntos). Mejor que tirar una moneda,
 * lejos de ser un dato: 1 de cada 4 personas recibe la preselección
 * equivocada, y por eso la interfaz siempre invita a corregirla con un toque.
 *
 * Los rasgos que más separan son la separación ceja–ojo y el grosor del labio,
 * ambos más grandes en mujeres.
 *
 * Corrección respecto de una versión anterior: con una muestra de 71 caras,
 * todas de políticos estadounidenses, el ancho de mandíbula parecía separar en
 * la dirección CONTRARIA a lo esperado. Con 756 caras y fuentes variadas se
 * ordena como dice la literatura (mandíbula más ancha en hombres). Era ruido
 * de muestra chica y homogénea, no un hallazgo.
 */
export const GENDER_WEIGHTS = {
  jawOverCheek: 0.28,
  chinAngle: 0.297,
  browGapRatio: -0.976,
  lipHeightRatio: -0.705,
  noseWidthRatio: 0.261,
  lengthOverWidth: -0.169,
  foreheadOverCheek: 0.488,
  foreheadHeightRatio: -0.53,
  jawOverForehead: -0.21,
};

/** Corrimiento del umbral, ajustado junto con los pesos. */
export const GENDER_BIAS = 0.372;

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
  // Los pesos vienen de una regresión logística, así que el score YA es un
  // logit: la sigmoide lo convierte en probabilidad calibrada sin dividir por
  // nada. Dividir (como hacía la versión con pesos elegidos a mano) achataría
  // la escala y haría que todas las estimaciones parecieran dudosas.
  const p = 1 / (1 + Math.exp(-score));
  const isMale = p >= 0.5;
  return {
    key: isMale ? 'hombre' : 'mujer',
    label: isMale ? 'Hombre' : 'Mujer',
    confidence: isMale ? p : 1 - p,
    score,
    // Con 76% de precisión real, la estimación se considera "segura" solo
    // cuando la probabilidad se despega bastante del empate. Aun así la
    // interfaz sigue ofreciendo cambiarla: 1 de cada 4 sigue saliendo mal.
    sure: Math.abs(p - 0.5) > 0.25,
  };
}

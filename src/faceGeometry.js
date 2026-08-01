/**
 * Medición geométrica del rostro a partir de los 478 landmarks del
 * Face Landmarker de MediaPipe.
 *
 * Todo se calcula en píxeles reales (no en coordenadas normalizadas),
 * porque las coordenadas normalizadas están deformadas cuando la imagen
 * no es cuadrada y arruinarían cualquier proporción.
 */

// Índices del face mesh canónico de MediaPipe.
export const LM = {
  foreheadTop: 10, // centro del nacimiento del pelo
  glabella: 9, // entrecejo
  chin: 152, // punta del mentón
  noseTip: 1,
  cheekL: 234, // pómulo izquierdo (punto más ancho, bizigomático)
  cheekR: 454,
  jawL: 172, // gonion izquierdo (ancho de mandíbula, bigonial)
  jawR: 397,
  templeL: 54, // sien izquierda (ancho de frente, bitemporal)
  templeR: 284,
  jawCornerL: 58, // esquina de la mandíbula, para el ángulo del mentón
  jawCornerR: 288,
  eyeOuterL: 33,
  eyeOuterR: 263,
  eyeInnerL: 133,
  eyeInnerR: 362,
  browL: 105,
  browR: 334,
  // Rasgos con dimorfismo sexual conocido, usados para estimar el género.
  eyeTopL: 159, // párpado superior izquierdo
  eyeTopR: 386,
  lipTopOuter: 0,
  lipBottomOuter: 17,
  alarL: 48, // ala de la nariz
  alarR: 278,
};

const RAD2DEG = 180 / Math.PI;

/** Pasa un landmark normalizado a píxeles de la imagen. */
function toPx(lm, w, h) {
  return { x: lm.x * w, y: lm.y * h };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Ángulo en grados del vértice `v`, entre los rayos hacia `a` y `b`. */
function angleAt(v, a, b) {
  const v1 = { x: a.x - v.x, y: a.y - v.y };
  const v2 = { x: b.x - v.x, y: b.y - v.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (mag === 0) return 0;
  return Math.acos(Math.min(1, Math.max(-1, dot / mag))) * RAD2DEG;
}

/**
 * Rota todos los puntos para que la línea de los ojos quede horizontal.
 * Sin esto, una cabeza inclinada mide "más larga y más angosta" de lo que es.
 */
function deroll(points, rollRad) {
  const cx = (points[LM.eyeOuterL].x + points[LM.eyeOuterR].x) / 2;
  const cy = (points[LM.eyeOuterL].y + points[LM.eyeOuterR].y) / 2;
  const cos = Math.cos(-rollRad);
  const sin = Math.sin(-rollRad);
  return points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
}

/**
 * Pose de la cabeza.
 *
 * El roll sale de la línea de los ojos: es exacto y no depende de nada más.
 * El yaw y el pitch salen de la matriz de transformación facial de MediaPipe
 * (4x4, column-major estilo OpenGL). Para el yaw además calculamos un segundo
 * estimador puramente geométrico y nos quedamos con el más pesimista de los
 * dos, así el aviso de "girá la cara al frente" nunca se queda corto.
 */
export function estimatePose(pointsPx, matrix) {
  const eL = pointsPx[LM.eyeOuterL];
  const eR = pointsPx[LM.eyeOuterR];
  const rollRad = Math.atan2(eR.y - eL.y, eR.x - eL.x);

  let yaw = 0;
  let pitch = 0;
  if (matrix && matrix.length >= 11) {
    const d = matrix;
    // La matriz viene ROW-major: R[fila][col] = d[fila*4 + col].
    // Verificado con scripts/matrix-probe.mjs: leyéndola así, rotar la imagen
    // cambia solo el roll y deja yaw y pitch quietos, que es lo correcto.
    // Con la lectura column-major el roll salía con el signo cambiado y una
    // simple inclinación de cabeza se reportaba como "cara girada".
    const r02 = d[2];
    const r12 = d[6];
    const r22 = d[10];
    yaw = Math.atan2(r02, r22) * RAD2DEG;
    pitch = Math.atan2(-r12, Math.hypot(r02, r22)) * RAD2DEG;
  }

  // Hubo acá un segundo estimador de yaw basado en cuánto se corría la nariz
  // respecto del centro entre los pómulos. Se sacó: los landmarks 234/454 no
  // son simétricos respecto de la nariz en todas las caras, así que arrastraba
  // un sesgo constante de más de 10° y, combinado tomando el mayor de los dos,
  // hacía que casi cualquier foto disparara el aviso de "cara girada".
  // El de la matriz está verificado contra rotaciones controladas
  // (scripts/matrix-probe.mjs) y es el que queda.
  return {
    rollRad,
    roll: rollRad * RAD2DEG,
    pitch,
    yaw,
  };
}

/**
 * Convierte landmarks + pose en las medidas que definen la forma del rostro.
 * Devuelve proporciones adimensionales (independientes del zoom y del tamaño
 * de la foto), que es lo único comparable entre personas.
 */
export function measureFace(landmarks, imgW, imgH, matrix) {
  const raw = landmarks.map((lm) => toPx(lm, imgW, imgH));
  const pose = estimatePose(raw, matrix);
  const p = deroll(raw, pose.rollRad);

  const faceLength = dist(p[LM.foreheadTop], p[LM.chin]);
  const cheekWidth = dist(p[LM.cheekL], p[LM.cheekR]);
  const jawWidth = dist(p[LM.jawL], p[LM.jawR]);
  const foreheadWidth = dist(p[LM.templeL], p[LM.templeR]);
  const foreheadHeight = dist(p[LM.foreheadTop], p[LM.glabella]);
  const chinAngle = angleAt(p[LM.chin], p[LM.jawCornerL], p[LM.jawCornerR]);
  const eyeSpan = dist(p[LM.eyeOuterL], p[LM.eyeOuterR]);
  const interEye = dist(p[LM.eyeInnerL], p[LM.eyeInnerR]);

  // Rasgos dimórficos: la ceja más baja y la nariz más ancha tiran a masculino,
  // el labio más grueso a femenino. Se normalizan por el tamaño del rostro para
  // que no dependan del zoom.
  const browGap = (dist(p[LM.browL], p[LM.eyeTopL]) + dist(p[LM.browR], p[LM.eyeTopR])) / 2;
  const lipHeight = dist(p[LM.lipTopOuter], p[LM.lipBottomOuter]);
  const noseWidth = dist(p[LM.alarL], p[LM.alarR]);

  return {
    pose,
    px: { faceLength, cheekWidth, jawWidth, foreheadWidth, foreheadHeight },
    // OJO con estos dos: `points` son las coordenadas tal cual están en la
    // foto y son las que hay que usar para dibujar encima. `pointsAligned`
    // están rotadas para anular la inclinación de la cabeza y sirven solo
    // para medir. Dibujar con las alineadas pone las líneas fuera de la cara
    // en cuanto la cabeza está ladeada.
    points: raw,
    pointsAligned: p,
    // Proporciones: el corazón de la clasificación.
    ratios: {
      lengthOverWidth: faceLength / cheekWidth,
      jawOverCheek: jawWidth / cheekWidth,
      foreheadOverCheek: foreheadWidth / cheekWidth,
      jawOverForehead: jawWidth / foreheadWidth,
      chinAngle,
      foreheadHeightRatio: foreheadHeight / faceLength,
      eyeSpacing: interEye / eyeSpan,
      browGapRatio: browGap / faceLength,
      lipHeightRatio: lipHeight / faceLength,
      noseWidthRatio: noseWidth / cheekWidth,
    },
  };
}

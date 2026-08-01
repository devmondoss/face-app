/**
 * Lectura de color y de calidad de imagen a partir de los píxeles del rostro.
 *
 * Todo se hace midiendo píxeles reales en zonas ancladas a los landmarks, no
 * adivinando: el tono de piel sale de parches de mejilla y frente, el pelo de
 * la zona arriba del nacimiento del pelo, y los ojos de los píxeles dentro del
 * iris (que MediaPipe entrega como puntos 468–477).
 *
 * La clasificación de piel usa el ángulo ITA°, que es la medida que se usa en
 * dermatología, en vez de una escala inventada.
 */

import { LM } from './faceGeometry.js';

// Centros y bordes del iris según el face mesh de MediaPipe.
const IRIS = {
  right: { center: 468, ring: [469, 470, 471, 472] },
  left: { center: 473, ring: [474, 475, 476, 477] },
};

/* ══════════ color: conversiones ══════════ */

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB → CIE Lab (iluminante D65). */
export function rgbToLab([r, g, b]) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);

  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);

  return { L: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

/** Luminancia relativa 0–1, para medir si hay luz suficiente. */
function luma([r, g, b]) {
  return (0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b));
}

/** Mediana por canal: resiste sombras, lunares, brillos y pelos sueltos. */
function medianRgb(pixels) {
  if (!pixels.length) return null;
  const out = [];
  for (let c = 0; c < 3; c++) {
    const v = pixels.map((p) => p[c]).sort((a, b) => a - b);
    out.push(v[Math.floor(v.length / 2)]);
  }
  return out;
}

/* ══════════ muestreo ══════════ */

/** Píxeles dentro de un círculo, submuestreados para no recorrer de más. */
function samplePatch(data, w, h, cx, cy, radius, step = 2) {
  const out = [];
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(h - 1, Math.ceil(cy + radius));

  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * w + x) * 4;
      if (data[i + 3] < 128) continue; // píxel transparente
      out.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  return out;
}

/* ══════════ calidad de imagen ══════════ */

/**
 * Sin luz suficiente el detector de landmarks pierde precisión y la lectura de
 * color se vuelve directamente inventada: en penumbra todo tiende al gris y
 * cualquier pelo castaño se lee como negro. Por eso conviene avisar antes de
 * dar un resultado, en vez de dar uno malo.
 */
export function analyzeImageQuality(canvas, points) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Caja de la cara, que es la zona que importa (el fondo puede estar oscuro
  // sin que eso sea un problema).
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const bx = Math.max(0, Math.floor(minX));
  const by = Math.max(0, Math.floor(minY));
  const bw = Math.min(canvas.width - bx, Math.ceil(maxX - minX));
  const bh = Math.min(canvas.height - by, Math.ceil(maxY - minY));
  if (bw < 8 || bh < 8) return { level: 'ok', luminance: 0.5, messages: [] };

  const { data } = ctx.getImageData(bx, by, bw, bh);

  let sum = 0;
  let count = 0;
  let dark = 0;
  let blown = 0;
  let leftSum = 0;
  let leftN = 0;
  let rightSum = 0;
  let rightN = 0;
  const half = bw / 2;

  for (let y = 0; y < bh; y += 2) {
    for (let x = 0; x < bw; x += 2) {
      const i = (y * bw + x) * 4;
      const px = [data[i], data[i + 1], data[i + 2]];
      const l = luma(px);
      sum += l;
      count++;
      if (l < 0.02) dark++;
      if (px[0] > 250 && px[1] > 250 && px[2] > 250) blown++;
      if (x < half) {
        leftSum += l;
        leftN++;
      } else {
        rightSum += l;
        rightN++;
      }
    }
  }

  const mean = sum / Math.max(1, count);
  const darkFrac = dark / Math.max(1, count);
  const blownFrac = blown / Math.max(1, count);
  const leftMean = leftSum / Math.max(1, leftN);
  const rightMean = rightSum / Math.max(1, rightN);
  // Asimetría relativa de iluminación entre las dos mitades de la cara.
  const sideDiff = Math.abs(leftMean - rightMean) / Math.max(0.01, (leftMean + rightMean) / 2);

  const messages = [];
  let level = 'ok';

  if (mean < 0.045 || darkFrac > 0.35) {
    level = 'mala';
    messages.push('Hay muy poca luz. Buscá una ventana o prendé una luz de frente y repetí la foto.');
  } else if (mean < 0.09) {
    level = 'regular';
    messages.push('La cara está oscura. Con más luz de frente el resultado va a ser más preciso.');
  }

  if (blownFrac > 0.06) {
    level = level === 'ok' ? 'regular' : level;
    messages.push('Hay zonas quemadas de tanta luz. Alejate del foco o evitá el flash directo.');
  }

  if (sideDiff > 0.55) {
    level = level === 'ok' ? 'regular' : level;
    messages.push('La luz te pega de un solo lado. Ponete de frente a la fuente de luz para emparejar.');
  }

  return { level, luminance: mean, darkFrac, blownFrac, sideDiff, messages };
}

/* ══════════ tono de piel ══════════ */

// Cortes estándar del ángulo ITA°. `min` es el piso de cada categoría y se
// evalúa de arriba hacia abajo, así que el orden importa.
const SKIN_TONES = [
  { min: 55, key: 'muy-clara', label: 'Muy clara' },
  { min: 41, key: 'clara', label: 'Clara' },
  { min: 28, key: 'intermedia', label: 'Intermedia' },
  { min: 10, key: 'trigueña', label: 'Trigueña' },
  { min: -30, key: 'morena', label: 'Morena' },
  { min: -Infinity, key: 'oscura', label: 'Oscura' },
];

/**
 * Se muestrean mejillas y frente, evitando ojos, cejas, labios y el borde del
 * rostro. La clasificación usa el ángulo ITA° = atan((L*-50)/b*), que es el
 * estándar en dermatología para tipificar piel.
 */
export function analyzeSkin(canvas, points, measured) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const r = measured.px.cheekWidth * 0.055;

  // Puntos de muestreo sobre zonas planas y sin vello.
  const spots = [
    points[50], // mejilla izquierda
    points[280], // mejilla derecha
    points[101],
    points[330],
    points[9], // entrecejo
    points[151], // frente
  ].filter(Boolean);

  let pixels = [];
  for (const s of spots) pixels.push(...samplePatch(data, width, height, s.x, s.y, r));
  if (!pixels.length) return null;

  // Ventana intercuartil: se descarta por igual el 25% más oscuro (sombras) y
  // el 25% más claro (brillos especulares). Recortar asimétricamente, como se
  // hacía antes, corría la lectura hacia el lado claro y volvía toda la
  // muestra un escalón más pálida de lo que era.
  pixels.sort((a, b) => luma(a) - luma(b));
  pixels = pixels.slice(Math.floor(pixels.length * 0.25), Math.ceil(pixels.length * 0.75));

  const rgb = medianRgb(pixels);
  const lab = rgbToLab(rgb);
  const ita = (Math.atan2(lab.L - 50, lab.b) * 180) / Math.PI;
  const tone = SKIN_TONES.find((t) => ita >= t.min) || SKIN_TONES[SKIN_TONES.length - 1];

  return {
    key: tone.key,
    label: tone.label,
    hex: rgbToHex(rgb),
    rgb,
    ita: Math.round(ita),
    lab,
  };
}

/* ══════════ color de pelo ══════════ */

/**
 * Se muestrea por encima del nacimiento del pelo, en tres puntos, a una altura
 * proporcional al tamaño de la cara. Si esa zona sale muy parecida a la piel
 * se asume calvo o rapado en vez de inventar un color.
 */
export function analyzeHair(canvas, points, measured, skin) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const top = points[LM.foreheadTop];
  const faceH = measured.px.faceLength;
  const r = measured.px.cheekWidth * 0.06;

  // Varias alturas por encima de la frente, para no depender de dónde arranca
  // exactamente el pelo en esta persona. El desplazamiento horizontal es chico
  // a propósito: pegado a la línea media de la cabeza. Con una separación
  // mayor los parches de los costados se salen de la silueta y muestrean el
  // fondo — con un retrato sobre una bandera roja, el resultado era "pelirrojo".
  const spots = [];
  // Se arranca más arriba que el punto 10: en bastantes caras ese landmark
  // queda por debajo del nacimiento real del pelo, y muestrear a 0,10 todavía
  // agarraba frente. La mezcla piel+pelo daba lecturas cálidas falsas.
  for (const up of [0.16, 0.23, 0.3, 0.37]) {
    for (const dx of [-0.07, 0, 0.07]) {
      spots.push({ x: top.x + measured.px.cheekWidth * dx, y: top.y - faceH * up });
    }
  }

  // Mediana por parche y después mediana de las medianas: si un par de parches
  // igual cae en el fondo, quedan en minoría y no arrastran el resultado. Un
  // promedio sobre todos los píxeles juntos sí se dejaría arrastrar.
  const perSpot = [];
  for (const s of spots) {
    if (s.y < 0 || s.y >= height) continue;
    const px = samplePatch(data, width, height, s.x, s.y, r);
    if (px.length >= 8) perSpot.push(medianRgb(px));
  }
  if (perSpot.length < 4) return { key: 'desconocido', label: 'No se pudo ver', hex: null };

  const rgb = medianRgb(perSpot);
  const lab = rgbToLab(rgb);
  const chroma = Math.hypot(lab.a, lab.b);

  // ¿Es piel en vez de pelo? Entonces está pelado o rapado muy corto.
  if (skin) {
    const dl = Math.abs(lab.L - skin.lab.L);
    const dc = Math.hypot(lab.a - skin.lab.a, lab.b - skin.lab.b);
    if (dl < 9 && dc < 9)
      return { key: 'rapado', label: 'Rapado o sin pelo', hex: rgbToHex(rgb), rgb, lab };
  }

  let key = 'castaño';
  let label = 'Castaño';
  if (lab.L < 22) {
    key = 'negro';
    label = 'Negro';
  } else if (chroma < 13 && lab.L > 40) {
    // Antes exigía chroma < 9: demasiado estricto. El pelo canoso en una foto
    // real casi nunca es gris neutro puro, y así salía clasificado castaño.
    key = 'canoso';
    label = 'Canoso o gris';
  } else if (lab.a > 20 && lab.b > 16 && (!skin || lab.a > skin.lab.a + 6)) {
    // El pelirrojo tiene que ser bastante más rojo que la propia piel de la
    // persona. Sin esa comparación, cualquier mezcla de pelo con frente (o un
    // fondo cálido) daba "pelirrojo" en el 18% de las caras.
    key = 'pelirrojo';
    label = 'Pelirrojo';
  } else if (lab.L > 55 && lab.b > 18) {
    key = 'rubio';
    label = 'Rubio';
  } else if (lab.L > 42) {
    key = 'castaño-claro';
    label = 'Castaño claro';
  } else if (lab.L < 33) {
    key = 'castaño-oscuro';
    label = 'Castaño oscuro';
  }

  return { key, label, hex: rgbToHex(rgb), rgb, lab };
}

/* ══════════ color de ojos ══════════ */

/**
 * Se toman los píxeles dentro del círculo del iris y se descartan la pupila
 * (lo más oscuro) y los reflejos especulares (lo más claro), que si no dominan
 * la lectura y dan "marrón oscuro" para cualquier ojo.
 */
export function analyzeEyes(canvas, points) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let pixels = [];
  let maxRadius = 0;
  for (const side of [IRIS.left, IRIS.right]) {
    const c = points[side.center];
    if (!c) continue;
    const radius =
      side.ring.reduce((acc, i) => acc + Math.hypot(points[i].x - c.x, points[i].y - c.y), 0) /
      side.ring.length;
    if (!(radius > 1)) continue;
    maxRadius = Math.max(maxRadius, radius);
    // 0.78 del radio: se evita el borde del iris, que mezcla con la esclerótica.
    pixels.push(...samplePatch(data, width, height, c.x, c.y, radius * 0.78, 1));
  }

  // Con el iris de menos de ~5 px de radio no queda color que leer: la
  // compresión JPEG lo dessatura y todo termina dando "gris". Es más honesto
  // decir que no se pudo ver que inventar un color.
  if (maxRadius < 5 || pixels.length < 24)
    return { key: 'desconocido', label: 'No se pudo ver', hex: null };

  pixels.sort((a, b) => luma(a) - luma(b));
  // Fuera el 35% más oscuro (pupila y pestañas) y el 20% más claro (reflejos).
  pixels = pixels.slice(Math.floor(pixels.length * 0.35), Math.ceil(pixels.length * 0.8));
  if (!pixels.length) return { key: 'desconocido', label: 'No se pudo ver', hex: null };

  const rgb = medianRgb(pixels);
  const lab = rgbToLab(rgb);
  const chroma = Math.hypot(lab.a, lab.b);

  let key = 'marron';
  let label = 'Marrones';
  if (lab.b < -2.5) {
    // Un iris azul fotografiado y comprimido puede quedar en b* ≈ -3. Con el
    // umbral en -4 caía en "gris", que era el 18% de los casos.
    key = 'azul';
    label = 'Azules';
  } else if (lab.a < -3 && lab.b > 2) {
    key = 'verde';
    label = 'Verdes';
  } else if (chroma < 3.5) {
    // Umbral bastante más estricto que el inicial (7): a esta resolución el
    // iris pierde saturación y con el umbral flojo el 43% de las caras salían
    // "grises", cuando en la población real son una minoría chica.
    key = 'gris';
    label = 'Grises';
  } else if (lab.L < 32) {
    key = 'marron-oscuro';
    label = 'Marrones oscuros';
  } else if (lab.L > 45 && lab.b > 12) {
    key = 'miel';
    label = 'Color miel o avellana';
  }

  return { key, label, hex: rgbToHex(rgb), rgb, lab };
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

import './styles.css';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { LM, measureFace } from './faceGeometry.js';
import { classifyFaceShape, describeFeatures } from './faceShape.js';
import { estimateGender } from './gender.js';
import { analyzeImageQuality, analyzeSkin, analyzeHair, analyzeEyes } from './faceAttributes.js';
import { getHaircuts } from './haircuts.js';
import * as tryon from './tryon.js';

const $ = (id) => document.getElementById(id);
const MAX_DIM = 1024; // a más resolución el detector no mejora, solo tarda

// Carpeta donde vive index.html. Se calcula en runtime para que la app ande
// igual en la raíz de un dominio o dentro de un subdirectorio.
const ASSET_BASE = new URL('./', document.baseURI).href;

const state = {
  gender: null, // se estima de la foto; el usuario puede cambiarlo
  genderEstimate: null,
  genderTouched: false,
  landmarker: null,
  stream: null,
  facingMode: 'user',
  photo: null,
  analysis: null,
  showMesh: false,
};

/* ══════════ solo móvil ══════════ */

/**
 * La app se bloquea en escritorio a pedido: está pensada para la cámara
 * frontal y el encuadre vertical del teléfono. Se exige puntero grueso
 * (dedo) además de pantalla chica, porque una ventana angosta en una notebook
 * sigue siendo escritorio.
 */
function isMobile() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = Math.min(window.innerWidth, window.innerHeight) <= 820;
  return coarse && narrow;
}

function applyDeviceGate() {
  const desktop = !isMobile();
  document.body.classList.toggle('is-desktop', desktop);
  if (desktop) stopCamera();
  return !desktop;
}

/* ══════════ navegación ══════════ */

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}

function setLoading(text) {
  $('loading-text').textContent = text;
  show('screen-loading');
}

/* ══════════ modelo ══════════ */

async function getLandmarker() {
  if (state.landmarker) return state.landmarker;
  const fileset = await FilesetResolver.forVisionTasks(ASSET_BASE + 'wasm');
  state.landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: ASSET_BASE + 'models/face_landmarker.task', delegate: 'GPU' },
    runningMode: 'IMAGE',
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
  });
  return state.landmarker;
}

/* ══════════ cámara ══════════ */

async function openCamera() {
  try {
    stopCamera();
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facingMode, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
    const v = $('video');
    v.srcObject = state.stream;
    v.style.transform = state.facingMode === 'user' ? 'scaleX(-1)' : 'none';
    await v.play();
    show('screen-camera');
  } catch (err) {
    alert(
      'No se pudo abrir la cámara: ' +
        (err?.message || err) +
        '\n\nLa cámara solo funciona sobre HTTPS. Podés usar "Elegir una foto".'
    );
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
}

function captureFromVideo() {
  const v = $('video');
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, MAX_DIM / Math.max(v.videoWidth, v.videoHeight));
  canvas.width = Math.round(v.videoWidth * scale);
  canvas.height = Math.round(v.videoHeight * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (state.facingMode === 'user') {
    // La vista previa está espejada; se guarda sin espejar para analizar la
    // cara real y no su reflejo.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
  stopCamera();
  return canvas;
}

function canvasFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = URL.createObjectURL(file);
  });
}

/* ══════════ análisis ══════════ */

async function analyze(canvas) {
  setLoading(state.landmarker ? 'Analizando tu rostro…' : 'Preparando el análisis…');

  let landmarker;
  try {
    landmarker = await getLandmarker();
  } catch (err) {
    alert('No se pudo cargar el detector: ' + (err?.message || err));
    show('screen-start');
    return;
  }

  $('loading-text').textContent = 'Midiendo las proporciones…';
  await new Promise((r) => setTimeout(r, 30));

  const result = landmarker.detect(canvas);
  const landmarks = result?.faceLandmarks?.[0];
  if (!landmarks) {
    alert(
      'No se detectó ninguna cara.\n\nProbá de frente, con buena luz y que la cara ocupe buena parte de la foto.'
    );
    show('screen-start');
    return;
  }

  const matrix = result?.facialTransformationMatrixes?.[0]?.data;
  const measured = measureFace(landmarks, canvas.width, canvas.height, matrix);
  const shape = classifyFaceShape(measured.ratios);

  $('loading-text').textContent = 'Leyendo colores…';
  await new Promise((r) => setTimeout(r, 20));

  const quality = analyzeImageQuality(canvas, measured.points);
  const skin = analyzeSkin(canvas, measured.points, measured);
  const hair = analyzeHair(canvas, measured.points, measured, skin);
  const eyes = analyzeEyes(canvas, measured.points);
  const genderEstimate = estimateGender(measured.ratios);

  state.photo = { canvas, dataUrl: canvas.toDataURL('image/jpeg', 0.92), mime: 'image/jpeg' };
  state.analysis = {
    measured,
    shape,
    quality,
    attrs: { skin, hair, eyes },
    notes: describeFeatures(measured.ratios),
  };
  state.genderEstimate = genderEstimate;
  // Cada foto vuelve a estimar; si el usuario ya corrigió, se respeta.
  if (!state.genderTouched) state.gender = genderEstimate.key;

  if (import.meta.env.DEV) window.__lastAnalysis = { ...measured, quality, skin, hair, eyes, genderEstimate };

  renderResult();
  show('screen-result');
}

/* ══════════ foto y overlay ══════════ */

/**
 * Recorte centrado en la cara: en un retrato de cuerpo entero la cara ocupa
 * poco del encuadre y tanto la foto como las líneas quedan diminutas.
 */
function faceCropRect() {
  const p = state.analysis.measured.points;
  const src = state.photo.canvas;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pt of p) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }

  const w = maxX - minX;
  const h = maxY - minY;
  // Más aire arriba que abajo: ahí está el pelo, que es de lo que trata la app.
  let x = minX - w * 0.42;
  let y = minY - h * 0.55;
  let cw = w * 1.84;
  let ch = h * 1.95;

  const target = 4 / 5; // vertical, que es como se mira en el teléfono
  if (cw / ch > target) {
    const nh = cw / target;
    y -= (nh - ch) / 2;
    ch = nh;
  } else {
    const nw = ch * target;
    x -= (nw - cw) / 2;
    cw = nw;
  }

  cw = Math.min(cw, src.width);
  ch = Math.min(ch, src.height);
  x = Math.max(0, Math.min(x, src.width - cw));
  y = Math.max(0, Math.min(y, src.height - ch));
  return { x, y, w: cw, h: ch };
}

function drawPhoto() {
  const { canvas: src } = state.photo;
  const out = $('result-canvas');
  const crop = faceCropRect();

  out.width = Math.round(crop.w);
  out.height = Math.round(crop.h);
  const ctx = out.getContext('2d');
  ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);

  if (state.showMesh) {
    ctx.save();
    ctx.translate(-crop.x, -crop.y); // los landmarks están en coordenadas de la foto entera
    drawMeasurements(ctx, crop);
    ctx.restore();
  }
}

function drawMeasurements(ctx, crop) {
  const p = state.analysis.measured.points;
  const unit = Math.max(1.6, crop.w / 420);

  ctx.save();
  ctx.fillStyle = 'rgba(10,8,24,0.45)';
  ctx.fillRect(crop.x, crop.y, crop.w, crop.h);

  // labelDx corre la etiqueta a lo ancho de la cara: sin eso la de "largo"
  // (vertical) cae encima de las horizontales, que van todas centradas.
  const faceW = state.analysis.measured.px.cheekWidth;
  const lines = [
    { a: LM.foreheadTop, b: LM.chin, color: '#ffcf6b', label: 'largo', labelDx: -faceW * 0.42 },
    { a: LM.cheekL, b: LM.cheekR, color: '#47dcf0', label: 'pómulos' },
    { a: LM.jawL, b: LM.jawR, color: '#ff5fa2', label: 'mandíbula' },
    { a: LM.templeL, b: LM.templeR, color: '#8b6cff', label: 'frente' },
  ];

  ctx.lineWidth = unit;
  ctx.font = `500 ${unit * 7}px Poppins, ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';

  for (const l of lines) {
    const a = p[l.a];
    const b = p[l.b];
    ctx.strokeStyle = l.color;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    for (const pt of [a, b]) {
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, unit * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    const mx = (a.x + b.x) / 2 + (l.labelDx || 0);
    const my = (a.y + b.y) / 2;
    const w = ctx.measureText(l.label).width;
    ctx.fillStyle = 'rgba(10,8,24,0.78)';
    ctx.beginPath();
    ctx.roundRect(mx - w / 2 - unit * 3, my - unit * 5.5, w + unit * 6, unit * 11, unit * 3);
    ctx.fill();
    ctx.fillStyle = l.color;
    ctx.textAlign = 'center';
    ctx.fillText(l.label, mx, my);
  }
  ctx.restore();
}

/* ══════════ render ══════════ */

function renderResult() {
  const { measured, shape, quality, attrs, notes } = state.analysis;
  drawPhoto();

  // Cada análisis nuevo vuelve a la primera pestaña.
  for (const b of $('tabs').querySelectorAll('button'))
    b.setAttribute('aria-selected', String(b.dataset.tab === 'cortes'));
  for (const p of document.querySelectorAll('.tab-panel'))
    p.classList.toggle('active', p.id === 'tab-cortes');
  state.showMesh = false;
  $('btn-mesh').textContent = 'Medidas';

  $('shape-name').textContent = shape.best.label;
  const pct = Math.round(shape.best.confidence * 100);
  $('confidence-fill').style.width = pct + '%';
  $('confidence-text').textContent = pct + '% de coincidencia';
  $('shape-blurb').textContent = shape.best.blurb;

  const mixed = $('mixed-note');
  if (shape.isMixed) {
    mixed.hidden = false;
    mixed.textContent = `Tu cara está entre ${shape.best.label.toLowerCase()} y ${shape.second.label.toLowerCase()} — es muy común. Mirá también los consejos de ${shape.second.label.toLowerCase()}: lo que sirva para las dos formas es apuesta segura.`;
  } else {
    mixed.hidden = true;
  }

  renderAlerts(quality, measured.pose);
  renderAttributes(attrs);
  renderGenderRow();
  renderMetrics(measured, shape);
  $('feature-notes').innerHTML = notes.map((n) => `<div class="note">${n.text}</div>`).join('');
  renderRecommendations();
}

/**
 * Los avisos se muestran como una línea plegada cada uno. Antes eran bloques
 * de varias líneas que empujaban el resultado fuera de la primera pantalla;
 * el detalle sigue estando, pero solo cuando se lo pide.
 */
function renderAlerts(quality, pose) {
  const alerts = [];

  if (quality.messages.length) {
    const extra =
      quality.level === 'mala'
        ? '<p style="margin:7px 0 0">Con esta luz, los colores de pelo y ojos son poco confiables.</p>'
        : '';
    alerts.push({
      title: quality.level === 'mala' ? 'Falta luz' : 'La luz no ayuda',
      body: `<ul>${quality.messages.map((m) => `<li>${m}</li>`).join('')}</ul>${extra}`,
    });
  }

  const problems = [];
  if (Math.abs(pose.yaw) > 14) problems.push('la cara está girada hacia un costado');
  if (Math.abs(pose.pitch) > 16) problems.push('la cabeza está hacia arriba o hacia abajo');
  if (Math.abs(pose.roll) > 20) problems.push('la cabeza está muy ladeada');
  if (problems.length) {
    alerts.push({
      title: 'La foto no es del todo frontal',
      body: `<p style="margin:0">Detectamos que ${problems.join(
        ' y '
      )}. Las medidas pueden estar corridas — si podés, sacate otra mirando de frente.</p>`,
    });
  }

  $('alerts').innerHTML = alerts
    .map(
      (a) =>
        `<details class="alert"><summary>${a.title}</summary><div class="alert-body">${a.body}</div></details>`
    )
    .join('');
}

/** Pestañas: muestran un tercio del contenido por vez en lugar de apilarlo. */
function wireTabs() {
  const nav = $('tabs');
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    for (const b of nav.querySelectorAll('button')) b.setAttribute('aria-selected', String(b === btn));
    for (const p of document.querySelectorAll('.tab-panel'))
      p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`);
    // La barra queda pegada arriba, así que al cambiar de pestaña se vuelve
    // a su altura en vez de dejar al usuario a mitad del contenido anterior.
    nav.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

function renderAttributes(attrs) {
  const items = [
    { key: 'Piel', v: attrs.skin, fallback: 'No se pudo leer' },
    { key: 'Pelo', v: attrs.hair, fallback: 'No se pudo ver' },
    { key: 'Ojos', v: attrs.eyes, fallback: 'No se pudo ver' },
    {
      key: 'Forma',
      v: { label: state.analysis.shape.best.label, hex: null },
    },
  ];

  $('attrs').innerHTML = items
    .map((it) => {
      const label = it.v?.label || it.fallback;
      const swatch = it.v?.hex
        ? `<span class="swatch" style="background:${it.v.hex}"></span>`
        : '<span class="swatch" style="background:linear-gradient(135deg,#8b6cff,#ff5fa2)"></span>';
      return `<div class="attr">${swatch}<span class="attr-text"><span class="attr-key">${it.key}</span><span class="attr-val">${label}</span></span></div>`;
    })
    .join('');
}

/**
 * El género se muestra ya elegido, nunca como pregunta, y siempre editable con
 * un toque. Cuando la estimación es floja se lo dice, para invitar a corregir.
 */
function renderGenderRow() {
  const est = state.genderEstimate;
  const label = $('gender-label');
  // La estimación acierta ~2 de cada 3 veces (ver src/gender.js), así que
  // mientras el usuario no la haya tocado se invita a corregirla. La pista va
  // en una segunda línea chica: como texto corrido ocupaba tres renglones y
  // estiraba la fila entera.
  const hint = state.genderTouched ? '' : '<em>tocá para cambiar</em>';
  label.innerHTML = `Cortes para${hint}`;

  const el = $('gender-select');
  el.innerHTML = '';
  for (const g of [
    { key: 'hombre', label: 'Hombre' },
    { key: 'mujer', label: 'Mujer' },
  ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.role = 'radio';
    b.textContent = g.label;
    b.setAttribute('aria-checked', String(state.gender === g.key));
    b.addEventListener('click', () => {
      state.gender = g.key;
      state.genderTouched = true;
      renderGenderRow();
      renderRecommendations();
    });
    el.appendChild(b);
  }
}

function renderMetrics(measured, shape) {
  const r = measured.ratios;
  const rows = [
    ['Largo ÷ ancho de pómulos', r.lengthOverWidth.toFixed(2)],
    ['Mandíbula ÷ pómulos', r.jawOverCheek.toFixed(2)],
    ['Frente ÷ pómulos', r.foreheadOverCheek.toFixed(2)],
    ['Ángulo del mentón', Math.round(r.chinAngle) + '°'],
    ['Altura de frente ÷ largo', r.foreheadHeightRatio.toFixed(2)],
    ['Giro de la cabeza', Math.round(Math.abs(measured.pose.yaw)) + '°'],
    ['Luz en la cara', Math.round(state.analysis.quality.luminance * 100) + '/100'],
  ];

  const scores = shape.all
    .map(
      (s) => `<div class="score-row ${s === shape.best ? 'top' : ''}">
        <span>${s.label}</span>
        <div class="score-track"><span style="width:${(s.confidence * 100).toFixed(0)}%"></span></div>
        <em>${Math.round(s.confidence * 100)}%</em>
      </div>`
    )
    .join('');

  $('metrics-body').innerHTML =
    rows.map(([k, v]) => `<div class="metric-row"><span>${k}</span><span>${v}</span></div>`).join('') +
    `<div class="shape-scores">${scores}</div>`;
}

function renderRecommendations() {
  const data = getHaircuts(state.analysis.shape.best.key, state.gender);

  $('recommended').innerHTML = '';
  data.recommended.forEach((h, i) => {
    // <details> nativo: plegado muestra lo justo para elegir, y el primero
    // arranca abierto para que se entienda que se despliegan.
    const card = document.createElement('details');
    card.className = 'card';
    if (i === 0) card.open = true;
    card.innerHTML = `
      <summary>
        <span class="card-head">
          <h4>${h.name}</h4>
          <p class="card-desc">${h.desc}</p>
        </span>
        <span class="chev" aria-hidden="true">▾</span>
      </summary>
      <div class="card-body">
        <p class="card-why">${h.why}</p>
      </div>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-glass';
    btn.textContent = 'Probarlo en mi foto';
    btn.addEventListener('click', () => openTryOn(h));
    card.querySelector('.card-body').appendChild(btn);
    $('recommended').appendChild(card);
  });

  $('avoid').innerHTML = data.avoid.map((a) => `<li>${a}</li>`).join('');

  const beardBlock = $('beard-block');
  if (data.beard?.length) {
    beardBlock.hidden = false;
    $('beard').innerHTML = data.beard.map((b) => `<li>${b}</li>`).join('');
  } else {
    beardBlock.hidden = true;
  }
}

/* ══════════ prueba virtual ══════════ */

let currentHaircut = null;

function openTryOn(haircut) {
  currentHaircut = haircut;
  $('tryon-title').textContent = haircut.name;
  $('tryon-error').hidden = true;
  $('tryon-result').hidden = true;
  // El campo de clave solo aparece si el servidor dice que no tiene una.
  $('tryon-key').hidden = !tryon.getApiKey();
  $('api-key').value = tryon.getApiKey();
  $('tryon-go').textContent = 'Generar';
  $('tryon-go').disabled = false;
  $('tryon-modal').hidden = false;
}

async function runTryOn() {
  const typedKey = $('api-key').value.trim();
  if (typedKey) tryon.setApiKey(typedKey);

  $('tryon-error').hidden = true;
  $('tryon-go').disabled = true;
  $('tryon-go').textContent = 'Generando… (10–20 s)';

  try {
    const base64 = state.photo.dataUrl.split(',')[1];
    const out = await tryon.generateTryOn(
      base64,
      state.photo.mime,
      currentHaircut,
      state.gender,
      state.analysis.attrs
    );
    $('tryon-before').src = state.photo.dataUrl;
    $('tryon-after').src = out;
    $('tryon-download').href = out;
    $('tryon-key').hidden = true;
    $('tryon-result').hidden = false;
    $('tryon-go').textContent = 'Generar de nuevo';
  } catch (err) {
    $('tryon-error').hidden = false;
    $('tryon-error').textContent = err?.message || String(err);
    // Si el servidor no puede resolverlo solo, se ofrece poner una clave propia.
    if (err?.needsOwnKey) $('tryon-key').hidden = false;
    $('tryon-go').textContent = 'Reintentar';
  } finally {
    $('tryon-go').disabled = false;
  }
}

/* ══════════ eventos ══════════ */

function wire() {
  $('btn-camera').addEventListener('click', openCamera);
  $('btn-upload').addEventListener('click', () => $('file-input').click());

  $('file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      analyze(await canvasFromFile(file));
    } catch (err) {
      alert(err.message);
    }
  });

  $('btn-shoot').addEventListener('click', () => analyze(captureFromVideo()));
  $('btn-cam-back').addEventListener('click', () => {
    stopCamera();
    show('screen-start');
  });
  $('btn-cam-flip').addEventListener('click', () => {
    state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
    openCamera();
  });

  $('btn-restart').addEventListener('click', () => show('screen-start'));
  $('btn-mesh').addEventListener('click', () => {
    state.showMesh = !state.showMesh;
    $('btn-mesh').textContent = state.showMesh ? 'Ocultar' : 'Medidas';
    drawPhoto();
  });
  wireTabs();

  $('tryon-go').addEventListener('click', runTryOn);
  $('tryon-close').addEventListener('click', () => ($('tryon-modal').hidden = true));
  $('tryon-modal').addEventListener('click', (e) => {
    if (e.target === $('tryon-modal')) $('tryon-modal').hidden = true;
  });

  window.addEventListener('pagehide', stopCamera);
  window.addEventListener('resize', applyDeviceGate);
  window.addEventListener('orientationchange', applyDeviceGate);
}

function checkSupport() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const n = $('unsupported-note');
    n.hidden = false;
    n.textContent = 'Este navegador no da acceso a la cámara. Podés usar "Elegir una foto".';
  }
}

applyDeviceGate();
wire();
checkSupport();

// Se precarga el detector para que el primer análisis no espere la descarga.
if (isMobile()) requestIdleCallback?.(() => getLandmarker().catch(() => {}));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register(ASSET_BASE + 'sw.js', { scope: ASSET_BASE }).catch(() => {})
  );
}

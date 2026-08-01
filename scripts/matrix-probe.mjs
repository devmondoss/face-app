/**
 * Diagnóstico: cómo está dispuesta la matriz de transformación facial de
 * MediaPipe y qué extracción de ángulos de Euler da valores correctos.
 *
 * Se mide la misma foto derecha y rotada 14°: la extracción correcta tiene que
 * dar roll≈14 y yaw≈0 en la rotada, y todo ≈0 en la derecha.
 */
import puppeteer from 'puppeteer-core';
import { readdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ORIGIN = process.env.ORIGIN || 'https://localhost:5173';
const photo = readdirSync('public/_test').find((f) => /\.(jpe?g|png)$/i.test(f));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--ignore-certificate-errors'],
});
const page = await browser.newPage();
await page.goto(`${ORIGIN}/tools/calibrar.html`, { waitUntil: 'networkidle0', timeout: 60000 });

const out = await page.evaluate(
  async (url, deg) => {
    const { FilesetResolver, FaceLandmarker } = await import(
      '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'
    );
    const fs = await FilesetResolver.forVisionTasks('/wasm');
    const lm = await FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'CPU' },
      runningMode: 'IMAGE',
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });

    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });

    const render = (rot) => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      return c;
    };

    const grab = (rot) => {
      const r = lm.detect(render(rot));
      return {
        rot,
        matrix: Array.from(r.facialTransformationMatrixes[0].data),
        // roll de referencia, medido con los ojos: este SIEMPRE es correcto
        eyeRoll:
          (Math.atan2(
            r.faceLandmarks[0][263].y - r.faceLandmarks[0][33].y,
            r.faceLandmarks[0][263].x - r.faceLandmarks[0][33].x
          ) *
            180) /
          Math.PI,
      };
    };

    return [grab(0), grab(deg)];
  },
  `${ORIGIN}/_test/${photo}`,
  14
);

const R2D = 180 / Math.PI;

// Dos lecturas posibles del arreglo de 16 elementos.
const asColumnMajor = (d) => (r, c) => d[c * 4 + r];
const asRowMajor = (d) => (r, c) => d[r * 4 + c];

function euler(get) {
  return {
    yaw: Math.atan2(get(0, 2), get(2, 2)) * R2D,
    pitch: Math.atan2(-get(1, 2), Math.hypot(get(0, 2), get(2, 2))) * R2D,
    roll: Math.atan2(get(1, 0), get(1, 1)) * R2D,
  };
}

const f = (n) => n.toFixed(1).padStart(7);
for (const s of out) {
  console.log(`\n── imagen rotada ${s.rot}° (roll real por los ojos: ${s.eyeRoll.toFixed(1)}°)`);
  for (const [name, view] of [
    ['column-major', asColumnMajor(s.matrix)],
    ['row-major   ', asRowMajor(s.matrix)],
  ]) {
    const e = euler(view);
    console.log(`  ${name}   yaw ${f(e.yaw)}   pitch ${f(e.pitch)}   roll ${f(e.roll)}`);
  }
}

await browser.close();

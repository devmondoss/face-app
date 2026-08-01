/**
 * Copia el runtime WASM de MediaPipe desde node_modules a public/wasm/.
 *
 * Hay que volver a correrlo al actualizar @mediapipe/tasks-vision, porque los
 * .wasm están versionados en el repo (Vercel no los puede sacar de
 * node_modules en tiempo de ejecución).
 *
 * Se saltea a propósito la variante `vision_wasm_module_internal`: son 11 MB
 * que el FilesetResolver nunca pide por el camino que usa esta app. Verificado
 * sacándola y corriendo la prueba de humo completa.
 *
 *   node scripts/sync-wasm.mjs
 */
import { readdirSync, copyFileSync, mkdirSync, statSync } from 'node:fs';

const SRC = 'node_modules/@mediapipe/tasks-vision/wasm';
const DEST = 'public/wasm';
const SKIP = /_module_internal\./;

mkdirSync(DEST, { recursive: true });

let copied = 0;
let skipped = 0;
for (const f of readdirSync(SRC)) {
  if (SKIP.test(f)) {
    skipped++;
    continue;
  }
  copyFileSync(`${SRC}/${f}`, `${DEST}/${f}`);
  copied++;
  console.log(`${f}  (${(statSync(`${DEST}/${f}`).size / 1048576).toFixed(1)} MB)`);
}
console.log(`\n${copied} archivos copiados, ${skipped} salteados por innecesarios.`);

/**
 * Prueba la función serverless api/tryon.js sin necesidad de una API key.
 *
 * No se puede verificar la generación real de imágenes sin clave y sin gastar
 * dinero, pero sí todo lo demás: el método permitido, el parseo del cuerpo
 * (que en Vercel puede llegar parseado o como stream crudo) y que la ausencia
 * de GEMINI_API_KEY devuelva la señal que la app usa para ofrecer clave propia.
 *
 *   node scripts/api-test.mjs
 */
import { Readable } from 'node:stream';
import handler from '../api/tryon.js';

let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failed++;
};

/** Respuesta falsa con la misma interfaz encadenable que usa la función. */
function mockRes() {
  const r = { code: 0, body: null };
  r.status = (c) => {
    r.code = c;
    return r;
  };
  r.json = (b) => {
    r.body = b;
    return r;
  };
  return r;
}

/** Petición falsa: si `raw` es true, el cuerpo llega como stream sin parsear. */
function mockReq(method, body, raw = false) {
  if (raw) {
    const s = Readable.from([Buffer.from(JSON.stringify(body))]);
    s.method = method;
    return s;
  }
  return { method, body };
}

const PAYLOAD = { imageBase64: 'x'.repeat(600), mimeType: 'image/jpeg', prompt: 'test' };
const savedKey = process.env.GEMINI_API_KEY;

/* ── método no permitido ── */
{
  const res = mockRes();
  await handler(mockReq('GET'), res);
  check(res.code === 405, `GET responde 405 (dio ${res.code})`);
}

/* ── sin clave configurada: la app necesita saberlo para ofrecer una propia ── */
{
  delete process.env.GEMINI_API_KEY;
  const res = mockRes();
  await handler(mockReq('POST', PAYLOAD), res);
  check(res.code === 501, `sin GEMINI_API_KEY responde 501 (dio ${res.code})`);
  check(res.body?.needsOwnKey === true, 'la respuesta marca needsOwnKey');
}

/* ── faltan parámetros ── */
{
  process.env.GEMINI_API_KEY = 'clave-de-prueba';
  const res = mockRes();
  await handler(mockReq('POST', { prompt: 'sin imagen' }), res);
  check(res.code === 400, `sin imagen responde 400 (dio ${res.code})`);
}

/* ── cuerpo como stream crudo: es el caso que rompía silenciosamente ── */
{
  process.env.GEMINI_API_KEY = 'clave-de-prueba';
  const res = mockRes();
  await handler(mockReq('POST', PAYLOAD, true), res);
  check(
    res.code !== 400,
    `un cuerpo sin parsear se lee bien (dio ${res.code}${res.code === 400 ? ' = no lo leyó' : ' = llegó a llamar al modelo'})`
  );
}

/* ── clave inválida: tiene que fallar con mensaje, no reventar ── */
{
  process.env.GEMINI_API_KEY = 'clave-invalida';
  const res = mockRes();
  await handler(mockReq('POST', PAYLOAD), res);
  check(res.code === 502, `una clave inválida responde 502 (dio ${res.code})`);
  check(typeof res.body?.error === 'string' && res.body.error.length > 0, 'devuelve un mensaje de error legible');
}

if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
else process.env.GEMINI_API_KEY = savedKey;

console.log(failed ? `\n${failed} comprobaciones fallaron.` : '\nAPI OK.');
process.exit(failed ? 1 : 0);

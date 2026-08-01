/**
 * Prueba virtual del corte (opcional).
 *
 * IMPORTANTE: es la única parte de la app que rompe el modelo de privacidad.
 * Para generar la imagen hay que mandar la foto a un modelo de IA. El análisis
 * de rostro, en cambio, nunca sale del dispositivo. La interfaz lo avisa antes
 * de mandar nada.
 *
 * Dos caminos, en este orden:
 *  1. /api/tryon — la función serverless de Vercel, con la key en el servidor.
 *     Es el camino normal: el usuario final no configura nada.
 *  2. Key propia guardada en el teléfono, pegándole directo a Google. Sirve
 *     si la app corre sin backend (abierta desde un archivo, otro hosting) o
 *     si el servidor se quedó sin cuota.
 */

import { GoogleGenAI } from '@google/genai';

const KEY_STORAGE = 'faceapp.geminiKey';

export const DEFAULT_MODEL = 'gemini-3.1-flash-image';

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || '';
}
export function setApiKey(k) {
  if (k) localStorage.setItem(KEY_STORAGE, k.trim());
  else localStorage.removeItem(KEY_STORAGE);
}

/**
 * El prompt es la mitad del resultado: sin restricciones explícitas el modelo
 * "mejora" la cara y devuelve a otra persona con el corte puesto, que es
 * exactamente lo que no sirve.
 */
export function buildPrompt(haircut, gender, attrs) {
  const who = gender === 'mujer' ? 'woman' : 'man';
  const detail = [];
  if (attrs?.hair?.key && attrs.hair.key !== 'desconocido' && attrs.hair.key !== 'rapado')
    detail.push(`Keep their natural hair colour (${attrs.hair.label.toLowerCase()}).`);
  if (attrs?.skin?.hex) detail.push('Keep their exact skin tone unchanged.');

  return [
    `Edit this photo of a ${who}: replace ONLY the hair with ${haircut.tryon}.`,
    'Critical constraints:',
    '- Keep the exact same face, identity, facial features, skin tone, expression and eyes. The person must remain clearly recognisable as the same individual.',
    '- Keep the same lighting, background, clothing, camera angle and photo framing.',
    '- Change nothing except the hairstyle and the hairline.',
    '- Do not beautify, slim, retouch or alter the face in any way.',
    '- Produce a photorealistic result, not an illustration.',
    ...detail.map((d) => '- ' + d),
  ].join('\n');
}

/** Camino 1: backend propio. */
async function viaServer(imageBase64, mimeType, prompt) {
  const res = await fetch('/api/tryon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType, prompt, model: DEFAULT_MODEL }),
  });

  if (res.ok) return (await res.json()).image;

  let payload = {};
  try {
    payload = await res.json();
  } catch {
    /* respuesta no-JSON: se trata como servidor ausente */
  }
  // 404/501 => no hay backend o no tiene key: se puede intentar con key propia.
  const err = new Error(payload.error || `El servidor respondió ${res.status}.`);
  err.needsOwnKey = res.status === 404 || res.status === 501 || payload.needsOwnKey === true;
  throw err;
}

/** Camino 2: key propia del usuario, directo contra Google. */
async function viaOwnKey(imageBase64, mimeType, prompt, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  let result;
  try {
    result = await ai.interactions.create({
      model: DEFAULT_MODEL,
      input: [
        { type: 'text', text: prompt },
        { type: 'image', mime_type: mimeType, data: imageBase64 },
      ],
      response_modalities: ['IMAGE'],
    });
  } catch {
    result = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
    });
  }

  const img = extractImage(result);
  if (!img)
    throw new Error(
      'El modelo respondió pero no devolvió ninguna imagen. Suele pasar si el filtro de seguridad bloquea fotos de personas: probá con otra foto.'
    );
  return `data:${img.mime};base64,${img.data}`;
}

function extractImage(result) {
  if (result?.output_image?.data)
    return { data: result.output_image.data, mime: result.output_image.mime_type || 'image/png' };
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    const mime = node.mime_type || node.mimeType;
    if (typeof node.data === 'string' && node.data.length > 512 && String(mime || '').startsWith('image/'))
      return { data: node.data, mime };
    const inline = node.inlineData || node.inline_data;
    if (inline?.data)
      return { data: inline.data, mime: inline.mimeType || inline.mime_type || 'image/png' };
    for (const v of Object.values(node)) {
      const hit = Array.isArray(v) ? v.map(walk).find(Boolean) : walk(v);
      if (hit) return hit;
    }
    return null;
  };
  return walk(result);
}

/**
 * @returns {Promise<string>} data URL de la imagen generada
 * @throws  error con `.needsOwnKey = true` si no hay forma de generar sin que
 *          el usuario ponga su propia key
 */
export async function generateTryOn(imageBase64, mimeType, haircut, gender, attrs) {
  const prompt = buildPrompt(haircut, gender, attrs);
  const ownKey = getApiKey();

  try {
    return await viaServer(imageBase64, mimeType, prompt);
  } catch (serverErr) {
    if (!ownKey) throw serverErr;
    // Hay key propia guardada: se intenta ese camino antes de darse por vencido.
    try {
      return await viaOwnKey(imageBase64, mimeType, prompt, ownKey);
    } catch (keyErr) {
      throw new Error(keyErr?.message || serverErr?.message || 'No se pudo generar la imagen.');
    }
  }
}

/**
 * Función serverless de Vercel: genera la prueba virtual del corte.
 *
 * Existe para que la API key viva en el servidor (variable de entorno
 * GEMINI_API_KEY) y el usuario final no tenga que conseguir ninguna. La app
 * igual soporta que alguien ponga su propia key desde el teléfono: en ese caso
 * no pasa por acá y le pega directo a Google.
 *
 * Configurar en Vercel:  Settings → Environment Variables → GEMINI_API_KEY
 */
import { GoogleGenAI } from '@google/genai';

const MODELS = new Set([
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
]);

/**
 * Lee el cuerpo de la petición.
 *
 * En algunos entornos Vercel ya deja el JSON parseado en req.body, y en otros
 * llega el stream crudo. Se contemplan los dos casos en vez de asumir uno: si
 * se asume el parseado y llega el stream, la función falla con "faltan
 * parámetros" y el error no dice nada sobre la causa real.
 */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/** Busca el bloque de imagen en la respuesta, tolerando variantes de forma. */
function extractImage(result) {
  if (result?.output_image?.data) {
    return { data: result.output_image.data, mime: result.output_image.mime_type || 'image/png' };
  }
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Usá POST.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // 501 y no 500: le dice a la app que el servidor no tiene key configurada,
    // así ofrece la opción de usar una propia en vez de mostrar un error seco.
    res.status(501).json({ error: 'El servidor no tiene GEMINI_API_KEY configurada.', needsOwnKey: true });
    return;
  }

  const { imageBase64, mimeType, prompt, model } = await readBody(req);
  if (!imageBase64 || !prompt) {
    res.status(400).json({ error: 'Faltan imageBase64 o prompt.' });
    return;
  }
  const chosen = MODELS.has(model) ? model : 'gemini-3.1-flash-image';

  try {
    const ai = new GoogleGenAI({ apiKey });
    let result;
    try {
      result = await ai.interactions.create({
        model: chosen,
        input: [
          { type: 'text', text: prompt },
          { type: 'image', mime_type: mimeType || 'image/jpeg', data: imageBase64 },
        ],
        response_modalities: ['IMAGE'],
      });
    } catch {
      result = await ai.models.generateContent({
        model: chosen,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } }],
          },
        ],
      });
    }

    const img = extractImage(result);
    if (!img) {
      res.status(502).json({
        error:
          'El modelo no devolvió ninguna imagen. Suele pasar cuando el filtro de seguridad bloquea fotos de personas: probá con otra foto.',
      });
      return;
    }
    res.status(200).json({ image: `data:${img.mime};base64,${img.data}` });
  } catch (err) {
    res.status(502).json({ error: err?.message || 'Falló la generación de la imagen.' });
  }
}

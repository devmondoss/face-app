/**
 * Service worker: deja la app 100% usable sin conexión.
 *
 * El detector pesa ~4 MB entre el modelo y el WASM. Se cachea la primera vez
 * y después la app abre offline, que es lo que hace que sirva de verdad como
 * app de teléfono.
 *
 * Estrategia:
 *  - navegación  → red primero, cache como respaldo (así una versión nueva
 *                  desplegada se ve enseguida, pero sin internet igual abre).
 *  - resto       → cache primero (los assets de Vite llevan hash en el nombre,
 *                  así que nunca quedan viejos).
 */

// Ambos marcadores los reemplaza el plugin sw-precache de vite.config.js al
// compilar. Hace falta inyectar la lista de assets porque llevan hash en el
// nombre, y sobre todo porque en la PRIMERA carga el service worker todavía no
// controla la página: sus pedidos de JS y CSS no pasan por el fetch handler y
// nunca se cachearían solos. Sin esto la app no abre sin conexión.
const BUILD_ASSETS = /*__BUILD_ASSETS__*/ [];
const CACHE = 'faceapp-' + (/*__BUILD_ID__*/ 'dev');

const BASE = new URL('./', self.registration.scope).pathname;

const PRECACHE = [
  BASE,
  ...BUILD_ASSETS.map((a) => BASE + a),
  BASE + 'manifest.webmanifest',
  BASE + 'icons/icon.svg',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'models/face_landmarker.task',
  // Solo los pesos que la interfaz usa de verdad en la primera pantalla; el
  // resto lo cachea el fetch handler cuando hagan falta.
  BASE + 'fonts/poppins-400-latin.woff2',
  BASE + 'fonts/poppins-500-latin.woff2',
  BASE + 'fonts/poppins-600-latin.woff2',
  BASE + 'wasm/vision_wasm_internal.js',
  BASE + 'wasm/vision_wasm_internal.wasm',
  BASE + 'wasm/vision_wasm_nosimd_internal.js',
  BASE + 'wasm/vision_wasm_nosimd_internal.wasm',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // addAll es todo-o-nada; se cachea de a uno para que un 404 suelto no
      // tire abajo la instalación entera.
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Las llamadas a la API de imágenes nunca se cachean ni se interceptan.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match(BASE)))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
    )
  );
});

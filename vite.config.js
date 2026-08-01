import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Inyecta en dist/sw.js la lista de assets compilados y un id de build.
 *
 * Los assets llevan hash en el nombre, así que el service worker no puede
 * conocerlos de antemano. Y no alcanza con cachearlos al vuelo: en la primera
 * visita el worker todavía no controla la página, así que los pedidos de JS y
 * CSS no pasan por su fetch handler. Sin precarga explícita, la app no abre
 * offline hasta la segunda visita.
 *
 * El id de build va en el nombre de la caché para que un despliegue nuevo
 * descarte la anterior en vez de servir archivos viejos.
 */
function swPrecache() {
  let assets = [];
  let outDir = 'dist';
  return {
    name: 'sw-precache',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle(_options, bundle) {
      assets = Object.keys(bundle).filter((f) => /\.(js|css)$/.test(f));
    },
    closeBundle() {
      const swPath = resolve(outDir, 'sw.js');
      if (!existsSync(swPath)) return;
      const buildId = createHash('sha256').update(assets.join('|')).digest('hex').slice(0, 8);
      const src = readFileSync(swPath, 'utf8')
        .replace('/*__BUILD_ASSETS__*/ []', JSON.stringify(assets))
        .replace("/*__BUILD_ID__*/ 'dev'", JSON.stringify(buildId));
      writeFileSync(swPath, src);
      console.log(`  sw.js: ${assets.length} assets precargados (build ${buildId})`);
    },
  };
}

export default defineConfig({
  // Rutas relativas: así el build anda igual servido desde la raíz de un
  // dominio, desde un subdirectorio o abierto con un servidor estático local.
  base: './',
  // HTTPS con certificado autofirmado. Sin esto el celular no deja usar la
  // cámara cuando entrás por la IP de la red local.
  plugins: [basicSsl(), swPrecache()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    // El .task del detector pesa 3,7 MB; el aviso de chunk grande solo hace ruido.
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: 0,
  },
});

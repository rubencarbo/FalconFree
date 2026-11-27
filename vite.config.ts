import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// VITE_ARTIFACT=1 genera la versión de un solo archivo (sin service worker)
const artifact = process.env.VITE_ARTIFACT === '1';

export default defineConfig({
  build: { chunkSizeWarningLimit: 3000 },
  plugins: artifact
    ? []
    : [
        VitePWA({
          registerType: 'prompt',
          injectRegister: null, // el registro lo hace src/pwa.ts
          includeAssets: ['icon.svg', 'icons/apple-touch-icon.png'],
          workbox: {
            globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
            globIgnores: ['screenshots/**'],
            maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
            navigateFallback: '/index.html',
            cleanupOutdatedCaches: true,
            clientsClaim: true,
            // Mapas del mundo real: se guardan al descargarlos la primera vez (para jugar sin conexión)
            runtimeCaching: [{ urlPattern: /\/real\/.*\.dat$/, handler: 'CacheFirst', options: { cacheName: 'real-maps', expiration: { maxEntries: 8 } } }],
          },
          manifest: {
            id: '/',
            name: 'FalconSky',
            short_name: 'FalconSky',
            description: 'Vuela un caza sobre ciudades vóxel, compite contra el reloj y juega con amigos.',
            lang: 'es',
            start_url: '/?source=pwa',
            scope: '/',
            display: 'fullscreen',
            display_override: ['fullscreen', 'standalone'],
            orientation: 'any',
            background_color: '#14213a',
            theme_color: '#14213a',
            categories: ['games', 'entertainment'],
            icons: [
              { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
              { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            ],
            screenshots: [
              { src: '/screenshots/narrow.png', sizes: '390x844', type: 'image/png', form_factor: 'narrow', label: 'Batalla en el móvil' },
              { src: '/screenshots/wide.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide', label: 'Combate aéreo sobre la Metrópolis' },
            ],
            shortcuts: [
              { name: 'Vuelo libre', url: '/?mode=free', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
              { name: 'Desafío diario', url: '/?mode=daily', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
            ],
          },
        }),
      ],
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';

const persistPath = process.env.MZ_PERSIST_PATH;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(persistPath ? { persistState: { path: persistPath } } : {}),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      includeAssets: ['icons/*.png', 'favicon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 900 },
});

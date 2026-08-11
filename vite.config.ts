import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Restaurant Tracker',
        short_name: 'Restaurants',
        description: 'Private restaurant log for Dorn and Sara',
        theme_color: '#18181b',
        background_color: '#18181b',
        display: 'standalone',
        start_url: '/',
        // TODO: swap in real 192/512 PNGs (and an apple-touch-icon for iOS's
        // add-to-home-screen, which ignores manifest icons) before this
        // matters for real — the SVG placeholder is enough to make the app
        // installable in the meantime.
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        // App shell + static assets only — restaurant/visit data lives in
        // PowerSync's local SQLite store, not the service worker cache.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
  optimizeDeps: {
    // PowerSync's web SDK ships a WASM SQLite build that Vite shouldn't pre-bundle.
    exclude: ['@powersync/web'],
  },
  worker: {
    format: 'es',
  },
})

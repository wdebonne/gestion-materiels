import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' et non 'autoUpdate' : l'application ne doit pas se recharger
      // toute seule pendant qu'un agent remplit un formulaire.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Gestion Matériels',
        short_name: 'GestMat',
        description: 'Application de gestion de matériel municipal',
        theme_color: '#0284c7',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Jamais en cache, et avant la règle générale qui garderait tout
            // `/api/` 24 h : un PPMS ouvert sur le poste partagé de l'accueil
            // resterait lisible dans le stockage du navigateur, et le portail
            // des entreprises n'a pas de session à y laisser.
            urlPattern: /^https?:\/\/[^/]+\/api\/(portail\/|batiments\/documents\/\d+\/fichier)/,
            handler: 'NetworkOnly'
          },
          {
            urlPattern: /^https?:\/\/.*\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              // 24 h et non 5 min : une fiche consultée le matin doit encore
              // s'ouvrir l'après-midi dans une zone sans réseau.
              expiration: { maxEntries: 300, maxAgeSeconds: 86400 }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})

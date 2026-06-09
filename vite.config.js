import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Fechamento de Caixa — Araçá Grill',
        short_name: 'Caixa AG',
        description: 'Sistema de fechamento de caixa do Araçá Grill',
        theme_color: '#0b0d13',
        background_color: '#08090d',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        lang: 'pt-BR',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/supabase\.co/, /^\/api/],
        // Cache apenas assets estáticos — NUNCA dados do Supabase ou fotos de fechamento
        runtimeCaching: [],
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2}']
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  build: {
    target: 'es2015',
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
          tesseract: ['tesseract.js']
        }
      }
    }
  }
})

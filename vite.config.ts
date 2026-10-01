import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

function neonApiPlugin() {
  return {
    name: 'neon-api-middleware',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url && req.url.startsWith('/api/')) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { handleApiRequest } = require('./api/neonHandler.cjs')
            await handleApiRequest(req, res)
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  plugins: [
    neonApiPlugin(),
    react(),
    VitePWA({
      selfDestroying: true,
      includeAssets: [
        'mathura-logo.jpeg',
        'mathura-logo.png',
        'mathura-icon.png',
        'mathura-icon-192.png',
        'mathura-icon-512.png',
        'mathura-icon-maskable-192.png',
        'mathura-icon-maskable-512.png',
        'apple-touch-icon.png',
        'mathura-favicon.png',
        'robots.txt',
      ],
      manifest: {
        name: 'Madhura Tex Barcode Studio',
        short_name: 'Barcode Studio',
        description: 'Madhura Tex Standalone Barcode Generator and Label Printing Studio',
        theme_color: '#0B2559',
        background_color: '#0B2559',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/mathura-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/mathura-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/mathura-icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/mathura-icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpeg,jpg,woff,woff2}'],
        navigateFallbackDenylist: [/^\/api/, /^\/assets\//, /\.[a-zA-Z0-9]+$/],
      },
    }),
  ],
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('jsbarcode') || id.includes('@zxing')) return 'barcode'
          if (id.includes('workbox') || id.includes('vite-plugin-pwa')) return 'pwa'
          return 'vendor'
        },
      },
    },
  },
  server: {
    allowedHosts: true,
  },
})

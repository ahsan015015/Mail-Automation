import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.API_PROXY_TARGET || 'http://127.0.0.1:8787'
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  root: '.',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': r('./src/client'),
      '@shared': r('./src/shared'),
    },
  },
  server: {
    host: true,
    port: Number(process.env.CLIENT_PORT || 5173),
    allowedHosts: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/t': { target: API_TARGET, changeOrigin: false },
      '/public': { target: API_TARGET, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
    assetsInlineLimit: 4096,
  },
})

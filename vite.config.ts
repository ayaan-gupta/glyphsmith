import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  // brotli-wasm ships a .wasm that must be served as a file, not pre-bundled.
  optimizeDeps: { exclude: ['brotli-wasm'] },
  build: { target: 'es2022' },
})

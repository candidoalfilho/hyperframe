import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@hyperframe/engine': fileURLToPath(
        new URL('../../packages/engine/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5183,
    strictPort: true,
  },
  clearScreen: false,
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  worker: {
    format: 'es',
  },
})

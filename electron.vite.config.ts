import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), 'mcp-tareas': resolve(__dirname, 'src/main/mcp-tareas.ts') } } },
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
    resolve: { alias: { '@shared': shared } },
    plugins: [react()]
  }
})

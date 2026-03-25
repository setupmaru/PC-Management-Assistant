import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'

loadEnv()

const root = resolve(__dirname, 'src/renderer')
const distElectron = resolve(__dirname, 'dist-electron')

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: resolve(__dirname, 'src/main/main.ts'),
        vite: {
          define: {
            __EMBEDDED_API_KEY__: JSON.stringify(process.env.EMBEDDED_API_KEY || ''),
          },
          build: {
            outDir: distElectron,
            sourcemap: false,
            rollupOptions: {
              external: ['electron', 'electron-updater'],
              output: {
                // 단일 파일로 출력 (chunk 분리 방지)
                inlineDynamicImports: true,
                entryFileNames: 'main.js',
              },
            },
          },
        },
      },
      {
        entry: resolve(__dirname, 'src/preload/preload.ts'),
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: distElectron,
            sourcemap: false,
            rollupOptions: {
              external: ['electron'],
              output: {
                inlineDynamicImports: true,
                entryFileNames: 'preload.js',
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': root,
      '@main': resolve(__dirname, 'src/main'),
    },
  },
  root,
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})

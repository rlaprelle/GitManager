import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { contentSecurityPolicy } from './config/contentSecurityPolicy'

export default defineConfig({
  plugins: [vue(), tailwindcss(), contentSecurityPolicy()],
  build: {
    // Never inline assets as data: URLs: the content security policy only allows the app's own files.
    assetsInlineLimit: 0,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

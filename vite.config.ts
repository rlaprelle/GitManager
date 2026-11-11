import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { contentSecurityPolicy } from './config/contentSecurityPolicy'

export default defineConfig({
  plugins: [vue(), tailwindcss(), contentSecurityPolicy()],
  build: {
    // Keep fonts as files: an inlined data: font would be blocked by the policy's font-src 'self'.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

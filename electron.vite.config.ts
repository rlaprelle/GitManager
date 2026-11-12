import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'
import viteConfig from './vite.config.ts'

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// The Vue app keeps its browser-mode layout (index.html + src/ at the root), so
// every entry is set explicitly instead of electron-vite's src/{main,preload,renderer}.
// Main and preload import shared code from src/, which uses the same @/ alias as the app.
const sharedAlias = { alias: { '@': fromRoot('src') } }

export default defineConfig({
  main: {
    resolve: sharedAlias,
    build: {
      rolldownOptions: {
        input: { index: fromRoot('electron/main/index.ts') },
      },
    },
  },
  preload: {
    resolve: sharedAlias,
    build: {
      rolldownOptions: {
        input: { index: fromRoot('electron/preload/index.ts') },
        // Sandboxed preloads can't be ES modules; this emits out/preload/index.cjs.
        output: { format: 'cjs' },
      },
    },
  },
  renderer: {
    // Same plugins, build options and @/ alias as browser mode, so both builds compile one app.
    ...viteConfig,
    root: '.',
    build: {
      ...viteConfig.build,
      rolldownOptions: {
        input: { index: fromRoot('index.html') },
      },
    },
  },
})

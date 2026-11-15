import { defineConfig } from '@playwright/test'

// Drives the built desktop app (out/), so `npm run test:e2e:app` builds first.
// No web server: each test launches Electron itself.
export default defineConfig({
  testDir: './e2e-electron',
  reporter: 'list',
  // One Electron instance at a time keeps launches predictable on Windows.
  workers: 1,
  use: {
    trace: 'retain-on-failure',
  },
})

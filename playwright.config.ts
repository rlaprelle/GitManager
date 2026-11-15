import { defineConfig, devices } from '@playwright/test'

// Uncommon port so the test server never collides with other local Vite apps.
const PORT = 4317

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Always start our own server: reusing one risks testing a different app on the same port.
    reuseExistingServer: false,
  },
})

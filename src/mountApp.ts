import { createApp } from 'vue'
// Fonts ship with the app (the desktop build must work offline); one variable file covers every weight.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './style.css'
import App from './App.vue'
import GitRequired from './components/GitRequired.vue'
import type { GitDataSource } from './services/GitDataSource'
import type { GitStatus } from './types/bridge'

// Shared by the two entry points: main.ts (browser, sample data) and desktop.ts (installed git).

export interface AppOptions {
  source: GitDataSource
  comparePaths: { left: string; right: string }
}

export function mountApp(options: AppOptions): void {
  createApp(App, { ...options }).mount('#app')
}

export function mountGitRequired(status: Exclude<GitStatus, { state: 'ready' }>): void {
  createApp(GitRequired, { status }).mount('#app')
}

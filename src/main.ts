import { createApp } from 'vue'
// Fonts ship with the app (the desktop build must work offline); one variable file covers every weight.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './style.css'
import App from './App.vue'
import { SAMPLE_COMPARE_PATHS } from './data/sampleRepositories'
import { MockGitDataSource } from './services/MockGitDataSource'

createApp(App, {
  source: new MockGitDataSource(),
  comparePaths: SAMPLE_COMPARE_PATHS,
}).mount('#app')

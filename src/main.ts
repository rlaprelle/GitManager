import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { SAMPLE_COMPARE_PATHS } from './data/sampleRepositories'
import { MockGitDataSource } from './services/MockGitDataSource'

createApp(App, {
  source: new MockGitDataSource(),
  comparePaths: SAMPLE_COMPARE_PATHS,
}).mount('#app')

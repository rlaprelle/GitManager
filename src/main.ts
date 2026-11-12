// Browser entry (index.html): the app on the built-in sample repositories.
import { SAMPLE_COMPARE_PATHS } from './data/sampleRepositories'
import { mountApp } from './mountApp'
import { MockGitDataSource } from './services/MockGitDataSource'

mountApp({ source: new MockGitDataSource(), comparePaths: SAMPLE_COMPARE_PATHS, writable: true })

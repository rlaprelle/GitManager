import { SAMPLE_COMPARE_PATHS } from '@/data/sampleRepositories'
import { MockGitDataSource } from '../MockGitDataSource'
import { describeGitDataSourceContract } from './gitDataSourceContract'

describeGitDataSourceContract('MockGitDataSource', async () => ({
  source: new MockGitDataSource(),
  comparePaths: SAMPLE_COMPARE_PATHS,
}))

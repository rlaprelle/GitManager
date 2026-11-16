import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { SAMPLE_COMPARE_PATHS, sampleRepositories } from '@/data/sampleRepositories'
import { sampleCompareDiff } from '@/data/sampleDiffs'
import type { DiffMode } from '@/composables/useGitManager'
import { sampleHistoryPage } from '@/services/MockGitDataSource'
import PaneDivider from '../../PaneDivider.vue'
import DiffPanel from '../DiffPanel.vue'
import type { CompareView } from '../ComparePathInputs.vue'

const inventory = sampleRepositories[0]!
const history = sampleHistoryPage(inventory, 200).commits
const expiryCommit = { ...history[0]!, files: inventory.commits[0]!.files }
const skuCommit = { ...history[3]!, files: inventory.commits[3]!.files }

type PanelOverrides = Partial<{
  compareOpen: boolean
  diffMode: DiffMode
  commitIndex: number
  filesLoading: boolean
  diffLoading: boolean
  diffMessage: string | null
}>

function mountPanel(overrides: PanelOverrides = {}) {
  const commit = overrides.commitIndex === 3 ? skuCommit : expiryCommit
  const compareOpen = overrides.compareOpen ?? false
  const filesLoading = overrides.filesLoading ?? false
  // As in useGitManager: a diff starts loading only once the file list has arrived.
  const diffLoading = overrides.diffLoading ?? false
  return mount(DiffPanel, {
    props: {
      commit,
      files: filesLoading ? [] : commit.files.map(({ path, status }) => ({ path, status })),
      filesLoading,
      diffLoading,
      selectedFileIndex: 0,
      compareOpen,
      diffMode: overrides.diffMode ?? (compareOpen ? 'simple' : 'git'),
      hunks: compareOpen ? sampleCompareDiff : diffLoading || filesLoading ? [] : commit.files[0]!.hunks,
      compareView: compareView(),
      compareLabels: { left: 'application.yml', right: 'application-prod.yml' },
      diffMessage: overrides.diffMessage ?? null,
    },
  })
}

function compareView(overrides: Partial<CompareView> = {}): CompareView {
  return {
    leftSide: { repoId: null, branch: null, path: SAMPLE_COMPARE_PATHS.left, fileId: null },
    rightSide: { repoId: null, branch: 'main', path: 'pom.xml', fileId: null },
    leftBranches: ['main', 'origin/release/2.4'],
    rightBranches: ['main', 'origin/release/2.4'],
    repositories: [
      { id: 'inventory', name: 'inventory-service' },
      { id: 'pricing', name: 'pricing-api' },
    ],
    openRepoId: 'inventory',
    canChooseFiles: false,
    ...overrides,
  }
}

function buttonByText(wrapper: ReturnType<typeof mountPanel>, text: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(text))!
}

describe('DiffPanel in commit mode', () => {
  it('titles the panel with the commit and lists its files', () => {
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('Changes in 9f3a1c2 · Add reservation expiry job')
    expect(wrapper.text()).toContain('2 files changed')
    expect(wrapper.text()).toContain('ReservationExpiryJob.java')
  })

  it('shows the git diff with a hunk header and added lines', () => {
    const wrapper = mountPanel()
    const diff = wrapper.get('[data-testid="unified-diff"]')
    expect(diff.get('[data-kind="hunk"]').text()).toBe('@@ -0,0 +1,24 @@')
    expect(diff.findAll('[data-kind="add"]')).toHaveLength(24)
  })

  it('labels the simple diff with the parent and the commit', () => {
    const wrapper = mountPanel({ commitIndex: 3, diffMode: 'simple' })
    expect(wrapper.get('[data-testid="left-label"]').text()).toBe('SkuLookup.java @ 2d6e914^')
    expect(wrapper.get('[data-testid="right-label"]').text()).toBe('SkuLookup.java @ 2d6e914')
  })

  it('shows loading messages while the commit’s files load', () => {
    const wrapper = mountPanel({ filesLoading: true })
    expect(wrapper.text()).toContain('Changes in 9f3a1c2 · Add reservation expiry job')
    expect(wrapper.text()).toContain('Loading files…')
    expect(wrapper.text()).toContain('Loading diff…')
  })

  it('shows a loading message instead of the diff while it loads', () => {
    const wrapper = mountPanel({ diffLoading: true })
    expect(wrapper.text()).toContain('2 files changed')
    expect(wrapper.text()).toContain('Loading diff…')
    expect(wrapper.find('[data-testid="unified-diff"]').exists()).toBe(false)
  })

  it('shows a renamed file with an R and where it came from, and labels the left side with its old name', () => {
    const wrapper = mount(DiffPanel, {
      props: {
        commit: expiryCommit,
        files: [{ path: 'docs/guide.md', status: 'R' as const, oldPath: 'GUIDE.md' }],
        filesLoading: false,
        diffLoading: false,
        selectedFileIndex: 0,
        compareOpen: false,
        diffMode: 'simple' as DiffMode,
        hunks: [{ oldStart: 1, newStart: 1, context: '', lines: ['-old', '+new'] }],
        compareView: compareView(),
        compareLabels: { left: '', right: '' },
      },
    })
    const row = wrapper.get('button[aria-pressed="true"]')
    expect(row.text()).toContain('R')
    expect(row.text()).toContain('guide.md')
    expect(row.text()).toContain('renamed from GUIDE.md')
    expect(wrapper.get('[data-testid="left-label"]').text()).toBe('GUIDE.md @ 9f3a1c2^')
    expect(wrapper.get('[data-testid="right-label"]').text()).toBe('guide.md @ 9f3a1c2')
  })

  it('labels the left side of a newly added file as a new file', () => {
    const wrapper = mountPanel({ diffMode: 'simple' })
    expect(wrapper.get('[data-testid="left-label"]').text()).toBe('(new file)')
  })

  it.each(['git', 'simple'] as const)('shows the diff message instead of the %s diff', (diffMode) => {
    const wrapper = mountPanel({ diffMode, diffMessage: 'No text changes to show' })
    expect(wrapper.text()).toContain('No text changes to show')
    expect(wrapper.find('[data-testid="unified-diff"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="side-by-side-diff"]').exists()).toBe(false)
  })

  it('emits file selection, diff mode changes and compare', async () => {
    const wrapper = mountPanel()
    await buttonByText(wrapper, 'application.yml').trigger('click')
    await buttonByText(wrapper, 'Simple diff').trigger('click')
    await buttonByText(wrapper, 'Compare two files').trigger('click')
    expect(wrapper.emitted('selectFile')).toEqual([[1]])
    expect(wrapper.emitted('setDiffMode')).toEqual([['simple']])
    expect(wrapper.emitted('openCompare')).toHaveLength(1)
  })
})

describe('DiffPanel without a commit', () => {
  function mountEmpty(emptyMessage: string) {
    return mount(DiffPanel, {
      props: {
        commit: undefined,
        emptyMessage,
        files: [],
        filesLoading: false,
        diffLoading: false,
        selectedFileIndex: 0,
        compareOpen: false,
        diffMode: 'git' as DiffMode,
        hunks: [],
        compareView: compareView(),
        compareLabels: { left: '', right: '' },
      },
    })
  }

  it('keeps its place and shows why there is no diff, still offering compare', () => {
    const wrapper = mountEmpty('No commits yet')
    expect(wrapper.get('section[aria-label="Diff viewer"]').text()).toContain('No commits yet')
    expect(wrapper.text()).not.toContain('Changes in')
    expect(wrapper.text()).not.toContain('files changed')
    expect(buttonByText(wrapper, 'Compare two files')).toBeTruthy()
  })
})

describe('DiffPanel in compare mode', () => {
  it('replaces the file list with each side’s repository, version and file', () => {
    const wrapper = mountPanel({ compareOpen: true })
    expect(wrapper.text()).not.toContain('files changed')
    expect(wrapper.get<HTMLInputElement>('#gm-left').element.value).toBe(SAMPLE_COMPARE_PATHS.left)
    expect(wrapper.get<HTMLInputElement>('#gm-right').element.value).toBe('pom.xml')
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Left file: version"]').element.value).toBe('')
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Right file: version"]').element.value).toBe('main')
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Left file: repository"]').element.value).toBe('inventory')
  })

  it('offers Browse… for a branch’s files, and for the working tree only where there is a file picker', async () => {
    const browserBuild = mountPanel({ compareOpen: true })
    expect(browserBuild.find('button[aria-label="Browse for the left file"]').exists()).toBe(false)
    await browserBuild.get('button[aria-label="Browse for the right file"]').trigger('click')
    expect(browserBuild.emitted('browseBranchFiles')).toEqual([['right']])
  })

  it('emits version and repository changes per side', async () => {
    const wrapper = mountPanel({ compareOpen: true })
    await wrapper.get('select[aria-label="Left file: version"]').setValue('origin/release/2.4')
    await wrapper.get('select[aria-label="Right file: version"]').setValue('')
    await wrapper.get('select[aria-label="Right file: repository"]').setValue('pricing')
    expect(wrapper.emitted('compareBranch')).toEqual([
      ['left', 'origin/release/2.4'],
      ['right', null],
    ])
    expect(wrapper.emitted('compareRepository')).toEqual([['right', 'pricing']])
  })

  it('disables the git diff and explains why', () => {
    const wrapper = mountPanel({ compareOpen: true })
    expect(buttonByText(wrapper, 'Git diff').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('isn’t available for two separate files')
  })

  it('labels the columns with the two file names', () => {
    const wrapper = mountPanel({ compareOpen: true })
    expect(wrapper.get('[data-testid="left-label"]').text()).toBe('application.yml')
    expect(wrapper.get('[data-testid="right-label"]').text()).toBe('application-prod.yml')
  })

  it('emits path changes, swap and back', async () => {
    const wrapper = mountPanel({ compareOpen: true })
    await wrapper.get('#gm-left').setValue('C:\\other.yml')
    await wrapper.get('button[aria-label="Swap left and right files"]').trigger('click')
    await buttonByText(wrapper, 'Back to 9f3a1c2').trigger('click')
    expect(wrapper.emitted('comparePath')).toEqual([['left', 'C:\\other.yml']])
    expect(wrapper.emitted('swap')).toHaveLength(1)
    expect(wrapper.emitted('closeCompare')).toHaveLength(1)
  })
})

describe('DiffPanel file list divider', () => {
  it('sits beside the file list, and passes resizes and resets up', () => {
    const wrapper = mountPanel()
    const divider = wrapper.getComponent(PaneDivider)
    expect(divider.props('label')).toBe('Resize the file list')
    divider.vm.$emit('resize', 250)
    divider.vm.$emit('reset')
    expect(wrapper.emitted('resizeFileList')).toEqual([[250]])
    expect(wrapper.emitted('resetFileList')).toHaveLength(1)
  })

  it('isn’t there while comparing, which has no file list', () => {
    expect(mountPanel({ compareOpen: true }).findComponent(PaneDivider).exists()).toBe(false)
  })
})

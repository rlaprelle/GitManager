import type { SampleCommit, SampleFileChange, SampleRepository } from './sampleTypes'
import {
  checkoutServiceDiff,
  ciCacheDiff,
  distrolessDiff,
  expiryJobDiff,
  gitignoreIdeDiff,
  healthEndpointsDiff,
  paginateItemsDiff,
  pomBumpDiff,
  pricingClientDiff,
  readmeSetupDiff,
  reservationConfigDiff,
  reservationEntityDiff,
  reservationRepositoryDiff,
  skuLookupDiff,
  skuLookupTestDiff,
} from './sampleDiffs'

/** The design's "today" was Nov 10. Dates are stored relative to now, so the screen reads the same any day. */
const LOADED_AT = new Date()

/** ISO time `days` calendar days before today, at local `time` ('HH:MM'). */
function daysAgo(days: number, time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  const date = new Date(LOADED_AT.getFullYear(), LOADED_AT.getMonth(), LOADED_AT.getDate() - days, hours, minutes)
  return date.toISOString()
}

function minutesAgo(minutes: number): string {
  return new Date(LOADED_AT.getTime() - minutes * 60_000).toISOString()
}

type LinearCommit = Omit<SampleCommit, 'parents'>

/** Single-line history: each commit's parent is the next one, and the last is the root. */
function linearHistory(commits: LinearCommit[]): SampleCommit[] {
  return commits.map((commit, index) => ({ ...commit, parents: index + 1 < commits.length ? [commits[index + 1]!.hash] : [] }))
}

const SKU_FIX_FILES: SampleFileChange[] = [
  { path: 'src/main/java/com/example/inventory/catalog/SkuLookup.java', status: 'M', hunks: skuLookupDiff },
  { path: 'src/test/java/com/example/inventory/catalog/SkuLookupTest.java', status: 'M', hunks: skuLookupTestDiff },
]

const inventoryService: SampleRepository = {
  id: 'inventory',
  name: 'inventory-service',
  path: 'C:\\dev\\inventory-service',
  currentBranch: 'feature/stock-reservations',
  changedFileCount: 3,
  lastFetch: minutesAgo(12),
  localBranches: [
    { name: 'feature/stock-reservations', ahead: 2, behind: 0, tipHash: '9f3a1c2' },
    { name: 'main', ahead: 0, behind: 0, tipHash: 'c81f5a3' },
    { name: 'bugfix/sku-null-check', ahead: 0, behind: 0, tipHash: '2d6e914' },
  ],
  remoteBranches: [
    { name: 'origin/main', tipHash: 'c81f5a3' },
    { name: 'origin/bugfix/sku-null-check', tipHash: '2d6e914' },
    { name: 'origin/feature/stock-reservations', tipHash: 'a07c3be' },
    { name: 'origin/release/2.4', tipHash: 'e5d9a72' },
  ],
  commits: [
    {
      hash: '9f3a1c2',
      message: 'Add reservation expiry job',
      author: 'You',
      date: daysAgo(0, '11:42'),
      refs: ['feature/stock-reservations'],
      parents: ['4e7b0d9'],
      files: [
        {
          path: 'src/main/java/com/example/inventory/reservation/ReservationExpiryJob.java',
          status: 'A',
          hunks: expiryJobDiff,
        },
        { path: 'src/main/resources/application.yml', status: 'M', hunks: reservationConfigDiff },
      ],
    },
    {
      hash: '4e7b0d9',
      message: 'Reserve stock at checkout',
      author: 'You',
      date: daysAgo(0, '09:15'),
      refs: [],
      parents: ['a07c3be'],
      files: [
        {
          path: 'src/main/java/com/example/inventory/checkout/CheckoutService.java',
          status: 'M',
          hunks: checkoutServiceDiff,
        },
      ],
    },
    {
      hash: 'c81f5a3',
      message: "Merge branch 'bugfix/sku-null-check'",
      author: 'M. Okafor',
      date: daysAgo(1, '16:20'),
      refs: ['main', 'origin/main'],
      parents: ['6b2f0e1', '2d6e914'],
      files: SKU_FIX_FILES,
    },
    {
      hash: '2d6e914',
      message: 'Guard against null SKU in lookup',
      author: 'M. Okafor',
      date: daysAgo(1, '14:03'),
      refs: ['bugfix/sku-null-check', 'origin/bugfix/sku-null-check'],
      parents: ['e5d9a72'],
      files: SKU_FIX_FILES,
    },
    {
      hash: 'a07c3be',
      message: 'Add Reservation entity and repository',
      author: 'You',
      date: daysAgo(5, '17:48'),
      refs: ['origin/feature/stock-reservations'],
      parents: ['6b2f0e1'],
      files: [
        {
          path: 'src/main/java/com/example/inventory/reservation/Reservation.java',
          status: 'A',
          hunks: reservationEntityDiff,
        },
        {
          path: 'src/main/java/com/example/inventory/reservation/ReservationRepository.java',
          status: 'A',
          hunks: reservationRepositoryDiff,
        },
      ],
    },
    {
      hash: '6b2f0e1',
      message: 'Bump Spring Boot to 3.3.4',
      author: 'J. Lindqvist',
      date: daysAgo(5, '10:12'),
      refs: [],
      parents: ['e5d9a72'],
      files: [{ path: 'pom.xml', status: 'M', hunks: pomBumpDiff }],
    },
    {
      hash: 'e5d9a72',
      message: 'Extract pricing client',
      author: 'J. Lindqvist',
      date: daysAgo(6, '15:30'),
      refs: ['origin/release/2.4'],
      parents: ['18c4b6f'],
      files: [
        {
          path: 'src/main/java/com/example/inventory/pricing/PricingClient.java',
          status: 'A',
          hunks: pricingClientDiff,
        },
      ],
    },
    {
      hash: '18c4b6f',
      message: 'Paginate GET /items',
      author: 'You',
      date: daysAgo(7, '13:05'),
      refs: [],
      parents: ['f3a0d28'],
      files: [
        {
          path: 'src/main/java/com/example/inventory/catalog/ItemController.java',
          status: 'M',
          hunks: paginateItemsDiff,
        },
      ],
    },
    {
      hash: 'f3a0d28',
      message: 'Cache Maven dependencies in CI',
      author: 'M. Okafor',
      date: daysAgo(9, '09:40'),
      refs: [],
      parents: ['b91e6c4'],
      files: [{ path: '.github/workflows/build.yml', status: 'M', hunks: ciCacheDiff }],
    },
    {
      hash: 'b91e6c4',
      message: 'Add actuator health endpoints',
      author: 'J. Lindqvist',
      date: daysAgo(11, '11:22'),
      refs: [],
      // Older than the sample shows, so the line runs on past the last row.
      parents: ['0d4c2aa'],
      files: [{ path: 'src/main/resources/application.yml', status: 'M', hunks: healthEndpointsDiff }],
    },
  ],
}

const pricingApi: SampleRepository = {
  id: 'pricing',
  name: 'pricing-api',
  path: 'C:\\dev\\pricing-api',
  currentBranch: 'main',
  changedFileCount: 0,
  lastFetch: minutesAgo(12),
  localBranches: [{ name: 'main', ahead: 0, behind: 0, tipHash: '7c1d2e0' }],
  remoteBranches: [
    { name: 'origin/main', tipHash: '7c1d2e0' },
    { name: 'origin/develop', tipHash: 'd24c8e7' },
  ],
  commits: linearHistory([
    {
      hash: '7c1d2e0',
      message: 'Use distroless base image',
      author: 'J. Lindqvist',
      date: daysAgo(0, '10:05'),
      refs: ['main', 'origin/main'],
      files: [{ path: 'Dockerfile', status: 'M', hunks: distrolessDiff }],
    },
    {
      hash: '3a9f4b1',
      message: 'Bump Spring Boot to 3.3.4',
      author: 'J. Lindqvist',
      date: daysAgo(5, '10:30'),
      refs: [],
      files: [{ path: 'pom.xml', status: 'M', hunks: pomBumpDiff }],
    },
    {
      hash: 'd24c8e7',
      message: 'Document local setup',
      author: 'You',
      date: daysAgo(8, '16:12'),
      refs: ['origin/develop'],
      files: [{ path: 'README.md', status: 'M', hunks: readmeSetupDiff }],
    },
    {
      hash: '0b7e3f5',
      message: 'Ignore IDE files',
      author: 'M. Okafor',
      date: daysAgo(13, '09:51'),
      refs: [],
      files: [{ path: '.gitignore', status: 'M', hunks: gitignoreIdeDiff }],
    },
    {
      hash: 'e6a1d09',
      message: 'Cache Maven dependencies in CI',
      author: 'M. Okafor',
      date: daysAgo(16, '14:37'),
      refs: [],
      files: [{ path: '.github/workflows/build.yml', status: 'M', hunks: ciCacheDiff }],
    },
  ]),
}

const storefrontWeb: SampleRepository = {
  id: 'storefront',
  name: 'storefront-web',
  path: 'C:\\dev\\storefront-web',
  currentBranch: 'develop',
  changedFileCount: 1,
  lastFetch: minutesAgo(12),
  localBranches: [
    { name: 'develop', ahead: 1, behind: 0, tipHash: '5f8c2a4' },
    { name: 'main', ahead: 0, behind: 0, tipHash: '92d0f6c' },
  ],
  remoteBranches: [
    { name: 'origin/develop', tipHash: 'b3e7d10' },
    { name: 'origin/main', tipHash: '92d0f6c' },
  ],
  commits: linearHistory([
    {
      hash: '5f8c2a4',
      message: 'Ignore IDE files',
      author: 'You',
      date: daysAgo(0, '08:58'),
      refs: ['develop'],
      files: [{ path: '.gitignore', status: 'M', hunks: gitignoreIdeDiff }],
    },
    {
      hash: 'b3e7d10',
      message: 'Use distroless base image',
      author: 'J. Lindqvist',
      date: daysAgo(4, '15:44'),
      refs: ['origin/develop'],
      files: [{ path: 'Dockerfile', status: 'M', hunks: distrolessDiff }],
    },
    {
      hash: '92d0f6c',
      message: 'Document local setup',
      author: 'You',
      date: daysAgo(9, '12:20'),
      refs: ['main', 'origin/main'],
      files: [{ path: 'README.md', status: 'M', hunks: readmeSetupDiff }],
    },
  ]),
}

const buildTools: SampleRepository = {
  id: 'buildtools',
  name: 'build-tools',
  path: 'C:\\dev\\build-tools',
  currentBranch: 'main',
  changedFileCount: 0,
  lastFetch: minutesAgo(12),
  localBranches: [{ name: 'main', ahead: 0, behind: 0, tipHash: '4c6b9e2' }],
  remoteBranches: [{ name: 'origin/main', tipHash: '4c6b9e2' }],
  commits: linearHistory([
    {
      hash: '4c6b9e2',
      message: 'Cache Maven dependencies in CI',
      author: 'M. Okafor',
      date: daysAgo(6, '11:02'),
      refs: ['main', 'origin/main'],
      files: [{ path: '.github/workflows/build.yml', status: 'M', hunks: ciCacheDiff }],
    },
    {
      hash: 'a8f13d7',
      message: 'Bump Spring Boot to 3.3.4',
      author: 'J. Lindqvist',
      date: daysAgo(7, '09:17'),
      refs: [],
      files: [{ path: 'pom.xml', status: 'M', hunks: pomBumpDiff }],
    },
    {
      hash: '1e5d7c0',
      message: 'Document local setup',
      author: 'You',
      date: daysAgo(20, '17:35'),
      refs: [],
      files: [{ path: 'README.md', status: 'M', hunks: readmeSetupDiff }],
    },
  ]),
}

const dotfiles: SampleRepository = {
  id: 'dotfiles',
  name: 'dotfiles',
  path: 'C:\\dev\\dotfiles',
  currentBranch: 'main',
  changedFileCount: 0,
  lastFetch: minutesAgo(12),
  localBranches: [{ name: 'main', ahead: 0, behind: 0, tipHash: '6d2a0f8' }],
  remoteBranches: [{ name: 'origin/main', tipHash: '6d2a0f8' }],
  commits: linearHistory([
    {
      hash: '6d2a0f8',
      message: 'Ignore IDE files',
      author: 'You',
      date: daysAgo(22, '20:11'),
      refs: ['main', 'origin/main'],
      files: [{ path: '.gitignore', status: 'M', hunks: gitignoreIdeDiff }],
    },
    {
      hash: 'c47e91b',
      message: 'Document local setup',
      author: 'You',
      date: daysAgo(29, '18:40'),
      refs: [],
      files: [{ path: 'README.md', status: 'M', hunks: readmeSetupDiff }],
    },
  ]),
}

export const sampleRepositories: SampleRepository[] = [inventoryService, pricingApi, storefrontWeb, buildTools, dotfiles]

export const SAMPLE_COMPARE_PATHS = {
  left: 'C:\\dev\\inventory-service\\src\\main\\resources\\application.yml',
  right: 'C:\\dev\\inventory-service\\src\\main\\resources\\application-prod.yml',
} as const

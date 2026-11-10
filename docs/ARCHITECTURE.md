# Architecture

How Git Manager is built: the layers, the data model, the contract with git, and the rules the state layer enforces. For what the product is, see [`README.md`](../README.md). For working conventions, see [`CLAUDE.md`](../CLAUDE.md).

## Layers

```
 main.ts ──► App.vue ──► components/          presentational: props in, events out
                │
                ▼
     composables/useGitManager.ts             all UI state, derived state and actions
                │
                ▼
     services/GitDataSource.ts  (interface)   the only boundary between the UI and git
                │
                ▼
     services/MockGitDataSource.ts            today: serves data/sample*.ts in memory

     lib/diff.ts, lib/graph.ts, lib/format.ts pure functions, used by components
     types/git.ts                             shared data model
```

Each layer depends only on the layers below it.

- **Components** never call the data source, and they don't keep state that matters to another component.
- **The composable** never touches the DOM.
- **The data source** knows nothing about selection or view modes.

`App.vue` is the only place that connects the composable to the components. It destructures what `useGitManager` returns and passes each value to the component that needs it.

The same Vue app runs in two hosts. In a browser (`npm run dev`, Vitest, the browser Playwright suite) it runs on `MockGitDataSource`. In the Windows desktop app it runs inside Electron; see [Desktop shell](#desktop-shell-electron). Today both hosts use the mock. The desktop app will get its own data source, chosen at build time, so an installed app can never fall back to sample data.

There is no router and no store library. The app is a single screen, and one composable is enough state management for it. If a second screen ever needs the same state, that would be the time to lift it into Pinia.

## Tech stack

| Piece | Version | Notes |
|---|---|---|
| Vue | 3.5 | `<script setup lang="ts">` single-file components only. |
| Vite | 8 | `@vitejs/plugin-vue` 6 and `@tailwindcss/vite` 4. The `@` alias points at `src/`. |
| TypeScript | ~6.0 | Pinned below 7. TypeScript 7 is the native (Go) compiler, and `vue-tsc` 3 still depends on the JavaScript compiler API. `vue-tsc -b` type-checks through project references. |
| Tailwind CSS | 4 | Configured in CSS (`@theme` in `src/style.css`). There is no `tailwind.config.js`. |
| Vitest | 5 | Runs in jsdom, with `@vue/test-utils` 2 for component tests. |
| Playwright | 1.65 | Browser suite: Chromium at 1440×900; some tests resize to phone width or the smallest desktop size. Desktop suite: Playwright's Electron support, against the built app. |
| Electron | 45 | Windows only. |
| electron-vite | 6 | Builds main, preload and renderer from one config. Declares Vite 8 support. |
| electron-builder | 26 | NSIS installer, current user only, unsigned. |

The TypeScript config is split into project references: `tsconfig.app.json` covers app code, `tsconfig.vitest.json` covers `src/**/__tests__/*`, `tsconfig.node.json` covers the build and test configs, `e2e/` and `e2e-electron/`, and `tsconfig.electron.json` covers `electron/` (Node and Electron APIs, no DOM).

## Directory layout

```
electron/
  main/index.ts              Electron main process: window, IPC handlers
  preload/index.ts           exposes window.gitManager to the renderer (bundled as CommonJS)
  shared/channels.ts         IPC channel names used by main and preload
electron.vite.config.ts      desktop build: main, preload, renderer (reuses vite.config.ts)
electron-builder.yml         Windows installer
src/
  main.ts                    creates App with a MockGitDataSource and the sample compare paths
  App.vue                    page layout; wires useGitManager to the components
  style.css                  Tailwind import, @theme colour/font tokens, base styles
  types/git.ts               data model (see below)
  types/bridge.ts            GitManagerBridge: what the preload exposes
  services/
    GitDataSource.ts         the backend contract
    MockGitDataSource.ts     in-memory implementation over the sample data
  data/
    sampleRepositories.ts    five sample repos and SAMPLE_COMPARE_PATHS
    sampleDiffs.ts           the hunks those repos' commits reference, plus sampleCompareDiff
  composables/
    useGitManager.ts         state, derived state and actions
  lib/
    diff.ts                  hunks → unified lines, side-by-side rows; invertHunks
    graph.ts                 GraphRow → SVG segments, curves and dot
    format.ts                splitPath, syncLabel ('↑2 ↓1'), pluralize
  components/
    AppHeader.vue            repo name, branch chip, Fetch / Pull / Push
    RepositoryList.vue       repository list, "N changed" badge, Add repository
    BranchList.vue           local and remote branches, HEAD badge, Checkout
    CommitHistory.vue        commit table with the lane graph column
    CommitGraphCell.vue      one row of the graph as inline SVG
    RefBadge.vue             branch labels on a commit (head / local / remote)
    StatusBar.vue            footer status line (role="status")
    GmIcon.vue               the inline SVG icon set
    diff/
      DiffPanel.vue          the diff area: labels, mode toggle, file list, diff body
      DiffModeToggle.vue     Git diff / Simple diff
      ChangedFileList.vue    the commit's changed files
      UnifiedDiff.vue        git-style diff
      SideBySideDiff.vue     simple (two-column) diff
      ComparePathInputs.vue  left/right path inputs and the swap button
e2e/git-manager.spec.ts      Playwright acceptance tests (browser)
e2e-electron/app.spec.ts     Playwright acceptance tests (built desktop app)
```

Build output goes to `dist/` (browser), `out/` (desktop app) and `release/` (installer). All three are ignored by git.

Unit and component tests follow the layout generated by `create-vue`, Vue's official scaffolder: each source folder has a `__tests__/` folder, and `src/lib/diff.ts` is tested by `src/lib/__tests__/diff.spec.ts`. Vitest finds them with its default pattern and excludes `e2e/`.

## Data model

All types are in `src/types/git.ts`.

```
Repository
├── id, name, path, currentBranch, changedFileCount, lastFetch
├── localBranches[]   LocalBranch  { name, ahead, behind, tipHash }
├── remoteBranches[]  RemoteBranch { name, tipHash }        name like 'origin/main'
└── commits[]         Commit (newest first)
      ├── hash, message, author, date
      ├── refs[]      branch names at this commit; remote ones start with 'origin/'
      ├── graph       GraphRow { lane, top, bottom, curveInFrom, curveOutTo }
      └── files[]     FileChange { path, status: 'A'|'M'|'D', hunks[] }
                         Hunk { oldStart, newStart, context, lines[] }
```

Decisions that shape this model:

- **Branches point at commits by hash, not by index.** To select a branch, the composable looks up the commit whose `hash` equals the branch's `tipHash`. If no commit matches, it falls back to the newest commit.
- **The graph layout comes with the data.** Each commit carries a precomputed `GraphRow`, and the UI never assigns lanes itself. The graph has exactly three lanes (0–2). A row draws straight lines in its top half and bottom half separately, plus at most one curve into the dot and one curve out of it. This matches the design, but a real backend will have to compute the lane assignment, either itself or in a new `lib` function. Supporting more than three lanes means widening `LaneFlags`, `LANE_COLORS` and `GRAPH_WIDTH` together.
- **Hunk lines keep git's prefixes.** Each line starts with `'+'`, `'-'` or `' '`, exactly as in `git diff` output. `oldStart` and `newStart` are 1-based. Line counts are not stored; `hunkHeader` derives them from the lines.
- **`lastFetch` and `date` are display strings** (`'12 min ago'`), not timestamps. Formatting belongs to the backend.

## The `GitDataSource` contract

`src/services/GitDataSource.ts`:

| Method | Returns | Mock behaviour |
|---|---|---|
| `listRepositories()` | `Repository[]` | A deep copy (`structuredClone`) of the sample repos. |
| `compareFiles(left, right)` | `Hunk[]` | Always `sampleCompareDiff`, inverted when the two sample paths are swapped. |
| `checkout(repoId, branch)` | `OperationResult` | `Switched to branch X` |
| `fetch(repoId)` | `OperationResult` | `Fetched origin: no new commits` |
| `pull(repoId, branch)` | `OperationResult` | `Pulled origin/X: already up to date` |
| `push(repoId, branch)` | `OperationResult` | `Pushed X to origin/X` |

Every method is async and reports failure by rejecting. `OperationResult.message` is shown in the status bar exactly as returned.

The real implementation will live in the Electron main process, running the user's installed git, and reach the renderer through the preload bridge. The renderer side will be a `GitDataSource` that forwards each call over IPC. Nothing above the service layer needs to change.

`App.vue` wraps the source in `toRaw` before handing it to the composable. The data source is a service, not state. If a parent passes it through reactive props, unwrapping it keeps calls such as `structuredClone` working on the raw object.

## State: `useGitManager`

`useGitManager(source, { comparePaths })` returns refs, computeds and action functions.

**State:** `repositories`, `loading`, `status`, `selectedBranch`, `selectedCommitIndex`, `selectedFileIndex`, `compareOpen`, `leftPath`, `rightPath`. The selected repository id and the user's chosen diff mode are kept internally.

**Derived:**

| Value | What it is |
|---|---|
| `repository` | The selected repository, or the first one if nothing is selected. |
| `commits`, `commit`, `file` | The selected commit and file. Indexes are clamped to the list length. |
| `currentBranch` | The checked-out branch. |
| `headerSyncLabel` | `'↑2 vs origin'` for the checked-out branch, or `null` when it's in sync. |
| `diffMode` | `'simple'` whenever compare is open, otherwise the mode the user chose. |
| `activeHunks` | The compare result while comparing, otherwise the selected file's hunks. |

Behavioural rules the composable enforces. Tests cover each of them, so change them deliberately:

1. **Selecting a repository, branch or commit resets the commit view.** File selection returns to 0 and compare closes. Selecting a branch jumps to its tip commit.
2. **Compare mode forces the simple diff.** Two arbitrary files share no history, so there is no git diff to show. `setDiffMode` is ignored while compare is open. Closing compare restores the mode the user chose.
3. **Compare requests can't arrive out of order.** Each `refreshCompare` increments a counter, and a response is applied only if it belongs to the latest request.
4. **Remote operations report through `status`.** On success the status shows the source's message. On failure it shows `Failed: <reason>`, and no local state changes.
5. **Local state changes only after the source succeeds.** `checkoutBranch` sets `currentBranch`, and `fetchRemote` sets `lastFetch` to `'just now'`. Both edit the repository object in place, which is the composable's own copy from `listRepositories`.
6. **`addRepository` is a placeholder.** It only sets a status message. Choosing a folder needs a native file dialog, which belongs to whatever host replaces the mock.

## Rendering

### Diffs (`src/lib/diff.ts`)

- `toUnifiedLines(hunks)` emits a `hunk` header row for each hunk, followed by `context`, `add` or `del` rows. Each row carries its old and new line numbers. Additions have no old number and deletions have no new number.
- `toSideBySideRows(hunks)` pairs each run of deletions with the run of additions that follows it, row by row. When one side runs out, its cells are filled with `empty`. Context lines appear on both sides. Separator rows (`⋯ from line N · context`, using the hunk's new start line) come before every hunk when there is more than one hunk, or when any hunk starts after line 1 on either side.
- `invertHunks(hunks)` swaps `+` and `-` and swaps the start lines. It returns new objects and never changes its input.

`UnifiedDiff.vue` and `SideBySideDiff.vue` only render these rows. All the line logic lives in `lib/diff.ts` and is tested there.

### Commit graph (`src/lib/graph.ts`)

Each history row is 32px tall, and the graph column is 64px wide. Lane *n* is at x = 14 + 18·n. Lane colours are fixed by position (`#5b9dff`, `#f0a35e`, `#c792ea`) and don't follow the UI accent.

`graphGeometry(row)` turns a `GraphRow` into vertical segments, cubic-Bézier curves and the dot (r=5). The dot has a ring the colour of the row background, so lines appear to stop at the dot. The ring switches to the selected-row colour when the row is selected.

## Desktop shell (Electron)

```
 Electron main process (Node)          electron/main/index.ts
   │  creates the window, owns IPC handlers (later: runs git)
   │
   │  ipcMain.handle ◄──── ipcRenderer.invoke
   ▼
 Preload (sandboxed)                   electron/preload/index.ts
   │  contextBridge.exposeInMainWorld('gitManager', GitManagerBridge)
   ▼
 Renderer: the Vue app                 index.html + src/ (same code as browser mode)
```

- **The renderer is an ordinary web page.** `contextIsolation`, `sandbox` and no `nodeIntegration`: it has no `require` or `process`, and it can reach the main process only through the methods on `window.gitManager`. The window also refuses navigation and pop-ups.
- **The bridge type is shared.** `src/types/bridge.ts` defines `GitManagerBridge`; the preload implements it and the renderer will call it. Every method crosses IPC, so every method is async. Channel names are in `electron/shared/channels.ts` so main and preload can't disagree.
- **The preload is CommonJS** (`out/preload/index.cjs`) even though the project is ESM. Electron can't load an ES module as a sandboxed preload. The main process is ESM.
- **Layout is non-default for electron-vite.** It expects `src/main`, `src/preload` and `src/renderer`. We keep the browser app at the root and set every entry in `electron.vite.config.ts`, whose renderer section spreads `vite.config.ts` so both hosts compile the same app.
- **Dev vs packaged.** `npm run dev:app` serves the renderer from Vite on port 5173 (`ELECTRON_RENDERER_URL`) with hot reload. A packaged build always loads `out/renderer/index.html` from disk and ignores that variable.
- **Window size.** Sizes are content sizes (`useContentSize`). The minimum is 1024×640, the smallest size at which the layout fits without page scroll; both e2e suites check it.
- **Packaging.** `electron-builder.yml` packages only `out/**` and `package.json`. Vue is bundled into the renderer, so every npm package is a dev dependency and the installer ships no `node_modules`. The appId `com.echel.gitmanager` must match `APP_USER_MODEL_ID` in the main process.
- **User data.** Electron keeps its data in `%APPDATA%\git-manager` (named after `package.json`). The installed app and `dev:app` share it, and uninstalling leaves it behind.

## Theming and layout

- All colours are Tailwind theme tokens in `src/style.css` (`--color-gm-*`, used as `bg-gm-*`, `text-gm-*`, `border-gm-*`). Components use only these tokens, never raw hex values. The one exception is the lane colours in `lib/graph.ts`, which are drawn as SVG strokes.
- `App` accepts an optional `accent` prop, which overrides `--color-gm-accent` on the root element.
- Fonts: Inter for the interface and JetBrains Mono for code, hashes and paths, both loaded from Google Fonts in `index.html`. Offline, the desktop app falls back to system fonts.
- Layout is a flex row that wraps. The sidebar has a flex basis of 260px and the main column 560px. Below that combined width the columns stack, and below 860px the page stops being a fixed full-height window (`max-[860px]:h-auto`) and scrolls normally. The commit table keeps a minimum width of 760px and scrolls sideways inside its own pane, so the page itself never scrolls horizontally.
- Above 860px the window is fixed-height with a minimum of 640px, matching the desktop app's minimum window size. In a history row, branch badges and the message share the description column: the message gives up space first (down to 8 characters), then the badges shrink with an ellipsis and show their full name as a tooltip.

## Testing

| Layer | Where | What it proves |
|---|---|---|
| Pure logic | `src/lib/__tests__/` | Diff rows, inversion, graph geometry, formatting |
| State | `src/composables/__tests__/` | The behavioural rules above, run against a stub data source |
| Components | `src/components/**/__tests__/` | Each component renders its props and emits the right events |
| Wiring | `src/__tests__/App.spec.ts` | `App` connects composable and components (clicks reach the source; results reach the screen) |
| Acceptance | `e2e/git-manager.spec.ts` | Each capability driven through the real UI in Chromium, including the phone-width and smallest-desktop layouts |
| Desktop acceptance | `e2e-electron/app.spec.ts` | The built app opens the UI, the preload bridge reaches the main process, the renderer has no Node globals, and the minimum window fits the layout |

The browser suite runs against Vite; the desktop suite runs against `out/`, so `npm run test:e2e:app` builds first. Playwright starts its own Vite server on port 4317 with `--strictPort` and `reuseExistingServer: false`. That way it fails loudly instead of testing some other app that happens to be on the port.

Stable selectors for the tests are roles and labels first, then `data-testid`: `header-repo`, `header-branch`, `unified-diff`, `side-by-side-diff`, `left-label`, `right-label`, `commit-description`. Diff rows also expose `data-kind`, and side-by-side cells expose `data-side` and `data-cell`.

## Known limitations

- There is no real git yet. Every operation goes to `MockGitDataSource` in both hosts, and compare returns the same diff for any two paths.
- The installer is unsigned and uses Electron's default icon. There is no auto-update yet.
- Only three graph lanes are supported.
- The history isn't paginated or virtualized. `listRepositories` returns every commit up front.

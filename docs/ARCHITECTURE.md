# Architecture

How Git Manager is built: the layers, the data model, the contract with git, and the rules the state layer enforces. For what the product is, see [`README.md`](../README.md). For working conventions, see [`CLAUDE.md`](../CLAUDE.md).

## Layers

```
 main.ts / desktop.ts ──► App.vue ──► components/   presentational: props in, events out
                │
                ▼
     composables/useGitManager.ts             all UI state, derived state and actions
                │
                ▼
     services/GitDataSource.ts  (interface)   the only boundary between the UI and git
                │
                ▼
     services/MockGitDataSource.ts            browser: serves data/sample*.ts in memory
     services/IpcGitDataSource.ts             desktop: forwards each call to the main process,
                                              where electron/main/git/GitCliDataSource runs git

     lib/*.ts                                 pure functions: diff rows, graph geometry, lane
                                              layout, diff parsing, labels
     types/git.ts                             shared data model
```

Each layer depends only on the layers below it.

- **Components** never call the data source, and they don't keep state that matters to another component.
- **The composable** never touches the DOM.
- **The data source** knows nothing about selection or view modes.

`App.vue` is the only place that connects the composable to the components. It destructures what `useGitManager` returns and passes each value to the component that needs it.

The same Vue app runs in two hosts, each with its own entry point. In a browser (`index.html` → `src/main.ts`: `npm run dev`, Vitest, the browser Playwright suite) it runs on `MockGitDataSource` and the sample repositories. In the Windows desktop app (`desktop.html` → `src/desktop.ts`, built by electron-vite) it runs on `IpcGitDataSource`, which reads the user's repositories with their installed git; see [Desktop shell](#desktop-shell-electron). The desktop entry never imports the sample data, and a test checks the built bundle, so an installed app can't fall back to it. `App`'s `operations` prop lists the operations that change a repository the host offers (`RepositoryOperation`); both hosts pass all four (`ALL_OPERATIONS`), and a host that leaves one out hides its button.

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

Fonts are the Fontsource variable packages for Inter and JetBrains Mono (5.3), bundled into the build.

The TypeScript config is split into project references: `tsconfig.app.json` covers app code, `tsconfig.vitest.json` covers `src/**/__tests__/*`, `tsconfig.node.json` covers the build and test configs, `config/`, `scripts/`, `e2e/` and `e2e-electron/`, and `tsconfig.electron.json` covers `electron/` (Node and Electron APIs, no DOM). The node and electron projects map the `@/` alias too, because main-process and e2e code import shared files from `src/`.

## Directory layout

```
electron/
  main/
    index.ts                 Electron main process: window, data folder, folder picker, wiring
    ipc.ts                   one handler per channel: argument checks, IpcResult answers
    repositoryStore.ts       the user's repository list (repositories.json)
    git/
      GitCliDataSource.ts    GitDataSource over the installed git (main process)
      runGit.ts              runs git: argument list, no shell, parseable output, no prompts
      parse.ts               parsers for for-each-ref, log, diff-tree and status output
      gitVersion.ts          `git --version` → ready / too old / missing
      __tests__/fixtures.ts  throwaway repositories built with git, for tests
  preload/index.ts           exposes window.gitManager to the renderer (bundled as CommonJS)
  shared/channels.ts         IPC channel names used by main and preload
electron.vite.config.ts      desktop build: main, preload, renderer (reuses vite.config.ts)
electron-builder.yml         Windows installer
config/
  contentSecurityPolicy.ts   Vite plugin that adds the CSP <meta> tag to index.html
build/
  icon.svg, icon-small.svg   app icon artwork; icon.ico is generated from them
scripts/
  build-icon.ts              `npm run icon`: renders the SVGs at 16–256 px, writes build/icon.ico
  ico.ts                     packs PNGs into an .ico (unit-tested in scripts/__tests__/)
index.html, desktop.html     browser and desktop entry pages
src/
  main.ts                    browser entry: App on MockGitDataSource and the sample data
  desktop.ts                 desktop entry: git check, then App on IpcGitDataSource (Checkout only)
  mountApp.ts                mounts App (or the git-required screen); fonts and styles
  App.vue                    page layout; wires useGitManager to the components
  style.css                  Tailwind import, @theme colour/font tokens, base styles
  types/git.ts               data model (see below)
  types/bridge.ts            GitManagerBridge: what the preload exposes
  services/
    GitDataSource.ts         the backend contract
    MockGitDataSource.ts     in-memory implementation over the sample data
    IpcGitDataSource.ts      the desktop app's source: forwards to window.gitManager.git
    __tests__/gitDataSourceContract.ts  rules every data source must follow
  data/
    sampleTypes.ts           the sample data's whole-repository shape
    sampleRepositories.ts    five sample repos and SAMPLE_COMPARE_PATHS
    sampleDiffs.ts           the hunks those repos' commits reference, plus sampleCompareDiff
  composables/
    useGitManager.ts         state, derived state and actions
    latestLoad.ts            one async area: value, loading and failed flags, latest response wins
    useNow.ts                a clock ticking every minute, for date labels
  lib/
    diff.ts                  hunks → unified lines, side-by-side rows; invertHunks
    graph.ts                 GraphRow → SVG segments, curves and dot; lane colours and width
    laneLayout.ts            parents → GraphRow per commit (lane assignment)
    parseDiff.ts             `git diff` output → hunks
    format.ts                labels: dates, last fetch, short hash, sync, paths, plurals
  components/
    AppHeader.vue            repo name, branch chip, Fetch / Pull / Push
    RepositoryList.vue       repository list, "N changed" badge, problem, Add / Remove
    BranchList.vue           local and remote branches, HEAD badge, Checkout (remote: creates the tracking branch)
    ConfirmDialog.vue        native <dialog>: title, text, Cancel (focused) and a warning-coloured confirm
    CommitHistory.vue        commit table with the lane graph column
    CommitGraphCell.vue      one row of the graph as inline SVG
    RefBadge.vue             branch labels on a commit (head / local / remote)
    StatusBar.vue            footer status line (role="status")
    GmIcon.vue               the inline SVG icon set
    NoRepositories.vue       first run: "Add a repository to get started"
    GitRequired.vue          "Git Manager needs Git for Windows" (git missing or too old)
    diff/
      DiffPanel.vue          the diff area: labels, mode toggle, file list, diff body
      DiffModeToggle.vue     Git diff / Simple diff
      ChangedFileList.vue    the commit's changed files
      UnifiedDiff.vue        git-style diff
      SideBySideDiff.vue     simple (two-column) diff
      ComparePathInputs.vue  left/right path inputs and the swap button
e2e/git-manager.spec.ts      Playwright acceptance tests (browser)
e2e/support/pageChecks.ts    checks shared by both suites: resource origins, fonts, CSP
e2e-electron/app.spec.ts     Playwright acceptance tests (built desktop app)
```

Build output goes to `dist/` (browser), `out/` (desktop app) and `release/` (installer). All three are ignored by git.

Unit and component tests follow the layout generated by `create-vue`, Vue's official scaffolder: each source folder has a `__tests__/` folder, and `src/lib/diff.ts` is tested by `src/lib/__tests__/diff.spec.ts`. Vitest finds them with its default pattern and excludes `e2e/`.

## Data model

All types are in `src/types/git.ts`.

Each type is what one `GitDataSource` call returns, so a real repository is read only as far as the screen needs:

```
Repository    { id, name, path, currentBranch, changedFileCount, lastFetch,      listRepositories()
                problem }
Branches      { local: LocalBranch[], remote: RemoteBranch[] }                    getBranches(repo)
                LocalBranch  { name, ahead, behind, tipHash }
                RemoteBranch { name, tipHash }                  name like 'origin/main'
HistoryPage   { commits: Commit[] (newest first), hasMore }                       getHistory(repo, limit)
                Commit { hash, message, author, date,
                         refs[]  branch names at this commit; remote ones start with 'origin/'
                         graph   GraphRow { lane, top[], bottom[], curvesIn[], curvesOut[] } }
FileChange[]  { path, status: 'A'|'M'|'D'|'R', oldPath? }                         getCommitFiles(repo, hash)
Hunk[]        { oldStart, newStart, context, lines[] }                            getFileDiff(repo, hash, path)
```

The sample data is stored whole (`src/data/sampleTypes.ts`: a repository holding its branches, commits with their parents, files and hunks), and `MockGitDataSource` serves it through these calls.

Decisions that shape this model:

- **Branches point at commits by hash, not by index.** To select a branch, the composable looks up the commit whose `hash` equals the branch's `tipHash`. If no commit matches, it falls back to the newest commit.
- **The graph layout comes with the data.** Each commit carries a `GraphRow`, and the UI never assigns lanes itself. Both data sources compute it with the same function, `layoutLanes` (see [Commit graph](#commit-graph-srclibgraphts-srcliblanelayoutts)), from each commit's parents. A row lists, by lane number, its straight lines in the top and bottom halves, the lanes that curve into its dot (branches joining their parent) and the lanes its dot curves out to (a merge's extra parents). Lanes go up to 8.
- **Hashes are full.** Data sources send 40-character hashes; the UI shows seven (`shortHash`).
- **Dates are timestamps.** `Commit.date` is the ISO 8601 author date and `Repository.lastFetch` an ISO timestamp, or `null` when the repository was never fetched. The UI formats them against a clock that ticks every minute (`useNow`), so 'Today 11:42' becomes 'Yesterday 11:42' at midnight in a window left open.
- **`currentBranch` is `null` for a detached HEAD**, shown as 'detached HEAD'. Pull and push refuse without a branch.
- **`problem` explains a repository that can't be read** ('Folder not found'), so one moved folder doesn't fail the whole list.
- **Hunk lines keep git's prefixes.** Each line starts with `'+'`, `'-'` or `' '`, exactly as in `git diff` output. `oldStart` and `newStart` are 1-based. Line counts are not stored; `hunkHeader` derives them from the lines.

## The `GitDataSource` contract

`src/services/GitDataSource.ts`:

| Method | Returns | Mock (browser) | Real git (desktop, `GitCliDataSource`) |
|---|---|---|---|
| `listRepositories()` | `Repository[]` | Summaries of the sample repos. | Per stored repository: `symbolic-ref` (branch), `status --porcelain` (changed files), `FETCH_HEAD`'s time (last fetch). A missing folder or a git error becomes `problem`. |
| `getBranches(repoId)` | `Branches` | The sample repo's branches. | `for-each-ref` over `refs/heads` and `refs/remotes`, ahead/behind from the upstream; `origin/HEAD` left out. |
| `getHistory(repoId, limit)` | `HistoryPage` | The newest `limit` sample commits, without files. | `log HEAD --branches --remotes --date-order`, `limit + 1` commits to know `hasMore`; labels are branches only (no tags), local first; laid out with `layoutLanes`. |
| `getCommitFiles(repoId, hash)` | `FileChange[]` | The commit's paths and statuses. | `diff-tree --name-status -M` against the first parent (`--root` for a root commit): a moved file is one R entry with its `oldPath` (git's default 50% similarity). A type change counts as M. |
| `getFileDiff(repoId, hash, path)` | `Hunk[]` | That file's sample hunks. | `diff-tree -p -M` the same way, with both paths of a renamed file in the pathspec so git pairs them; parsed by `parseUnifiedDiff`. A binary file, or a rename without edits, has no hunks. |
| `compareFiles(repoId, left, right)` | `Hunk[]` | Always `sampleCompareDiff`, inverted when the sample paths are swapped. | `diff --no-index` on two paths relative to the repository, refused outside its folder. |
| `addRepository()` | `AddRepositoryResult` | Explains what the desktop app would ask for. | Native folder picker; the chosen folder's top folder (`rev-parse --show-toplevel`) is added, or the listed entry returned. |
| `removeRepository(repoId)` | `OperationResult` | Hides it for the session. | Removes it from `repositories.json`; the folder is never touched. |
| `checkout(repoId, target, options?)` | `CheckoutResult` | Really switches, in its own copy of the samples (or in repositories passed to it); a remote target adds the local branch. Never asks to confirm. | `git switch --no-guess <name>`, or `git switch --track <remote>/<name>` for `{ remote }`, after checking the name is one `for-each-ref` lists (so it can't be read as an option) and, for a remote, that no local branch has its name (`localNameOf`, longest remote name wins). From a detached HEAD whose commits no branch, remote branch or tag contains (`rev-list --count HEAD --not --branches --remotes --tags`) it answers `confirm` unless `options.leaveCommits`. Git's "would be overwritten" refusals become one line naming the files (`checkoutRefusal`). |
| `fetch(repoId)` | `OperationResult` | Stamps `lastFetch`; the sample remote has nothing new. | `fetch --all --prune`; the message compares the remote branches before and after. |
| `pull(repoId, branch)` | `OperationResult` | Clears the branch's behind count. | Fetches the upstream's remote, then `merge --ff-only` the upstream. |
| `push(repoId, branch)` | `OperationResult` | Moves `origin/branch` (and its history label) to the branch; publishes one origin lacks. | `push --porcelain` to the upstream by explicit refspec, or `push --set-upstream origin`. |

Every method is async and reports failure by rejecting, including when it's given a repository, commit or file it doesn't know. Results are copies: callers may change them without touching the source. `OperationResult.message` is shown in the status bar exactly as returned.

**Checkout.** The target is `{ local: name }` or `{ remote: name }`, never a bare string: a local branch may itself be named `origin/x`. The result is `{ kind: 'switched', branch, message }` or `{ kind: 'confirm', commitsLeft }`; `confirm` means nothing happened yet. Both sources word the message with `switchedMessage` (`src/lib/checkout.ts`): "Switched to *branch*", "…to a new branch *x*, tracking *origin/x*", plus "; *n* uncommitted changes came along" when `git status` shows any afterwards. `IpcGitDataSource` sends plain copies of the target and options, because IPC clones its arguments and a waiting checkout lives in a Vue ref (a proxy).

**Fetch, pull and push.** The source words the message, with the helpers in `src/lib/remoteOperations.ts` that both sources use: "Fetched: 2 branches updated, 1 new, 1 removed" (or "everything was up to date"), "Pulled 3 commits from origin/main" (or "Already up to date with origin/main"), "Pushed 2 commits to origin/x" (or "Nothing to push; origin/x is up to date"), "Published x to origin; it now tracks origin/x". In `GitCliDataSource`:

- **Pull** only fast-forwards the checked-out branch (it rejects any other branch, and a branch with no upstream). It is `fetch` of the upstream's remote, then `merge --ff-only`, rather than `git pull`, so the user's `pull.rebase` can't turn it into a rebase. Counts come from `rev-list` before merging: nothing behind is "Already up to date"; commits on both sides rejects with "can’t fast-forward: *x* and *origin/x* both have new commits…" and changes nothing but the fetched remote branches. Git's "would be overwritten by merge" refusal is reworded like Checkout's (`pullRefusal`).
- **Push** sends `refs/heads/x:<upstream's branch>` to the upstream's remote, so `push.default` can't send it anywhere else, and never forces. Whether anything moved comes from git's porcelain report (`=` is up to date), so an out-of-date `origin/x` here can't make it claim commits it didn't send. A `[rejected]` report becomes "*origin/x* has commits that *x* doesn’t have. Pull them first, then push again."; a hook's `[remote rejected] (reason)` becomes "the remote refused the push: *reason*". A branch with no upstream is published to `origin` (or the only remote) with `--set-upstream`.
- **Fetch** leaves FETCH_HEAD as it was when it fails. Git empties FETCH_HEAD before connecting, and `lastFetch` is FETCH_HEAD's time, so a failed fetch would otherwise read as a fetch just now. When `--all` reached some remotes, git keeps what they sent and so does the source.
- **Network commands may sign in, other commands never do.** See "How git runs" under [Desktop shell](#desktop-shell-electron).

**Contract tests.** `src/services/__tests__/gitDataSourceContract.ts` exports `describeGitDataSourceContract(name, createSubject, createCheckoutSubject)`, a suite of rules any data source must follow whatever repositories it serves: unique ids, branch names and hashes; the checked-out branch is a local branch (unless HEAD is detached, or the repository has no commits yet); a limited history page is the start of the whole history (graph rows aside, since layout depends on what the page holds), and `hasMore` agrees; dates are ISO timestamps; commits are labelled only with existing branches; every changed file has a diff, an added file's diff is all `+` and a deleted file's all `-`; `problem` is null for a readable repository; removing takes a repository off the list; unknown ids reject; and swapping the compare paths inverts the diff (ignoring git's function-name labels, which come from the left file). Checkout rules run on a fresh repository per test (`createCheckoutSubject`): a local checkout makes the branch current; a remote one adds a local branch level with it; unknown and option-like names (`-f`, `--orphan=x`) and unknown repositories reject and change nothing; and a remote branch whose local twin exists rejects with "A local branch *x* already exists". Fetch, pull and push rules use the same fresh repository: a fetch stamps `lastFetch`; pulling the checked-out branch leaves it behind by nothing, pushing it leaves it ahead by nothing; pulling another branch and pushing an unknown or option-like one (`--force`) reject; unknown repositories reject. It runs against the mock (`src/services/__tests__/MockGitDataSource.spec.ts`) and against real git on fixture repositories (`electron/main/git/__tests__/GitCliDataSource.spec.ts`), so the two can't drift apart.

`App.vue` wraps the source in `toRaw` before handing it to the composable. The data source is a service, not state. If a parent passes it through reactive props, unwrapping it keeps calls such as `structuredClone` working on the raw object.

## State: `useGitManager`

`useGitManager(source, { comparePaths })` returns refs, computeds and action functions. Hosting choices (whether the app may write) are `App` props, not composable state.

**State:** `repositories`, `loading`, `status`, `selectedBranch`, `selectedCommitIndex`, `selectedFileIndex`, `compareOpen`, `leftPath`, `rightPath`, the loading flags `historyLoading`, `filesLoading`, `diffLoading`, `runningOperation` (the `RepositoryOperation` running now, or null; `operationRunning` is true while there is one), and `pendingCheckout` (a checkout waiting for the user to agree to leave commits behind: target, branch, destination, `commitsLeft`). The selected repository id and the user's chosen diff mode are kept internally.

**Loading in pieces.** Opening a repository loads its branches and history together, then the newest commit's files, then the first file's diff. Selecting a commit loads its files and then the first diff; selecting a file loads its diff. Each of these areas is a `latestLoad` (`src/composables/latestLoad.ts`): it holds the area's value and its loading and failed flags, and only its most recent load may change it. A slow response for something the user has already clicked away from is dropped, and its failure isn't reported. History asks for `HISTORY_LIMIT` (200) commits at first; `showMoreHistory()` asks for 200 more each time (re-reading the longer page quietly, keeping the selection) while `loadingMoreHistory` is true. The longer history lasts through refreshes; opening a repository starts again at 200. The selection actions return promises that settle when their loads finish.

**Derived:**

| Value | What it is |
|---|---|
| `repository` | The selected repository, or the first one if nothing is selected. |
| `branches` | The open repository's local and remote branches. |
| `checkoutableRemotes` | Remote branches with no local branch of their name (`remotesToCheckOut`: the first segment is taken as the remote, which only decides which buttons show). |
| `commits`, `historyHasMore` | The loaded history page, and whether the repository has older commits. |
| `commit`, `files`, `file` | The selected commit, its changed files and the selected file. Indexes are clamped to the list length. |
| `currentBranch`, `headLabel` | The checked-out branch ('' when detached), and what the header calls HEAD ('detached HEAD' then). |
| `headerSyncLabel` | `'↑2 vs origin'` for the checked-out branch, or `null` when it's in sync. |
| `historyMessage` | What the history pane says instead of rows: 'Loading history…', 'Couldn’t load history' or 'No commits yet'; `null` when it has rows. |
| `diffMode` | `'simple'` whenever compare is open, otherwise the mode the user chose. |
| `activeHunks` | The compare result while comparing, otherwise the selected file's diff. |

Behavioural rules the composable enforces. Tests cover each of them, so change them deliberately:

1. **Selecting a repository, branch or commit resets the commit view.** File selection returns to 0 and compare closes. Selecting a branch jumps to its tip commit; a branch picked while the history is still loading jumps there once it arrives.
2. **Compare mode forces the simple diff.** Two arbitrary files share no history, so there is no git diff to show. `setDiffMode` is ignored while compare is open. Closing compare restores the mode the user chose.
3. **Responses can't arrive out of order.** History, branches, files, diff and compare each apply only the response to their latest request (`latestLoad`).
4. **A failed load empties only its own area.** The status shows `Couldn't load history: <reason>` (or branches, changed files, diff), the area shows nothing, and the rest of the screen keeps working.
5. **Remote operations report through `status`.** On success the status shows the source's message. On failure it shows `Failed: <reason>`, and no local state changes.
6. **Local state changes only after the source answers.** A checkout sets `currentBranch` and `selectedBranch` to the branch it ended on, editing the repository summary in place (the composable's own copy from `listRepositories`). Fetch, pull and push change nothing locally: they re-read everything afterwards, so `lastFetch` and the ↑/↓ counts come from the source.
7. **Adding opens the repository; removing opens the next.** `addRepository` shows the source's message, appends a new repository (or finds the listed one) and opens it; a cancelled picker changes nothing. `removeRepository` takes it off the list and, if it was open, opens the first one left, or closes everything when none is left.
8. **Refresh never disturbs the view.** `refresh()` re-reads the repository list, then reloads the open repository's branches and history with `latestLoad.refresh`, which keeps the current value on screen (no "Loading history…") until the new one arrives. The selected commit stays selected by hash, its files and diff untouched (a commit never changes); if it's gone (amended, rebased) the newest commit opens. The selection is read when the new history arrives, so a commit or branch the user picked while git was reading is the one kept. One refresh runs at a time. `App` calls it silently when the window regains focus and with `{ announce: true }` on F5 ("Refreshed *name*").
9. **Compare waits for both paths.** The desktop app starts with both inputs empty; nothing is asked of the source until both are filled in.
10. **One operation at a time.** `checkoutBranch`, `checkoutRemoteBranch` and the remote operations do nothing while `operationRunning`; refresh (focus, F5) is skipped then too. A checkout first waits for a refresh already running (so what it read before the switch can't land after it), says "Switching to *branch*…", and once git has switched re-reads everything as a refresh does, keeping the selected commit. When the source answers `confirm`, `pendingCheckout` holds the request: `confirmCheckout()` sends it again with `leaveCommits`, `cancelCheckout()` drops it ("Checkout cancelled; nothing changed"), and opening a repository drops it too. `App` shows it in `ConfirmDialog`. `fetchRemote`, `pull` and `push` also wait for a running refresh, say "Fetching…", "Pulling…" or "Pushing…" (the header button says it too), and then re-read everything as a refresh does, keeping the selection. They re-read after a failure as well: a pull refused after fetching, or a fetch that failed for one remote of several, still moved remote branches. Pull and push send the checked-out branch, and fail with "no branch is checked out" on a detached HEAD.

## Rendering

### Diffs (`src/lib/diff.ts`)

- `toUnifiedLines(hunks)` emits a `hunk` header row for each hunk, followed by `context`, `add` or `del` rows. Each row carries its old and new line numbers. Additions have no old number and deletions have no new number. git's `\ No newline at end of file` becomes a `note` row with no numbers; it isn't a line of the file, so it neither counts in `hunkHeader` nor shifts the numbering. The side-by-side view leaves notes out.
- `toSideBySideRows(hunks)` pairs each run of deletions with the run of additions that follows it, row by row. When one side runs out, its cells are filled with `empty`. Context lines appear on both sides. Separator rows (`⋯ from line N · context`, using the hunk's new start line) come before every hunk when there is more than one hunk, or when any hunk starts after line 1 on either side.
- `invertHunks(hunks)` swaps `+` and `-` and the start lines, then lists each change's removals before its additions, as git does (keeping a `\ No newline` note after its line). It returns new objects and never changes its input.
- `parseUnifiedDiff(text)` (`src/lib/parseDiff.ts`) reads `git diff` output into hunks, skipping file headers; a binary file has none.

`UnifiedDiff.vue` and `SideBySideDiff.vue` only render these rows. All the line logic lives in `lib/diff.ts` and is tested there.

### Commit graph (`src/lib/graph.ts`, `src/lib/laneLayout.ts`)

`layoutLanes(commits, primaryTip)` sweeps a newest-first page top to bottom, tracking which commits each lane's line is heading down to:

- **Lane 0 is the primary branch's line**: the first-parent chain from the newest commit whose first-parent ancestry includes the primary tip (`main`, else `master`, `origin/main`, `origin/master`). So `develop` built directly on `main` shares lane 0, while a branch that forked earlier gets its own lane. With no primary branch in the page, the newest commit takes lane 0.
- Every other branch takes the **leftmost free lane**, keeps it down to its parent's row and **curves in** there. A merge **curves out** to a new lane for each extra parent, or to a lane already heading to that parent.
- **Up to 8 lanes** (`MAX_LANES`). Further branches share the last lane, which tracks every line it carries so none loses its parent.

A test reproduces the design's hand-drawn inventory-service graph row for row from the sample commits' parents.

Each history row is 32px tall. Lane *n* is at x = 14 + 18·n, and the graph column is 64px (the design's width, enough for three lanes) or wider for more, the same for every row so lanes line up. Lane colours are fixed by position, independent of the UI accent: the design's `#5b9dff`, `#f0a35e`, `#c792ea`, then five more for lanes 4–8.

`graphGeometry(row)` turns a `GraphRow` into vertical segments, cubic-Bézier curves and the dot (r=5). The dot has a ring the colour of the row background, so lines appear to stop at the dot. The ring switches to the selected-row colour when the row is selected.

## Desktop shell (Electron)

```
 Electron main process (Node)          electron/main/index.ts, ipc.ts
   │  window, folder picker, repositories.json, runs git (GitCliDataSource)
   │
   │  ipcMain.handle ◄──── ipcRenderer.invoke         answers: IpcResult { ok, value | message }
   ▼
 Preload (sandboxed)                   electron/preload/index.ts
   │  contextBridge.exposeInMainWorld('gitManager', GitManagerBridge)
   ▼
 Renderer: the Vue app                 desktop.html + src/desktop.ts → IpcGitDataSource
```

- **The renderer is an ordinary web page.** `contextIsolation`, `sandbox` and no `nodeIntegration`: it has no `require` or `process`, and it can reach the main process only through the methods on `window.gitManager`. The window also refuses navigation and pop-ups.
- **The bridge type is shared.** `src/types/bridge.ts` defines `GitManagerBridge`: `getAppVersion`, `getGitStatus` and `git` (the `GitDataSource` calls the desktop app supports). The preload implements it and `IpcGitDataSource` calls it. Every method crosses IPC, so every method is async. Channel names are in `electron/shared/channels.ts` so main and preload can't disagree.
- **Errors arrive plain.** Each handler answers an `IpcResult` (`{ ok: true, value }` or `{ ok: false, message }`) and the preload turns a failure into an ordinary rejection. Otherwise Electron would prefix the message with "Error invoking remote method '…': Error: ".
- **Nothing from the renderer reaches git unchecked.** Handlers check each argument's type; repositories are named by id (the renderer never supplies a folder); hashes must look like hashes, so one can never be read as a git option; paths always follow `--`; compare paths must stay inside the repository's folder.
- **How git runs.** `runGit` uses `execFile` (no shell) with settings that keep output parseable whatever the user's config says (no colour, no external diff, no renames, no signatures) while their own config otherwise applies. It never asks anything in a terminal (`GIT_TERMINAL_PROMPT=0`) and takes no optional locks, so reading can't block the user's own git commands. On Windows a missing working folder fails exactly like missing git, so the data source checks the folder first.
- **Signing in (fetch, pull and push only).** Those run with `network` access (`electron/main/git/network.ts`); every other command keeps `GCM_INTERACTIVE=never`, so it can never show a sign-in window. With network access, Git Credential Manager may show its own window for HTTPS, and git and ssh ask for passwords, passphrases and unknown host keys through Git for Windows' `git-askpass.exe` (found beside git: `git --exec-path`/../../bin), via `GIT_ASKPASS`, `SSH_ASKPASS` and `SSH_ASKPASS_REQUIRE=force` (ssh has no terminal). Git for Windows' own shell uses the same program. A spike confirmed that git's ssh, started from Node, calls it for a host-key question.
- **Stalls fail; slow transfers don't.** HTTPS gets `http.lowSpeedLimit=1000` / `http.lowSpeedTime=60`. ssh gets `GIT_SSH_COMMAND` with `ConnectTimeout=20`, `ServerAliveInterval=15` and `ServerAliveCountMax=4`, but only when the user hasn't chosen their own ssh (`GIT_SSH`, `GIT_SSH_COMMAND` or `core.sshCommand`, which always win). There is no overall timeout: a big fetch takes as long as it takes, and git may be waiting for the user to sign in.
- **Git check.** At startup `desktop.ts` asks for `getGitStatus()`, from `git --version`. Missing git, or older than 2.30, shows `GitRequired` instead of the app.
- **The repository list** is `repositories.json` in the data folder (`RepositoryStore`): stable random ids, the order added, atomic writes, and a refusal to overwrite a file it can't read.
- **The preload is CommonJS** (`out/preload/index.cjs`) even though the project is ESM. Electron can't load an ES module as a sandboxed preload. The main process is ESM.
- **Layout is non-default for electron-vite.** It expects `src/main`, `src/preload` and `src/renderer`. We keep the browser app at the root and set every entry in `electron.vite.config.ts`: the renderer builds `desktop.html` and spreads `vite.config.ts` (plugins and build options) so both hosts compile the same app; main and preload resolve the `@/` alias for shared code.
- **Dev vs packaged.** `npm run dev:app` serves the renderer from Vite on port 5173 (`ELECTRON_RENDERER_URL` + `/desktop.html`) with hot reload. A packaged build always loads `out/renderer/desktop.html` from disk and ignores that variable.
- **Window size.** Sizes are content sizes (`useContentSize`). The minimum is 1024×640, the smallest size at which the layout fits without page scroll; both e2e suites check it.
- **Packaging.** `electron-builder.yml` packages only `out/**` and `package.json`. Vue is bundled into the renderer, so every npm package is a dev dependency and the installer ships no `node_modules`. The appId `com.echel.gitmanager` must match `APP_USER_MODEL_ID` in the main process.
- **Offline and locked down.** Fonts are bundled, and the page carries a Content-Security-Policy as a `<meta>` tag (a `file://` page has no response headers). The built app's policy is `default-src 'none'` with scripts, styles, fonts, images and connections allowed only from the app's own files: no inline code, no `eval`, no other hosts. The dev server's policy also allows inline styles, because Vite injects imported CSS as `<style>` tags. Vite never inlines assets as `data:` URLs (`assetsInlineLimit: 0`), since the policy would block them. A feature that needs the network, such as auto-update, will have to widen the policy deliberately.
- **Icon.** `build/icon.svg` is the artwork for 48 px and up. `build/icon-small.svg` is a full-bleed version with a larger glyph and heavier strokes for 32 px and below, where the large artwork loses legibility. `npm run icon` renders both with Playwright's Chromium at nine sizes from 16 to 256 px and packs them into `build/icon.ico` (PNG entries), which is committed. electron-builder embeds it in the exe and the installer. The main process also sets it as the window icon, which matters in dev mode, where the running exe is `electron.exe`. The browser tab uses `icon-small.svg` as its favicon.
- **User data.** The installed app keeps its data, including `repositories.json`, in `%APPDATA%\git-manager` (named after `package.json`); uninstalling leaves it behind. Unpackaged runs (`dev:app`, tests) use `%APPDATA%\git-manager-dev`, or the folder in `GIT_MANAGER_USER_DATA`, so they never touch the installed app's list.

## Theming and layout

- All colours are Tailwind theme tokens in `src/style.css` (`--color-gm-*`, used as `bg-gm-*`, `text-gm-*`, `border-gm-*`). Components use only these tokens, never raw hex values. The one exception is the lane colours in `lib/graph.ts`, which are drawn as SVG strokes.
- `App` accepts an optional `accent` prop, which overrides `--color-gm-accent` on the root element.
- Fonts: Inter for the interface and JetBrains Mono for code, hashes and paths. Both are bundled variable fonts imported in `src/main.ts` (families `'Inter Variable'` and `'JetBrains Mono Variable'` in the `@theme` tokens), so one file per script subset covers every weight and nothing loads from another host.
- Above 860px the window is fixed-height with a minimum of 640px, matching the desktop app's minimum window size. The sidebar (260px basis) and main column sit in a flex row that does **not** wrap there: a wrapping row takes its height from its content, which would let a long history push the diff panel off the window. The history takes the space the diff panel leaves (at least 220px) and scrolls inside; the diff panel is 400px and shrinks to 240px if it has to.
- Below 860px the row wraps, the columns stack, and the page stops being a fixed full-height window (`max-[860px]:h-auto`) and scrolls normally. The commit table keeps a minimum width of 760px and scrolls sideways inside its own pane, so the page itself never scrolls horizontally.
- In a history row, branch badges and the message share the description column: the message gives up space first (down to 8 characters), then the badges shrink with an ellipsis and show their full name as a tooltip.

## Testing

| Layer | Where | What it proves |
|---|---|---|
| Pure logic | `src/lib/__tests__/` | Diff rows, inversion, diff parsing, lane layout (including the design's graph), graph geometry, formatting |
| State | `src/composables/__tests__/` | The behavioural rules above, including refresh after outside changes, out-of-order responses (`heldSource.ts` holds chosen calls back and releases them in any order) and a failure in each area |
| Contract | `src/services/__tests__/`, `electron/main/git/__tests__/` | The rules every `GitDataSource` must follow, run against the mock and against real git on fixture repositories (merge, deletion, binary, no trailing newline, accented path, remote one behind, empty repository, detached HEAD), plus exact checks of what git returns for each |
| Main process | `electron/main/**/__tests__/` | Output parsers, the git version check, the repository store, the network setup (what git itself sees, via an alias that prints its environment; the user's `core.sshCommand` respected), and the IPC handlers' argument checks and answers (with a stand-in for `ipcMain`). Fetch, pull and push run on a fixture with a bare `origin` and a colleague's clone that pushes to it; a stand-in `core.sshCommand` records that each of them lets ssh ask for sign-in |
| Renderer source | `src/services/__tests__/IpcGitDataSource.spec.ts` | Every call reaches the bridge with its arguments, as plain copies |
| Components | `src/components/**/__tests__/` | Each component renders its props and emits the right events |
| Wiring | `src/__tests__/App.spec.ts` | `App` connects composable and components (clicks reach the source; results reach the screen) |
| Acceptance | `e2e/git-manager.spec.ts` | Each capability driven through the real UI in Chromium, including the phone-width and smallest-desktop layouts |
| Desktop acceptance | `e2e-electron/app.spec.ts` | The built app on a fixture repository: browsing a merge, a binary file, a diff and a branch through the UI; a commit and a branch switch made outside the app appearing on F5 and on focus; adding (with Electron's folder dialog stubbed in main), removing, first run and a missing folder, with the saved list checked; checking out a local branch, a remote one (tracking checked in git) and a refusal over uncommitted changes, and the leave-commits dialog (Cancel focused, Esc, Switch anyway); Fetch bringing in a colleague's commit, Pull fast-forwarding and refusing diverged branches, Push sending, refused when behind, and publishing a new branch, each checked in git; no menu and no DevTools with `GIT_MANAGER_NO_DEV_TOOLS=1`, both present otherwise; the git-required screen with no git on the PATH; no sample data in the bundle; plus the bridge, no Node globals, the minimum window, offline fonts and the strict CSP |
| Icon packer | `scripts/__tests__/ico.spec.ts` | The .ico layout Windows reads, and that the committed `build/icon.ico` has every size as a PNG |

The browser suite also checks that the page loads nothing from other hosts, renders in the bundled fonts, has the favicon, and that its dev policy blocks injected scripts with no violations. Playwright can't check that `eval` is blocked: its own evaluations go through DevTools, which the policy exempts, so the tests assert the `script-src` directive instead.

The browser suite runs against Vite; the desktop suite runs against `out/`, so `npm run test:e2e:app` builds first. Each desktop test gets its own data folder (`GIT_MANAGER_USER_DATA`) listing the fixtures; the fixtures are built, and the app under test runs git, with an empty global git config so the developer's own settings (hooks, aliases) can't change them. Playwright's key presses reach the page through DevTools, not the window, so Electron's menu shortcuts (Ctrl+R, Ctrl+Shift+I) can't be pressed in a test; the suite checks the menu and DevTools directly, and the installer check tries the keys. Playwright starts its own Vite server on port 4317 with `--strictPort` and `reuseExistingServer: false`. That way it fails loudly instead of testing some other app that happens to be on the port.

Stable selectors for the tests are roles and labels first, then `data-testid`. A repository's button name starts with its name and its Remove button's with "Remove", so match repository buttons with an anchored pattern (`/^name/`). The `data-testid`s are `header-repo`, `header-branch`, `unified-diff`, `side-by-side-diff`, `left-label`, `right-label`, `commit-description`. Diff rows also expose `data-kind`, and side-by-side cells expose `data-side` and `data-cell`.

## Known limitations

- Pull only fast-forwards; merging or rebasing diverged branches is left to a terminal. Push goes to the branch's upstream only (not `remote.pushDefault` or `branch.*.pushRemote`) and never forces.
- Git's sign-in windows (Git Credential Manager, `git-askpass.exe`) are never seen by a test: the tests prove ssh is told to use them, and a person checks that they appear. Fetch, pull and push have been run against local remotes only in tests.
- With the user's own ssh command, ssh gets no stall timeouts (theirs wins). Git's refusals are reworded only in English.
- Checkout has no timeout: a slow `post-checkout` hook or an LFS download shows "Switching…" until git finishes, since killing a checkout halfway is worse. Git's prompts are off, so an LFS download that needs to sign in fails. Submodules aren't updated on a switch (git's default). Git's refusal is reworded only in English; in another language its first line is shown as is.
- The history loads 200 commits at a time ("Show more commits"), and the list isn't virtualized, so thousands of rows get slow. Each page re-reads the whole history from the top, since the lane layout depends on everything above. `git status` on a very large working tree can still be slow.
- A merge shows only what it brought into its first parent. Copies aren't detected (only renames).
- Branches beyond 8 lanes share the last lane.
- Not covered by tests: submodules, Git LFS, a worktree opened directly, a damaged `.git`.
- The installer is unsigned. There is no auto-update yet.

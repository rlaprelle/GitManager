# CLAUDE.md

Vue 3 + TypeScript + Vite + Tailwind v4 single-screen git client UI, hosted two ways: in a browser on in-memory sample data (`MockGitDataSource`), and as a Windows-only Electron app (electron-vite + electron-builder) that reads real repositories with the user's installed git CLI in the main process (`GitCliDataSource`, no JGit/Java backend). The desktop app can check out branches; Fetch/Pull/Push aren't built yet. Deep dive: `docs/ARCHITECTURE.md`.

## Commands (PowerShell)

```powershell
npm install
npm run dev            # Vite dev server (http://localhost:5173 by default)
npm test               # Vitest, jsdom — unit + component + App wiring
npm run test:e2e       # Playwright; starts its own Vite on 4317 (--strictPort)
npm run typecheck      # vue-tsc -b (app, vitest, node, electron project references)
npm run build          # vue-tsc -b && vite build → dist/
npm run dev:app        # electron-vite dev: Electron window, renderer from Vite on 5173
npm run build:app      # vue-tsc -b && electron-vite build → out/
npm run test:e2e:app   # electron-vite build, then Playwright against out/ (playwright.electron.config.ts)
npm run dist           # build:app, then electron-builder NSIS installer → release/
npm run icon           # node scripts/build-icon.ts: build/icon*.svg → build/icon.ico (committed)
```

- First e2e run on a machine: `npx playwright install chromium`.
- `.claude/launch.json` config `git-manager-ui` = dev server on 5173 (`--strictPort`) for the preview pane.
- "Done" = typecheck + `npm test` + `npm run test:e2e` + `npm run test:e2e:app` all green, plus a visual spot-check for UI changes.
- Stop dev-mode Electron by command-line match: `Get-CimInstance Win32_Process | Where-Object CommandLine -match 'GitManager[^\\]*\\node_modules' | Stop-Process`.

## Structure

```
src/types/git.ts                 contract types, one per call (Repository, Branches, HistoryPage, FileChange, Hunk; GraphRow)
src/services/GitDataSource.ts    ONLY boundary to git (interface): one call per view area
src/services/MockGitDataSource.ts  browser: sample-data impl; checkout really switches (own copy of samples), fetch/pull/push return messages only
src/services/IpcGitDataSource.ts desktop: forwards to window.gitManager.git (plain copies); fetch/pull/push reject
src/services/__tests__/gitDataSourceContract.ts  rules every data source must pass (run on mock AND real git)
src/main.ts / src/desktop.ts     entries: browser (index.html, mock, all operations) / desktop (desktop.html, git check + IPC, operations ['checkout'])
src/mountApp.ts                  mounts App or GitRequired; fonts + styles
src/data/sample*.ts              sample repos stored whole (sampleTypes.ts), diffs, SAMPLE_COMPARE_PATHS
src/composables/latestLoad.ts    one async area: value + loading, only the latest load applies
src/composables/useGitManager.ts ALL state, derived state, actions
src/lib/{diff,graph,format}.ts   pure functions (diff rows, graph geometry, labels)
src/lib/checkout.ts              checkout wording + names (switchedMessage, localNameOf, remotesToCheckOut, destinationOf)
src/lib/laneLayout.ts            parents → GraphRow (lane 0 = primary branch line; ≤ 8 lanes)
src/lib/parseDiff.ts             git diff output → Hunk[]
src/components/**                presentational: props in, emits out
src/App.vue                      wires composable ↔ components; layout
src/style.css                    @theme tokens (--color-gm-*), base styles
src/types/bridge.ts              GitManagerBridge: window.gitManager (preload ↔ renderer contract)
electron/main/index.ts           Electron main: window, data folder, folder picker, wiring
electron/main/ipc.ts             handler per channel: type checks, IpcResult envelopes (testable without Electron)
electron/main/repositoryStore.ts repositories.json in userData
electron/main/git/               GitCliDataSource, runGit, parsers, git version check; __tests__/fixtures.ts
electron/preload/index.ts        contextBridge → window.gitManager
electron/shared/channels.ts      IPC channel names (main + preload)
electron.vite.config.ts         desktop build; renderer spreads vite.config.ts
electron-builder.yml             NSIS installer config
config/contentSecurityPolicy.ts  Vite plugin: CSP <meta> (strict build policy; dev adds inline styles)
build/icon.svg, icon-small.svg   app icon artwork (≥48 px / ≤32 px); icon.ico is generated from them
scripts/{build-icon,ico}.ts      icon renderer (Playwright Chromium) + .ico packer; run under Node directly
e2e/git-manager.spec.ts          Playwright acceptance tests (browser)
e2e/support/pageChecks.ts        page checks shared by both e2e suites (origins, fonts, CSP)
e2e-electron/app.spec.ts         Playwright acceptance tests (built Electron app)
```

Unit/component tests follow the create-vue layout: `src/<dir>/X.ts` ↔ `src/<dir>/__tests__/X.spec.ts` (import the subject as `../X`). Playwright specs live in `e2e/` (browser) and `e2e-electron/` (desktop). `tsconfig.app.json` excludes `src/**/__tests__/*`; `tsconfig.vitest.json` includes only them.

## Architecture rules

- Components never call `GitDataSource` and hold no shared state. New behaviour → action/computed in `useGitManager`, wired in `App.vue`.
- Line/geometry logic lives in `src/lib/` (pure, unit-tested); components only render rows.
- Real git = new `GitDataSource` impl passed to `App` in `src/main.ts`. Don't leak backend concerns above the service layer.
- Renderer reaches Electron only through `window.gitManager` (`GitManagerBridge`). New main-process capability → channel in `channels.ts`, handler in `ipc.ts` (check every argument's type; answer `IpcResult`), method on the bridge type + preload (`call()` unwraps), test in `electron/main/__tests__/ipc.spec.ts` (it asserts every channel has a handler). Every bridge method is async.
- Nothing from the renderer reaches git unchecked: repositories by id only (never a folder), hashes match `COMMIT_HASH`, paths after `--`, compare paths inside the repo. Run git only through `runGit` (execFile, no shell).
- Browser mode keeps `MockGitDataSource`; the desktop entry (`src/desktop.ts`) must never import sample data — e2e-electron greps the built bundle.
- `App`'s `operations` prop (`RepositoryOperation[]`; `ALL_OPERATIONS` in the browser, `['checkout']` from `desktop.ts`) decides which write buttons show. Don't offer an operation before it exists in `GitCliDataSource`.
- Checkout targets are `{ local }` / `{ remote }`, checked against `for-each-ref`'s list before reaching git. `confirm` results (leaving a detached HEAD's commits) go through `pendingCheckout` + `ConfirmDialog`; one operation at a time (`operationRunning`, refresh skipped meanwhile). Anything crossing IPC must be a plain object: Vue refs hold proxies, which IPC can't clone.
- Graph layout (`GraphRow`) is supplied by the data source via `layoutLanes`; the UI never assigns lanes. Up to `MAX_LANES` (8); `LANE_COLORS` has one colour per lane. Layout depends on the page, so compare commits without `graph` across pages.
- Branch → commit lookup is by `tipHash`, never index.
- Composable invariants (tested; change deliberately): selection change resets file index + closes compare; compare forces `diffMode = 'simple'` and ignores `setDiffMode`; every async area (branches, history, files, diff, compare) goes through `latestLoad`, so stale responses are dropped; a failed load → `status = "Couldn't load <area>: …"` and only that area empties; local state (`currentBranch`, `lastFetch`) changes only after the source resolves; operation failures → `status = "Failed: …"` (so git refusals are worded to follow "Failed: "); one operation at a time, and a checkout waits for a running refresh.
- Never load a whole repository: add a narrow `GitDataSource` call per new view area, add its rules to the contract suite, and load it through `latestLoad`. History starts at `HISTORY_LIMIT` and grows by it per `showMoreHistory`; the data source always re-reads from the newest commit (layout depends on the whole page).
- Refresh (window focus, F5) uses `latestLoad.refresh`, which keeps the value on screen; never `run` for reloading what the user is looking at, or the pane flashes "Loading…". Keep selection by hash, not index.
- Composable tests that need slow or out-of-order responses use `heldSource()` (`src/composables/__tests__/heldSource.ts`).
- Data sources send full hashes and ISO timestamps; the UI formats (`shortHash`, `commitDateLabel`, `lastFetchLabel` against `useNow`). `currentBranch` is null for a detached HEAD; `problem` marks an unreadable repository instead of failing the list.
- No router, no Pinia — single screen. Revisit only if a second screen needs shared state.

## Conventions

- `<script setup lang="ts">` SFCs only; `@/` alias = `src/`.
- Colours: use `gm-*` Tailwind tokens (`bg-gm-main`, `text-gm-muted`, …). No raw hex in components. Exception: lane colours in `lib/graph.ts` (SVG strokes, fixed by lane, independent of accent).
- New colour → add `--color-gm-*` to `@theme` in `src/style.css`.
- Monospace (`font-mono`, JetBrains Mono) for hashes, paths, code; Inter for UI. Both are bundled Fontsource variable fonts (families `'Inter Variable'`, `'JetBrains Mono Variable'`) imported in `src/main.ts`. Never load anything from another host.
- Responsive: `max-[860px]:` variant is the narrow breakpoint. Page must never scroll horizontally (e2e enforces at phone width); wide content scrolls inside its own pane.
- Smallest desktop size is 1024×640 content (Electron `minWidth`/`minHeight` with `useContentSize`; root `min-h-[640px]`). Both e2e suites assert no page scroll there — change all three together.
- Test selectors: role/label first; repository buttons by anchored name (`/^name/`), since each row's Remove button is named "Remove name from the list"; then `data-testid` (`header-repo`, `header-branch`, `unified-diff`, `side-by-side-diff`, `left-label`, `right-label`, `commit-description`); diff rows expose `data-kind`, side-by-side cells `data-side`/`data-cell`.
- Every new capability gets: lib/composable unit test, component test, `src/__tests__/App.spec.ts` wiring test if it crosses components, and a Playwright test that drives the UI.

## Constraints / quirks

- **TypeScript pinned `~6.0`.** TS 7 is the native compiler; `vue-tsc` 3 needs the JS compiler API. Don't bump without checking vue-tsc support.
- **Tailwind v4 is CSS-configured** (`@theme`, `@utility`, `@layer base` in `src/style.css`). There is no `tailwind.config.js`.
- **`toRaw(props.source)` in `App.vue` is required.** VTU/parents pass props as reactive proxies; `MockGitDataSource` uses `structuredClone`, which throws on proxies.
- **Playwright `reuseExistingServer: false` on port 4317** on purpose — another local Vite app may own a common port; tests must never hit a foreign server.
- `tsconfig.node.json` includes the `DOM` lib because e2e specs use `document` inside `page.evaluate`.
- **Preload is bundled as CommonJS** (`out/preload/index.cjs`, `output.format: 'cjs'`): Electron can't load an ESM preload in a sandboxed window. Main stays ESM. The preload path in main must match.
- **Window security is tested** (`e2e-electron`): `contextIsolation`, `sandbox`, no `nodeIntegration`, navigation and pop-ups denied. Don't relax these to make something work; add a bridge method instead.
- **Packaged builds have no menu and no DevTools** (`Menu.setApplicationMenu(null)` before ready, `devTools: false`); unpackaged runs keep both. `GIT_MANAGER_NO_DEV_TOOLS=1` gives an unpackaged run the packaged behaviour (e2e uses it). Playwright key presses don't reach Electron's menu accelerators, so Ctrl+R/Ctrl+Shift+I are checked by hand on the installer.
- **jsdom has no `HTMLDialogElement.showModal`/`close`**: component tests stub them; the real modal behaviour is covered in Playwright.
- **All npm packages are devDependencies**, Vue included: electron-vite bundles everything into `out/`, and electron-builder packages only `out/**` + `package.json`.
- **appId `com.echel.gitmanager`** in `electron-builder.yml` must match `APP_USER_MODEL_ID` in `electron/main/index.ts`.
- **Content-Security-Policy is a `<meta>` tag** (file:// has no headers), injected by `config/contentSecurityPolicy.ts`. Build: `default-src 'none'`, everything else `'self'`, no `unsafe-*`. Dev adds only `style-src 'unsafe-inline'` (Vite's injected CSS). Both e2e suites assert no violations; a new resource type or host means widening the policy deliberately.
- **`assetsInlineLimit: 0`**: Vite would otherwise inline small assets as `data:` URLs, which the CSP blocks (one font subset silently fell back). `electron.vite.config.ts` must spread `viteConfig.build`, not replace it.
- **Playwright can't test eval blocking**: its evaluations go through DevTools, which is exempt from the CSP's eval ban. Tests assert the `script-src` directive instead.
- **`build/icon.ico` is generated and committed**: edit the SVGs, run `npm run icon`. Entries are PNG; .NET's old `System.Drawing.Icon` can't read them below 256 px, but Windows (WIC, Explorer) and electron-builder can.
- `scripts/*.ts` run under Node's type stripping: explicit `.ts` import extensions (`allowImportingTsExtensions` in `tsconfig.node.json`) and erasable syntax only (no enums, no parameter properties).
- **Unpackaged runs use a separate data folder** (`%APPDATA%\git-manager-dev`, or `GIT_MANAGER_USER_DATA`), never the installed app's `repositories.json`. e2e-electron gives each test its own temp folder; stub the folder picker with `app.evaluate(({ dialog }) => { dialog.showOpenDialog = ... })`.
- **Git test fixtures** (`electron/main/git/__tests__/fixtures.ts`; `createScratchRepository`, `createRepositoryWithRemote` (fresh repo + bare origin, for checkout), `commitInFixture`, `gitInFixture`, `switchToNewBranchInFixture` for changes "outside the app") build throwaway repos with an empty global config (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`) so the developer's git settings can't change them. The real-git spec and e2e-electron also run the app's own git with that config (checkout runs hooks). Each `git` call is a process: give real-git specs long timeouts.
- **On Windows a missing working folder fails like missing git** (`spawn git ENOENT`): check the folder exists before running git in it.
- **Git's diff lists a change's removals before its additions**; `invertHunks` keeps that order, so a swapped compare matches real git.
- In `page.evaluate` callbacks in e2e-electron, the page variable is named `window`; use `globalThis` for the browser's window.
- **Desktop renderer entry is `desktop.html`** (`out/renderer/desktop.html`; dev URL + `/desktop.html`), not `index.html`.
- `npm run dev` and `npm run dev:app` both use port 5173; run one at a time.
- JetBrains Mono renders ligatures (`==`, `||`) in diffs — expected, matches the design.
- `npm audit` moderate warnings come from `@vue/test-utils` (dev-only).

## Git workflow

- `main` = stable; `dev` = integration. Remote: `git@github.com:rlaprelle/GitManager.git` (SSH).
- Work on `claude/<feature>` in a worktree off `dev`; merge locally into `dev`. PRs go `dev` → `main`. Never push or open a PR unless asked.

## Documentation Files

| File | Purpose | Audience | Out of scope |
|------|---------|----------|-------------|
| `README.md` | Product description: what, who, concepts, design principles, how to run and test | Humans discovering the project | Architecture internals, data model, agent conventions |
| `CLAUDE.md` | Commands, structure, rules, conventions, constraints, quirks | Coding agents | Narrative walkthrough, product marketing |
| `docs/ARCHITECTURE.md` | Layers, data model, `GitDataSource` contract, state rules, rendering, theming, test layers | Both humans and agents | Product framing, dev setup instructions |

New info routing: product behaviour/UX framing → README; how it's built → ARCHITECTURE; agent-facing rules/quirks → here. When a command changes, update README and this file together.

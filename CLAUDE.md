# CLAUDE.md

Vue 3 + TypeScript + Vite + Tailwind v4 single-screen git client UI, hosted two ways: in a browser and as a Windows-only Electron app (electron-vite + electron-builder). Both run on in-memory sample data via `MockGitDataSource`; no real git yet. Planned: Electron main process runs the user's installed git CLI behind `GitDataSource` (no JGit/Java backend). Deep dive: `docs/ARCHITECTURE.md`.

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
src/services/MockGitDataSource.ts  sample-data impl; ops return status messages only
src/services/__tests__/gitDataSourceContract.ts  rules every data source must pass (mock now, real git next)
src/data/sample*.ts              sample repos stored whole (sampleTypes.ts), diffs, SAMPLE_COMPARE_PATHS
src/composables/latestLoad.ts    one async area: value + loading, only the latest load applies
src/composables/useGitManager.ts ALL state, derived state, actions
src/lib/{diff,graph,format}.ts   pure functions (diff rows, graph geometry, labels)
src/components/**                presentational: props in, emits out
src/App.vue                      wires composable ↔ components; layout
src/style.css                    @theme tokens (--color-gm-*), base styles
src/types/bridge.ts              GitManagerBridge: window.gitManager (preload ↔ renderer contract)
electron/main/index.ts           Electron main: window, IPC handlers
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
- Renderer reaches Electron only through `window.gitManager` (`GitManagerBridge`). New main-process capability → channel in `channels.ts`, handler in main, method on the bridge type + preload. Every bridge method is async.
- Browser mode keeps `MockGitDataSource`; the desktop data source is chosen at build time — an installed app must never fall back to sample data.
- Graph layout (`GraphRow`) is supplied by the data source; UI doesn't assign lanes. Max 3 lanes — widening needs `LaneFlags`, `LANE_COLORS`, `GRAPH_WIDTH` together.
- Branch → commit lookup is by `tipHash`, never index.
- Composable invariants (tested; change deliberately): selection change resets file index + closes compare; compare forces `diffMode = 'simple'` and ignores `setDiffMode`; every async area (branches, history, files, diff, compare) goes through `latestLoad`, so stale responses are dropped; a failed load → `status = "Couldn't load <area>: …"` and only that area empties; local state (`currentBranch`, `lastFetch`) changes only after the source resolves; operation failures → `status = "Failed: …"`.
- Never load a whole repository: add a narrow `GitDataSource` call per new view area, add its rules to the contract suite, and load it through `latestLoad`. History is capped at `HISTORY_LIMIT`.
- Composable tests that need slow or out-of-order responses use `heldSource()` (`src/composables/__tests__/heldSource.ts`).
- No router, no Pinia — single screen. Revisit only if a second screen needs shared state.

## Conventions

- `<script setup lang="ts">` SFCs only; `@/` alias = `src/`.
- Colours: use `gm-*` Tailwind tokens (`bg-gm-main`, `text-gm-muted`, …). No raw hex in components. Exception: lane colours in `lib/graph.ts` (SVG strokes, fixed by lane, independent of accent).
- New colour → add `--color-gm-*` to `@theme` in `src/style.css`.
- Monospace (`font-mono`, JetBrains Mono) for hashes, paths, code; Inter for UI. Both are bundled Fontsource variable fonts (families `'Inter Variable'`, `'JetBrains Mono Variable'`) imported in `src/main.ts`. Never load anything from another host.
- Responsive: `max-[860px]:` variant is the narrow breakpoint. Page must never scroll horizontally (e2e enforces at phone width); wide content scrolls inside its own pane.
- Smallest desktop size is 1024×640 content (Electron `minWidth`/`minHeight` with `useContentSize`; root `min-h-[640px]`). Both e2e suites assert no page scroll there — change all three together.
- Test selectors: role/label first, then `data-testid` (`header-repo`, `header-branch`, `unified-diff`, `side-by-side-diff`, `left-label`, `right-label`, `commit-description`); diff rows expose `data-kind`, side-by-side cells `data-side`/`data-cell`.
- Every new capability gets: lib/composable unit test, component test, `src/__tests__/App.spec.ts` wiring test if it crosses components, and a Playwright test that drives the UI.

## Constraints / quirks

- **TypeScript pinned `~6.0`.** TS 7 is the native compiler; `vue-tsc` 3 needs the JS compiler API. Don't bump without checking vue-tsc support.
- **Tailwind v4 is CSS-configured** (`@theme`, `@utility`, `@layer base` in `src/style.css`). There is no `tailwind.config.js`.
- **`toRaw(props.source)` in `App.vue` is required.** VTU/parents pass props as reactive proxies; `MockGitDataSource` uses `structuredClone`, which throws on proxies.
- **Playwright `reuseExistingServer: false` on port 4317** on purpose — another local Vite app may own a common port; tests must never hit a foreign server.
- `tsconfig.node.json` includes the `DOM` lib because e2e specs use `document` inside `page.evaluate`.
- **Preload is bundled as CommonJS** (`out/preload/index.cjs`, `output.format: 'cjs'`): Electron can't load an ESM preload in a sandboxed window. Main stays ESM. The preload path in main must match.
- **Window security is tested** (`e2e-electron`): `contextIsolation`, `sandbox`, no `nodeIntegration`, navigation and pop-ups denied. Don't relax these to make something work; add a bridge method instead.
- **All npm packages are devDependencies**, Vue included: electron-vite bundles everything into `out/`, and electron-builder packages only `out/**` + `package.json`.
- **appId `com.echel.gitmanager`** in `electron-builder.yml` must match `APP_USER_MODEL_ID` in `electron/main/index.ts`.
- **Content-Security-Policy is a `<meta>` tag** (file:// has no headers), injected by `config/contentSecurityPolicy.ts`. Build: `default-src 'none'`, everything else `'self'`, no `unsafe-*`. Dev adds only `style-src 'unsafe-inline'` (Vite's injected CSS). Both e2e suites assert no violations; a new resource type or host means widening the policy deliberately.
- **`assetsInlineLimit: 0`**: Vite would otherwise inline small assets as `data:` URLs, which the CSP blocks (one font subset silently fell back). `electron.vite.config.ts` must spread `viteConfig.build`, not replace it.
- **Playwright can't test eval blocking**: its evaluations go through DevTools, which is exempt from the CSP's eval ban. Tests assert the `script-src` directive instead.
- **`build/icon.ico` is generated and committed**: edit the SVGs, run `npm run icon`. Entries are PNG; .NET's old `System.Drawing.Icon` can't read them below 256 px, but Windows (WIC, Explorer) and electron-builder can.
- `scripts/*.ts` run under Node's type stripping: explicit `.ts` import extensions (`allowImportingTsExtensions` in `tsconfig.node.json`) and erasable syntax only (no enums, no parameter properties).
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

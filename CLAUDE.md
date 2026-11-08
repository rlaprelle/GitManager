# CLAUDE.md

Vue 3 + TypeScript + Vite + Tailwind v4 single-screen git client UI. Runs on in-memory sample data via `MockGitDataSource`; no real git yet. Deep dive: `docs/ARCHITECTURE.md`.

## Commands (PowerShell)

```powershell
npm install
npm run dev            # Vite dev server (http://localhost:5173 by default)
npm test               # Vitest, jsdom — unit + component + App wiring
npm run test:e2e       # Playwright; starts its own Vite on 4317 (--strictPort)
npm run typecheck      # vue-tsc -b (app, vitest, node project references)
npm run build          # vue-tsc -b && vite build → dist/
```

- First e2e run on a machine: `npx playwright install chromium`.
- `.claude/launch.json` config `git-manager-ui` = dev server on 5173 (`--strictPort`) for the preview pane.
- "Done" = typecheck + `npm test` + `npm run test:e2e` all green, plus a visual spot-check for UI changes.

## Structure

```
src/types/git.ts                 data model (Repository → Commit → FileChange → Hunk; GraphRow)
src/services/GitDataSource.ts    ONLY boundary to git (interface)
src/services/MockGitDataSource.ts  sample-data impl; ops return status messages only
src/data/sample*.ts              sample repos, diffs, SAMPLE_COMPARE_PATHS
src/composables/useGitManager.ts ALL state, derived state, actions
src/lib/{diff,graph,format}.ts   pure functions (diff rows, graph geometry, labels)
src/components/**                presentational: props in, emits out
src/App.vue                      wires composable ↔ components; layout
src/style.css                    @theme tokens (--color-gm-*), base styles
e2e/git-manager.spec.ts          Playwright acceptance tests
```

Unit/component tests follow the create-vue layout: `src/<dir>/X.ts` ↔ `src/<dir>/__tests__/X.spec.ts` (import the subject as `../X`). Playwright specs live in `e2e/`. `tsconfig.app.json` excludes `src/**/__tests__/*`; `tsconfig.vitest.json` includes only them.

## Architecture rules

- Components never call `GitDataSource` and hold no shared state. New behaviour → action/computed in `useGitManager`, wired in `App.vue`.
- Line/geometry logic lives in `src/lib/` (pure, unit-tested); components only render rows.
- Real git = new `GitDataSource` impl passed to `App` in `src/main.ts`. Don't leak backend concerns above the service layer.
- Graph layout (`GraphRow`) is supplied by the data source; UI doesn't assign lanes. Max 3 lanes — widening needs `LaneFlags`, `LANE_COLORS`, `GRAPH_WIDTH` together.
- Branch → commit lookup is by `tipHash`, never index.
- Composable invariants (tested; change deliberately): selection change resets file index + closes compare; compare forces `diffMode = 'simple'` and ignores `setDiffMode`; compare responses are race-guarded by a request counter; local state (`currentBranch`, `lastFetch`) changes only after the source resolves; failures → `status = "Failed: …"`.
- No router, no Pinia — single screen. Revisit only if a second screen needs shared state.

## Conventions

- `<script setup lang="ts">` SFCs only; `@/` alias = `src/`.
- Colours: use `gm-*` Tailwind tokens (`bg-gm-main`, `text-gm-muted`, …). No raw hex in components. Exception: lane colours in `lib/graph.ts` (SVG strokes, fixed by lane, independent of accent).
- New colour → add `--color-gm-*` to `@theme` in `src/style.css`.
- Monospace (`font-mono`, JetBrains Mono) for hashes, paths, code; Inter for UI.
- Responsive: `max-[860px]:` variant is the narrow breakpoint. Page must never scroll horizontally (e2e enforces at phone width); wide content scrolls inside its own pane.
- Test selectors: role/label first, then `data-testid` (`header-repo`, `header-branch`, `unified-diff`, `side-by-side-diff`, `left-label`, `right-label`); diff rows expose `data-kind`, side-by-side cells `data-side`/`data-cell`.
- Every new capability gets: lib/composable unit test, component test, `src/__tests__/App.spec.ts` wiring test if it crosses components, and a Playwright test that drives the UI.

## Constraints / quirks

- **TypeScript pinned `~6.0`.** TS 7 is the native compiler; `vue-tsc` 3 needs the JS compiler API. Don't bump without checking vue-tsc support.
- **Tailwind v4 is CSS-configured** (`@theme`, `@utility`, `@layer base` in `src/style.css`). There is no `tailwind.config.js`.
- **`toRaw(props.source)` in `App.vue` is required.** VTU/parents pass props as reactive proxies; `MockGitDataSource` uses `structuredClone`, which throws on proxies.
- **Playwright `reuseExistingServer: false` on port 4317** on purpose — another local Vite app may own a common port; tests must never hit a foreign server.
- `tsconfig.node.json` includes the `DOM` lib because e2e specs use `document` inside `page.evaluate`.
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

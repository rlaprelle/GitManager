# Git Manager

A desktop-style git client UI: repositories and branches on the left, a commit graph on top, and a diff viewer below with a git-style (unified) diff, a side-by-side "simple" diff, and a "compare two files" mode.

Built with Vue 3, TypeScript, Vite and Tailwind CSS v4.

## Running

```powershell
npm install
npm run dev
```

## Testing

```powershell
npm test               # unit + component tests (Vitest, jsdom)
npm run test:e2e       # acceptance tests that drive the UI (Playwright)
npm run typecheck
```

`npm run test:e2e` starts its own dev server on port 4317. On a new machine, run `npx playwright install chromium` once first.

## How it's put together

- `src/services/GitDataSource.ts` is the only contract between the UI and git. The app currently ships with `MockGitDataSource`, which serves sample repositories from `src/data/`. Remote operations (fetch, pull, push, checkout) only report a status message. Connecting to real repositories means implementing `GitDataSource` against a backend and passing it to `App` in `src/main.ts`.
- `src/composables/useGitManager.ts` holds all UI state and actions. Components under `src/components/` take props and emit events; they don't hold state of their own.
- `src/lib/diff.ts` turns hunks into unified and side-by-side rows. `src/lib/graph.ts` lays out the commit graph's lanes, lines and dots.
- Colors are Tailwind theme tokens in `src/style.css` (`bg-gm-*`, `text-gm-*`). Pass `accent` to `App` to re-theme the accent color.

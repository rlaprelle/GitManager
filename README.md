# Git Manager

A calm, dark-themed git client that puts the questions you ask most often on one screen. Which repository am I in? Which branch? What changed in this commit? How does this file differ from that one?

Git Manager is for developers who juggle several repositories and want a quick visual answer without reaching for the command line. That might be a service, its API client, a front end and a dotfiles repo all at once.

> **Status:** the interface is complete and runs on built-in sample repositories, both in a browser and as a Windows desktop app. It doesn't connect to real git yet. Fetch, Pull, Push, Checkout and Add repository report what they would do in the status bar. See [Connecting real repositories](#connecting-real-repositories).

## What you can do

- **Switch between repositories.** The sidebar lists every repository you've added and how many files have uncommitted changes in each.
- **See your branches.** Local branches show how far they are ahead of or behind their remote (`↑2 ↓1`), and the checked-out branch is marked `HEAD`. Click a branch to jump to its newest commit. Click **Checkout** to switch to it.
- **Read the history as a graph.** Commits are listed newest first beside a coloured lane graph that shows where branches split off and merge back. Branch labels sit on the commits they point to.
- **See what a commit changed.** Pick a commit, then a file, and read the change in one of two views:
  - **Git diff:** the familiar unified view with `+` and `-` lines and hunk headers.
  - **Simple diff:** old and new side by side, with removed lines on the left lined up against the added lines that replaced them.
- **Compare any two files.** Enter two paths to see them side by side, even when they don't share any history (for example, `application.yml` against `application-prod.yml`). Swap them with one click.
- **Fetch, pull and push** the current branch from the header.

## Core concepts

- **Current branch vs. selected branch.** The *current* branch is the one checked out (`HEAD`). The *selected* branch is the one you're looking at in the history. Browsing a branch never checks it out. Only the Checkout button does.
- **Git diff vs. simple diff.** A git diff is about one commit: what that commit did to a file. A simple diff only compares two pieces of text. Comparing two unrelated files only makes sense as a simple diff, so in compare mode the git diff view is turned off.
- **The status bar is the activity log.** Every action reports its outcome along the bottom of the window, including failures.

## Design principles

- **One screen, no modes to get lost in.** Repositories, branches, history and the diff are always visible together. Compare is the only other view, and its **Back to *commit*** button always takes you out of it.
- **Read-only until you ask.** Clicking around never changes your repository. Checkout, Fetch, Pull and Push are always separate, clearly labelled buttons.
- **Dense but quiet.** A dark palette, monospace type for anything git produces (hashes, paths, code), and colour reserved for meaning: green for additions, red for deletions, and the accent colour for what's selected.
- **Works narrow.** On a small window or a phone, the panes stack instead of shrinking past usefulness.

## Quick start

You need [Node.js](https://nodejs.org/). The project is developed and tested on Node 24. In PowerShell:

```powershell
npm install
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173).

To run it as the Windows desktop app instead:

```powershell
npm run dev:app        # opens an Electron window; edits to the UI reload live
```

## Development

```powershell
npm test               # unit and component tests (Vitest)
npm run test:e2e       # acceptance tests that drive the UI in a real browser (Playwright)
npm run test:e2e:app   # builds the desktop app, then drives it with Playwright's Electron support
npm run typecheck      # vue-tsc across app, Electron code, tests and config
npm run build          # type-check, then a browser build into dist/
npm run build:app      # type-check, then a desktop build into out/
npm run dist           # desktop build, then the Windows installer into release/
npm run icon           # regenerate build/icon.ico after editing build/icon.svg or icon-small.svg
```

- **Before your first e2e run:** run `npx playwright install chromium` once to download the test browser.
- **Test server port:** the e2e tests start their own server on port 4317, so they don't interfere with a dev server you already have running.
- **Works offline.** Fonts (Inter and JetBrains Mono) ship with the app, and a Content-Security-Policy lets the page load only its own files. The installer includes the fonts' licences in `resources\licenses`.
- **The installer is unsigned.** Windows SmartScreen warns about a downloaded copy ("Windows protected your PC" → **More info** → **Run anyway**). It installs for the current user only and needs no admin rights.

For how the code is organised, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Connecting real repositories

The interface talks to git through a single TypeScript interface, `GitDataSource` (`src/services/GitDataSource.ts`). It asks only for what the screen shows (a repository's branches, a page of history, one commit's files, one file's diff), so large repositories never have to be read in full. Today it's backed by `MockGitDataSource`, which serves sample data.

Real repositories will come through the desktop app: its Electron main process will run your installed Git for Windows and pass results to the interface over the preload bridge. The browser version keeps the sample data, so the interface can be developed and tested without touching a real repository.

## Built with

Vue 3, TypeScript, Vite and Tailwind CSS v4. The desktop app is Electron, built with electron-vite and packaged with electron-builder. Tested with Vitest and Playwright.

## License

[MIT](LICENSE)

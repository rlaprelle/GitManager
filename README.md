# Git Manager

A calm, dark-themed git client that puts the questions you ask most often on one screen. Which repository am I in? Which branch? What changed in this commit? How does this file differ from that one?

Git Manager is for developers who juggle several repositories and want a quick visual answer without reaching for the command line. That might be a service, its API client, a front end and a dotfiles repo all at once.

> **Status:** the Windows desktop app works on your real repositories with your installed Git for Windows: add or clone repositories, browse their branches, history and diffs, check out branches, fetch, pull and push, and merge branches, resolving conflicts on screen. The browser version runs on built-in sample repositories, where every button works against sample data. See [Real repositories](#real-repositories).

## What you can do

- **Clone a repository.** The clone button beside **+** (or **Clone repository…** on the first-run screen) asks for the repository's URL (`https://`, `ssh://`, `git://`, `file://` or `user@host:path`), the folder to clone into, and a folder name, filled in from the URL. git's progress shows as it goes, and **Cancel clone** stops it and removes the half-made folder. Cloning signs in the same way Fetch does. The clone is added to the list and opened. It clones the default branch, with full history and no submodules.
- **Add and switch between repositories.** Add a repository by choosing its folder (or any folder inside it); remove one from the list with its × button, which never touches the folder. The sidebar lists every repository you've added, how many files have uncommitted changes in each, and says so if a folder has been moved or deleted.
- **See your branches.** Local branches show how far they are ahead of or behind their remote (`↑2 ↓1`), and the checked-out branch is marked `HEAD`. Every branch, local and remote, shows the short hash of the commit it points to, the same hash as in the history's Commit column. Click a branch to jump to its newest commit. Click **Checkout** to switch to it. Uncommitted changes come along, as with `git switch`, and the status bar says how many did. If they would be overwritten, nothing happens and the status bar names the files. Checkout on a remote branch (`origin/feature`) creates the local branch that tracks it, unless you already have one. Leaving a detached HEAD whose commits aren't on any branch asks first.
- **Read the history as a graph.** Commits are listed newest first beside a coloured lane graph that shows where branches split off and merge back. `main` keeps the left-most lane, and the graph widens for busy histories (up to eight lanes). Branch labels sit on the commits they point to.
- **See what a commit changed.** Pick a commit, then a file, and read the change in one of two views:
  - **Git diff:** the familiar unified view with `+` and `-` lines and hunk headers.
  - **Simple diff:** old and new side by side, with removed lines on the left lined up against the added lines that replaced them.
- **Compare any two files.** See two files side by side, even when they don't share any history (for example, `application.yml` against `application-prod.yml`). Each side picks a repository from your list, a version (the working tree, or any local or remote branch), and a file: type its path, or click **Browse…**. On a branch, Browse… lists that branch's files with a filter. On the working tree, the desktop app opens the Windows file picker, where any file on disk will do. So you can compare one file on two branches, two different files, files from two repositories, or a repository's file with one from anywhere. The column headings say where each side comes from (`release/2.4 · pom.xml`, `pricing-api · main · pom.xml`). **Swap** exchanges everything about the two sides.
- **Arrange the screen.** Drag the lines between the sidebar and the main area, the repository and branch lists, the history and the diff, or the file list and the diff to resize them. Double-click a line to put it back. Each line can also take keyboard focus (Tab) and move with the arrow keys (Shift for bigger steps). Sizes are remembered for next time; on narrow screens, where the panes stack, there's nothing to drag.
- **See changes made elsewhere.** Commit, switch branches or edit files in your terminal or editor, and Git Manager catches up when you come back to its window, without losing the commit you were looking at. Press **F5** to refresh on demand.
- **Fetch, pull and push** from the header. The button you clicked says what's happening ("Fetching…") until git finishes, and the status bar says what happened:
  - **Fetch** updates every remote and drops branches deleted there: "Fetched: 2 branches updated, 1 new, 1 removed". The ↑/↓ counts and "Last fetch" update with it.
  - **Pull** brings the checked-out branch up to its remote branch, but only when that is a plain fast-forward: "Pulled 3 commits from origin/main". If you and the remote both have new commits, your branch stays where it is and the Merge dialog offers to merge the remote branch. Uncommitted changes that would be overwritten are named, as with Checkout.
  - **Push** sends the checked-out branch to the remote branch it tracks: "Pushed 2 commits to origin/feature". It never forces: if the remote has commits you don't, it says to pull first. A branch that tracks nothing yet is published to `origin` and tracks it from then on.
  - **Signing in** uses git's own windows: Git Credential Manager for HTTPS, and Git for Windows' password window for an SSH passphrase or a server's unknown host key.
  - **A stalled connection fails with git's reason**: after 20 seconds trying to connect, or a minute with nothing moving. A slow transfer that keeps moving is never cut off.
- **Merge a branch, with nothing on disk changing until you're done.** **Merge…** in the header merges a branch you pick into the checked-out one (to merge somewhere else, check that branch out first). The dialog says beforehand what will happen: how many commits come in, whether the branch just moves forward or gets a merge commit (following git's default and your `merge.ff` setting), and which files conflict. A merge with no conflicts completes straight away. With conflicts, the merge screen opens:
  - **Three panes, lined up:** *Ours* (your branch), the *Result*, and *Theirs* (the branch coming in). Changes only one side made are already in; their arrow takes them back out.
  - **Arrows bring in a side.** Each conflict has an arrow from each side. Use one or both: they stack in the order you click, and clicking again takes a side back. The conflict also shows what the lines were before either branch changed them, and what each branch did. **Edit by hand** opens a box for just that conflict, for when the answer is a mix of both. **Use neither side** drops the lines.
  - **Finishing:** **Mark resolved** is an optional checkpoint for your own tracking; it stages nothing. **Complete merge** makes the merge commit and only then updates your files. **Discard merge** walks away, and there's nothing to undo because nothing changed. Merge commits are signed if your git signs commits, but commit hooks don’t run. Close the app halfway and your choices are still there next time. If a branch moves meanwhile, the merge is worked out again and your choices are kept for the files that came out the same.
  - **Left to a terminal:** files deleted on one side, binary files, Git LFS files, files that aren't UTF-8 text, and links can't be resolved here, and the dialog says so before anything starts. Files the merge would overwrite (uncommitted changes, or untracked and ignored files in the way) must be committed, stashed or moved first; other uncommitted work is left alone. A merge, rebase or cherry-pick already under way outside the app gets a notice and is left for you to finish there. Merging needs git 2.38 or newer; with older git the button doesn't appear.

## Core concepts

- **Current branch vs. selected branch.** The *current* branch is the one checked out (`HEAD`). The *selected* branch is the one you're looking at in the history. Browsing a branch never checks it out. Only the Checkout button does.
- **Git diff vs. simple diff.** A git diff is about one commit: what that commit did to a file. A simple diff only compares two pieces of text. Comparing two unrelated files only makes sense as a simple diff, so in compare mode the git diff view is turned off.
- **The status bar is the activity log.** Every action reports its outcome along the bottom of the window, including failures. What you mustn't miss also comes as a notification.

## Design principles

- **One screen, no modes to get lost in.** Repositories, branches, history and the diff are always visible together. Compare and the merge screen are the only other views, and each shows the way out: **Back to *commit***, or **Discard merge** and **Complete merge**.
- **Nothing changes until you ask.** Clicking around never changes your repository. Checkout, Fetch, Pull, Merge and Push are always separate, clearly labelled buttons, and one runs at a time. A merge touches no file until you complete it.
- **What matters comes to you.** A line in the status bar is easy to miss. Anything you need to know that you didn't just ask for appears as a notification over the corner of the window, and stays there until you dismiss it.
- **Dense but quiet.** A dark palette, monospace type for anything git produces (hashes, paths, code), and colour reserved for meaning: green for additions, red for deletions, and the accent colour for what's selected.
- **Works narrow.** On a small window or a phone, the panes stack instead of shrinking past usefulness.

## Quick start

You need [Node.js](https://nodejs.org/) (developed and tested on Node 24), and for the desktop app [Git for Windows](https://git-scm.com/download/win) 2.30 or newer. In PowerShell:

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
- **Updates itself.** The installed app checks this repository's [Releases](https://github.com/rlaprelle/GitManager/releases) when it starts and every 4 hours, downloads a newer version in the background, and offers **Restart now** in the status bar. An update you don't restart for installs when you quit. Development runs never check.

### Cutting a release

Releases are built by GitHub Actions (`.github/workflows/release.yml`), started by hand, from `main`. The version is `package.json`'s.

1. On `dev`, bump the version without tagging. In PowerShell:

   ```powershell
   npm version 0.2.3 --no-git-tag-version
   ```

   Then commit, and merge `dev` into `main` as usual.
2. On GitHub, open **Actions → Release → Run workflow**, on `main`.

   The workflow refuses a version that's already tagged or already has a release, including an unpublished draft. Then it runs typecheck and all four test suites, builds the installer, and makes a **draft** release, aimed at the commit it tested, with the installer and `latest.yml` (what installed apps check). If anything fails, it leaves nothing behind.
3. Open the draft on the Releases page, add notes, and **Publish release**. Publishing creates the tag `v0.2.3`, so a tag always means a published release. Installed apps see the release only once it's published.

Don't create releases or push `v*` tags by hand. The workflow would refuse that version afterwards, and the release would have no installer.

Because the installer is unsigned, an update is trusted by the SHA-512 checksum in `latest.yml`, downloaded over HTTPS from GitHub; there is no signature to check. Anyone who can publish a release here can therefore ship code to every installed copy.

For how the code is organised, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Real repositories

The interface talks to git through a single TypeScript interface, `GitDataSource` (`src/services/GitDataSource.ts`). It asks only for what the screen shows (a repository's branches, a page of history, one commit's files, one file's diff), so large repositories never have to be read in full: the history shows the newest 200 commits, and **Show more commits** at the end of the list adds 200 at a time.

- **Desktop app:** its Electron main process runs your installed Git for Windows, so it uses your own git settings, and passes results to the interface over the preload bridge. Reading never takes git's locks, so it can't get in the way of your own git commands; Checkout, Pull and the rest run git as your own commands do, with your credential helper, SSH keys and hooks. If git is missing or older than 2.30, the app says so instead of starting (merging needs 2.38; with older git its button is hidden). Your repository list is kept in `%APPDATA%\git-manager\repositories.json`.
- **Browser version:** keeps the sample data (`MockGitDataSource`), so the interface can be developed and tested without touching a real repository.

Renamed files show as one change ("renamed from …", or "moved from …" when only the folder changed), diffed against their old version. Not tried yet: submodules and Git LFS (an LFS checkout that needs to sign in will fail: only Fetch, Pull and Push may ask you to sign in). A branch checked out in another worktree can't be checked out here; git's message says where it is.

The installed app has no menu: Ctrl+R (reload) and Ctrl+Shift+I (DevTools) do nothing, and F5 refreshes. `npm run dev:app` keeps both for development.

## Built with

Vue 3, TypeScript, Vite and Tailwind CSS v4. The desktop app is Electron, built with electron-vite and packaged with electron-builder. Tested with Vitest and Playwright.

## License

[MIT](LICENSE)

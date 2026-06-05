# Changelog

All notable changes to the **Launchpad** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.9.2] - 2026-06-05

### Fixed
- **Worktree launches failed with "a branch named 'launchpad/…' already exists" and no worktree was created.** Removing a worktree left its `launchpad/<env>-<n>` branch behind, and the next launch picked the next free *directory* slot without checking whether that slot's *branch* already existed — so `git worktree add -b` aborted. `nextWorktreePaths` now skips any slot whose directory **or** branch name is taken, and `removeWorktree` deletes the throwaway `launchpad/*` branch so names free up for reuse.
- Worktree path matching now resolves symlinks (e.g. macOS `/tmp` → `/private/tmp`), so branch cleanup and worktree lookups work when the repo lives under a symlinked path.

## [0.9.1] - 2026-06-05

### Fixed
- Worktree env-file seeding no longer runs a synchronous `git ls-files --others --ignored` on the extension host's UI thread. In a large monorepo that enumerated the entire ignored tree (every `node_modules`, build output, …), which could overflow Node's child-process buffer and freeze the window during launch. Discovery now uses VS Code's async indexed file search and only ever touches `.env` files.

## [0.9.0] - 2026-06-05

### Added
- **Worktree env-file seeding** — `git worktree add` only checks out tracked files, so gitignored `.env` files (e.g. `apps/*/.env` in a monorepo) were missing from worktree sessions. Launchpad now copies them in automatically: by default it detects gitignored `.env` / `.env.*` files (skipping `.env.example`/`.sample`/`.template`) and copies each to the same relative path in the new worktree.
- New `claude.worktreeCopy` setting to control exactly which untracked files are copied: provide a list of globs (VS Code glob syntax, repo-root-relative) to copy those instead of auto-detecting, or set it to `[]` to copy nothing. Copy failures warn but never abort the launch.

## [0.8.0] - 2026-06-04

### Added
- **Worktree session recovery** — a top-level **Worktrees** section in the sidebar lists every active worktree session so you can find your way back after a crash or restart, even with several sessions running at once. Each entry shows its environment and branch, with actions to **Open in New Window**, **Reveal in File Explorer**, **Open Terminal**, and **Remove Worktree**.
- Launchpad now records each worktree session (environment → worktree mapping) in `.claude/worktrees/.launchpad-sessions.json`, and self-heals the list when worktrees are removed outside the extension.

### Changed
- `claude.worktree: true` now creates and tracks the worktree itself under `.claude/worktrees/<env>-<n>` on a `launchpad/<env>-<n>` branch and launches the session there, instead of delegating to the `claude` CLI's `-w` flag. This is what makes sessions findable afterwards. Non-git workspaces warn and fall back to the workspace root.

### Fixed
- Added `.claude/worktrees/` to `.gitignore` so generated worktrees and the session record are never committed.

## [0.7.2] - 2026-04-02

### Removed
- Removed unused terminal name auto-update on git branch changes (dead code cleanup)

### Fixed
- Added `.DS_Store` to `.gitignore`

## [0.7.1] - 2026-03-28

### Changed
- Rewrote README for clarity and conciseness
- Added sidebar screenshot to README
- Reorganized README sections (install and requirements moved to top)

## [0.7.0] - 2026-03-28

### Changed
- Switched from npm to bun as the project package manager
- Updated all build scripts, examples, and documentation to use bun/bunx
- Moved Getting Started section to top of README for better discoverability
- Removed marketplace install instructions (not yet published)

## [0.6.1] - 2026-03-28

### Added
- Release skill for streamlined extension packaging and publishing

## [0.6.0] - 2026-03-28

### Added
- Inline tree editing: edit values directly from the sidebar without opening YAML
- Add/delete items from the tree view (databases, variables, accounts, etc.)
- "Open in YAML" action to jump to the exact line in the source file
- WebView-based editor panel in the sidebar for visual environment editing
- YAML manipulation utilities that preserve formatting and comments

### Changed
- Improved tree view with richer context menus and inline actions

## [0.5.0] - 2026-03-27

### Added
- Script execution from the sidebar with run/stop controls
- Split terminal support for scripts
- Docker Compose integration with lifecycle management (`docker` config block)
- Docker container status in health checks

## [0.4.0] - 2026-03-27

### Added
- Smart terminal tab naming with git branch, PR number, and worktree detection
- Auto-detected icons per environment type (warning for prod, beaker for staging, tools for dev)
- Dynamic tab updates when switching branches
- PR number lookup via GitHub CLI (cached with 60s TTL)
- Custom `tabName` and `icon` fields in environment YAML

## [0.3.0] - 2026-03-27

### Added
- Health check command for databases (TCP socket) and APIs (HTTP HEAD)
- Redis PING/PONG health check support
- Per-environment MCP server configuration via `--mcp-config`
- Pre-launch hooks with timeout and `continueOnError` support
- Progress notifications during hook execution

## [0.2.0] - 2026-03-27

### Added
- Secret resolution at launch time: 1Password CLI (`op://`), `.env` file lookup (`env://`), OS environment variables (`$VAR`), macOS Keychain / Linux secret-tool (`keychain://`)
- Copy Connection String, Copy Username, Copy Password actions
- Import from `.env` file with auto-detection of secrets, database URLs, and API endpoints
- Duplicate environment command
- Status bar showing active environment

## [0.1.0] - 2026-03-27

### Added
- Initial release
- Sidebar tree view showing environments with nested databases, accounts, APIs, and variables
- Launch Claude Code session with `--append-system-prompt` containing full environment context
- YAML-based environment definitions in `.launchpad/` directory
- Create new environment from template
- Select and activate environments from the Command Palette
- Environment variable support
- Custom system prompt per environment
- Claude CLI flags: `dangerouslySkipPermissions`, `model`, `allowedTools`, `environmentVariables`

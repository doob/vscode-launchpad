# Changelog

All notable changes to the **Launchpad** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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

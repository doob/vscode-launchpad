# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A VS Code extension ("Launchpad") that manages predefined environment configs for Claude Code sessions. Users define YAML files in `.launchpad/` describing databases, credentials, APIs, MCP servers, scripts, and hooks — then launch a fully-configured `claude` CLI session from the sidebar with one click.

## Build & Development

```bash
bun install                  # install dependencies
bun run build                # esbuild bundle → dist/extension.js
bun run compile              # tsc type-check → out/
bun run watch                # tsc in watch mode
bun run lint                 # eslint
bun run package              # produce .vsix for installation
```

Press **F5** in VS Code to launch the Extension Development Host for debugging.

The production entry point is `dist/extension.js` (esbuild bundle). The `out/` directory is from `tsc` and used for type-checking only — the extension loads from `dist/`.

## Architecture

**Entry point:** `src/extension.ts` — registers all VS Code commands, tree view, status bar, file/git watchers, and orchestrates the launch flow.

**Launch flow** (in `launchSession`):
1. `parser.ts` loads YAML/JSON → `EnvironmentConfig`
2. `secrets.ts` resolves secret references (`op://`, `env://`, `$VAR`, `keychain://`) at launch time
3. `generator.ts` builds a plain-text system prompt from the resolved config
4. `extension.ts` runs pre-launch hooks and writes a temp MCP config if needed
5. If `claude.worktree` is true, `worktrees.ts` creates a git worktree under `.claude/worktrees/<env-slug>-<n>` on a new branch `launchpad/<env-slug>-<n>`, writes a session record, and sets the terminal cwd to the worktree directory. It also seeds the worktree with untracked files (git only checks out tracked files): `claude.worktreeCopy` globs if set, otherwise auto-detected gitignored `.env` files
6. `extension.ts` opens a VS Code terminal running `claude --append-system-prompt ...` (cwd = the worktree when one was created)

**Key modules:**
- `types.ts` — all TypeScript interfaces (`EnvironmentConfig`, `DatabaseConfig`, `ClaudeSettings`, etc.)
- `parser.ts` — YAML/JSON file discovery and loading
- `secrets.ts` — secret resolution (1Password CLI, .env files, OS env vars, macOS Keychain/Linux secret-tool) and `.env` file parsing
- `generator.ts` — converts `EnvironmentConfig` into the markdown system prompt string
- `gitContext.ts` — git branch/PR/worktree detection for smart terminal tab names; PR lookups are cached (60s TTL) and async to avoid blocking
- `worktrees.ts` — owns git worktree creation for `claude.worktree` sessions, the on-disk session record (`.claude/worktrees/.launchpad-sessions.json`), helpers to list/reconcile/remove worktrees for the sidebar, and seeding untracked files into a new worktree (`detectEnvFiles`, `copyFilesIntoWorktree`)
- `treeView.ts` — sidebar tree data provider showing environments with nested details (databases, accounts, APIs, variables, MCP servers, scripts, hooks)
- `healthCheck.ts` — TCP socket checks for databases (with Redis PING/PONG), HTTP HEAD for APIs

**Single dependency:** `yaml` (for YAML parsing). Everything else is Node built-ins or the VS Code API.

## Environment YAML Files

Stored in `.launchpad/` (configurable via `launchpad.environmentsDir` setting). The schema is defined by `EnvironmentConfig` in `types.ts`. Environments support: `systemPrompt`, `variables`, `databases`, `accounts`, `apis`, `mcpServers`, `scripts`, `hooks.preLaunch`, `claude` (CLI flags), and freeform `sections`.


## Maintenance

- On all updates, make sure all references in example files and README is updated accordingly
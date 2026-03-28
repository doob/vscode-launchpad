# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A VS Code extension ("Launchpad") that manages predefined environment configs for Claude Code sessions. Users define YAML files in `.launchpad/` describing databases, credentials, APIs, MCP servers, scripts, and hooks — then launch a fully-configured `claude` CLI session from the sidebar with one click.

## Build & Development

```bash
npm install                  # install dependencies
npm run build                # esbuild bundle → dist/extension.js
npm run compile              # tsc type-check → out/
npm run watch                # tsc in watch mode
npm run lint                 # eslint
npm run package              # produce .vsix for installation
```

Press **F5** in VS Code to launch the Extension Development Host for debugging.

The production entry point is `dist/extension.js` (esbuild bundle). The `out/` directory is from `tsc` and used for type-checking only — the extension loads from `dist/`.

## Architecture

**Entry point:** `src/extension.ts` — registers all VS Code commands, tree view, status bar, file/git watchers, and orchestrates the launch flow.

**Launch flow** (in `launchSession`):
1. `parser.ts` loads YAML/JSON → `EnvironmentConfig`
2. `secrets.ts` resolves secret references (`op://`, `env://`, `$VAR`, `keychain://`) at launch time
3. `generator.ts` builds a plain-text system prompt from the resolved config
4. `extension.ts` writes a temp MCP config if needed, runs pre-launch hooks, then opens a VS Code terminal running `claude --append-system-prompt ...`

**Key modules:**
- `types.ts` — all TypeScript interfaces (`EnvironmentConfig`, `DatabaseConfig`, `ClaudeSettings`, etc.)
- `parser.ts` — YAML/JSON file discovery and loading
- `secrets.ts` — secret resolution (1Password CLI, .env files, OS env vars, macOS Keychain/Linux secret-tool) and `.env` file parsing
- `generator.ts` — converts `EnvironmentConfig` into the markdown system prompt string
- `gitContext.ts` — git branch/PR/worktree detection for smart terminal tab names; PR lookups are cached (60s TTL) and async to avoid blocking
- `treeView.ts` — sidebar tree data provider showing environments with nested details (databases, accounts, APIs, variables, MCP servers, scripts, hooks)
- `healthCheck.ts` — TCP socket checks for databases (with Redis PING/PONG), HTTP HEAD for APIs

**Single dependency:** `yaml` (for YAML parsing). Everything else is Node built-ins or the VS Code API.

## Environment YAML Files

Stored in `.launchpad/` (configurable via `launchpad.environmentsDir` setting). The schema is defined by `EnvironmentConfig` in `types.ts`. Environments support: `systemPrompt`, `variables`, `databases`, `accounts`, `apis`, `mcpServers`, `scripts`, `hooks.preLaunch`, `claude` (CLI flags), and freeform `sections`.

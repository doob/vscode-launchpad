# Launchpad

[![Version](https://img.shields.io/visual-studio-marketplace/v/doob.launchpad)](https://marketplace.visualstudio.com/items?itemName=doob.launchpad)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/doob.launchpad)](https://marketplace.visualstudio.com/items?itemName=doob.launchpad)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Launch fully-configured Claude Code sessions with one click.** Define databases, credentials, API endpoints, MCP servers, scripts, and system prompts in YAML -- then select an environment from the sidebar and go.

No more copy-pasting connection strings. No more forgetting which account to use. No more manually setting up MCP servers. Launchpad gives Claude the full context of your environment so you can start working immediately.

## Getting Started

### Install from Marketplace

Search for **"Launchpad"** in the VS Code Extensions view, or install from the command line:

```bash
code --install-extension doob.launchpad
```

### Install from Source

```bash
git clone https://github.com/doob/vscode-launchpad.git
cd vscode-launchpad
bun install
bun run package
code --install-extension launchpad-*.vsix
```

Or open the folder in VS Code and press **F5** to launch in debug mode.

### Create Your First Environment

1. Open the Command Palette and run **Launchpad: Create New Environment**
2. Enter a name (e.g., "Local Dev")
3. Edit the generated YAML in `.launchpad/local-dev.yaml`
4. Click the play button next to the environment in the sidebar

### Quick Start from .env

Already have a `.env` file? Run **Launchpad: Import from .env** to generate a starter environment YAML automatically.

## How It Works

1. Create YAML files in `.launchpad/` describing your environments
2. Pick one from the sidebar and click **Launch Session**
3. The extension runs `claude` in a VS Code terminal with `--append-system-prompt` containing your full environment context -- databases, credentials, APIs, variables, and any custom instructions

Claude starts every session knowing exactly where it is, what it can access, and how things are set up.

## Features

### Sidebar Environment Panel

Browse all environments in a dedicated sidebar. Each environment expands to show its databases, accounts, APIs, variables, MCP servers, scripts, and hooks. Launch, edit, duplicate, or health-check any environment directly from the tree view.

<!-- ![Sidebar screenshot](images/screenshot-sidebar.png) -->

### Secret Resolution

Passwords and sensitive values support references that are resolved at launch time only -- secrets are never written to disk:

| Format | Source |
|--------|--------|
| `op://vault/item/field` | 1Password CLI |
| `env://.env.local/DB_PASS` | `.env` file lookup |
| `$DB_PASSWORD` | OS environment variable |
| `keychain://service/account` | macOS Keychain / Linux secret-tool |

```yaml
databases:
  - label: "Production DB"
    type: postgres
    host: db.example.com
    password: "op://Engineering/DB/password"  # resolved at launch
```

### Per-Environment MCP Servers

Each environment can define its own MCP servers. Launchpad writes a temporary config and passes it to Claude via `--mcp-config`:

```yaml
mcpServers:
  - name: "postgres"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@localhost/db"]
  - name: "sentry"
    command: "npx"
    args: ["-y", "@sentry/mcp-server"]
    env:
      SENTRY_AUTH_TOKEN: "op://Engineering/Sentry/token"
```

### Pre-Launch Hooks

Run setup commands before Claude starts. A progress notification shows execution status. The launch aborts on failure unless `continueOnError` is set:

```yaml
hooks:
  preLaunch:
    - command: "docker compose up -d"
      continueOnError: true
    - command: "bun run migrate"
      timeout: 60000
```

### Health Checks

Right-click an environment and select **Health Check** to verify connectivity before launching:

- **Databases** -- TCP socket connect (Redis gets a PING/PONG check)
- **APIs** -- HTTP HEAD request
- **Docker** -- Container status check

Results appear in the "Launchpad Health" output panel with pass/fail and latency.

### Scripts

Define and run project scripts directly from the sidebar:

```yaml
scripts:
  - label: "Dev Server"
    command: "bun run dev"
    split: true           # opens in a split terminal
  - label: "Seed Database"
    command: "bun run seed"
    cwd: "./backend"
```

### Docker Compose Integration

Automatically manage Docker services when launching an environment:

```yaml
docker:
  composeFile: "docker-compose.yml"
  services: ["db", "redis"]
  upOnLaunch: true
  waitHealthy: true
  waitTimeout: 60
```

### Smart Terminal Tabs

Terminal tabs show the environment name plus live git context:

```
Claude: Staging [PR#87 - JIRA-123]
Claude: Local Dev [wt:hotfix - fix-auth]
```

- Auto-detected icons per environment type (warning for prod, beaker for staging, tools for dev)
- Dynamic updates when you switch branches
- PR number lookup via GitHub CLI
- Customizable via `icon` and `tabName` in the YAML

### Copy Credentials

Right-click any database or account in the tree:

- **Copy Connection String** -- builds `postgres://user:pass@host:port/db`
- **Copy Username / Copy Password**

### Import from .env

Import an existing `.env` file to scaffold an environment YAML. Auto-detects:

- Secret-looking keys (`PASSWORD`, `TOKEN`, `KEY`, etc.) marked as `secret: true`
- `DATABASE_URL` parsed into a `databases:` entry
- `API_URL` / `BASE_URL` parsed into `apis:` entries

### Claude CLI Flags

Override Claude Code settings per environment:

```yaml
claude:
  dangerouslySkipPermissions: true
  model: "claude-sonnet-4-6"
  allowedTools:
    - "Bash(git:*)"
    - "Read"
    - "Edit"
  environmentVariables:
    DEBUG: "true"
```

### Inline Editing

Edit environment values directly from the sidebar tree view -- no need to open the YAML file. Add or remove databases, variables, accounts, and more from the context menu.

## Environment YAML Schema

Full reference for `.launchpad/*.yaml` files:

```yaml
name: "staging"
description: "Staging environment"
icon: "beaker"                      # VS Code codicon name (optional)
tabName: "Staging API"              # Custom terminal tab name (optional)

claude:
  dangerouslySkipPermissions: false
  model: "claude-sonnet-4-6"
  allowedTools: ["Bash(git:*)", "Read", "Edit"]
  environmentVariables:
    DEBUG: "true"

systemPrompt: |
  You are working in the staging environment.
  Be careful with destructive operations.

variables:
  - name: NODE_ENV
    value: "staging"
  - name: API_KEY
    value: "op://vault/item/key"
    secret: true                    # resolved at launch, never logged

databases:
  - label: "App DB"
    type: postgres                  # postgres, mysql, redis, mongo, etc.
    host: staging-db.example.com
    port: 5432
    database: myapp
    username: myapp
    password: "op://vault/db/password"
    notes: "Read replica at staging-db-ro.example.com"

accounts:
  - label: "Admin"
    username: admin@example.com
    password: "env://.env.staging/ADMIN_PASS"
    role: admin
    notes: "Full access"

apis:
  - label: "REST API"
    url: "https://staging-api.example.com/v2"
    auth: "Bearer token from /auth/login"

mcpServers:
  - name: "postgres"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://..."]
    env:
      SOME_VAR: "value"

docker:
  composeFile: "docker-compose.yml"
  services: ["db", "redis"]
  upOnLaunch: true
  downOnExit: false
  waitHealthy: true
  waitTimeout: 60

scripts:
  - label: "Dev Server"
    command: "bun run dev"
    cwd: "./backend"
    split: true

hooks:
  preLaunch:
    - command: "docker compose up -d"
      continueOnError: true
      timeout: 30000

sections:                           # freeform markdown sections
  Deployment: |
    Branch `develop` auto-deploys to staging.
```

## Commands

All commands are available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| **Launchpad: Select Environment** | Pick an environment from a quick-pick list |
| **Launchpad: Launch Session** | Launch Claude with the selected environment |
| **Launchpad: Create New Environment** | Scaffold a new YAML template |
| **Launchpad: Import from .env** | Generate environment YAML from a `.env` file |
| **Launchpad: Edit Current Environment** | Open the active environment's YAML file |
| **Launchpad: Duplicate** | Clone an existing environment |
| **Launchpad: Health Check** | Test database and API connectivity |
| **Launchpad: Clear Active** | Deactivate the current environment |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `launchpad.environmentsDir` | `.launchpad` | Directory for environment YAML files (relative to workspace root) |

## Requirements

- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** installed and on your PATH
- **VS Code 1.85** or later

### Optional

- [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) -- enables autocomplete, validation, and hover docs in `.launchpad/*.yaml` files
- [1Password CLI](https://1password.com/downloads/command-line/) -- for `op://` secret references
- [GitHub CLI](https://cli.github.com/) -- for PR number detection in terminal tabs
- [Docker](https://www.docker.com/) -- for Docker Compose integration

## License

[MIT](LICENSE)

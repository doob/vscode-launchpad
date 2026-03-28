# Launchpad — VS Code Extension for Claude Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/doob.launchpad)](https://marketplace.visualstudio.com/items?itemName=doob.launchpad)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/doob.launchpad)](https://marketplace.visualstudio.com/items?itemName=doob.launchpad)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

VS Code extension that manages environment configurations for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions. Define databases, credentials, API endpoints, MCP servers, scripts, and system prompts in YAML files — then launch a configured `claude` CLI session from the sidebar.

![Launchpad sidebar showing environments](images/screenshot-sidebar.png)

## Install

Download the latest `.vsix` from [GitHub Releases](https://github.com/doob/vscode-launchpad/releases):

```bash
code --install-extension launchpad-*.vsix
```

Or build from source:

```bash
git clone https://github.com/doob/vscode-launchpad.git
cd vscode-launchpad
bun install
bun run package
code --install-extension launchpad-*.vsix
```

### Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) on your PATH
- VS Code 1.85+

### Optional

- [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) — autocomplete and validation for `.launchpad/*.yaml` files
- [1Password CLI](https://1password.com/downloads/command-line/) — for `op://` secret references
- [GitHub CLI](https://cli.github.com/) — for PR number detection in terminal tabs
- [Docker](https://www.docker.com/) — for Docker Compose integration

## How It Works

1. Create YAML files in `.launchpad/` describing your environments
2. Select an environment from the Launchpad sidebar panel
3. Click **Launch Session** — the extension opens a VS Code terminal running `claude` with `--append-system-prompt` containing your environment context (databases, credentials, APIs, variables, custom instructions)

## Features

### Sidebar Panel

Environments are listed in a dedicated sidebar. Each one expands into a tree showing its databases, accounts, APIs, variables, MCP servers, scripts, and hooks. Right-click for actions like launch, edit, duplicate, and health check.

### Secret Resolution

Secret references are resolved at launch time — values are not written to disk.

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
    password: "op://Engineering/DB/password"
```

### MCP Servers

Each environment can define MCP servers. A temporary config is written and passed to Claude via `--mcp-config`:

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

Commands that run before the Claude session starts. The launch aborts on failure unless `continueOnError` is set:

```yaml
hooks:
  preLaunch:
    - command: "docker compose up -d"
      continueOnError: true
    - command: "bun run migrate"
      timeout: 60000
```

### Health Checks

Right-click an environment and select **Health Check** to test connectivity:

- **Databases** — TCP socket connect (Redis gets a PING/PONG check)
- **APIs** — HTTP HEAD request
- **Docker** — container status check

Results appear in the "Launchpad Health" output panel.

### Scripts

Run project scripts from the sidebar:

```yaml
scripts:
  - label: "Dev Server"
    command: "bun run dev"
    split: true
  - label: "Seed Database"
    command: "bun run seed"
    cwd: "./backend"
```

### Docker Compose

Start Docker services on launch and optionally wait for healthy status:

```yaml
docker:
  composeFile: "docker-compose.yml"
  services: ["db", "redis"]
  upOnLaunch: true
  waitHealthy: true
  waitTimeout: 60
```

### Terminal Tabs

Terminal tabs show the environment name and git context:

```
Claude: Staging [PR#87 - JIRA-123]
Claude: Local Dev [wt:hotfix - fix-auth]
```

Icons are auto-detected per environment type. PR numbers are looked up via GitHub CLI. Customizable via `icon` and `tabName` in the YAML.

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

### Import from .env

Generate an environment YAML from an existing `.env` file. Auto-detects `DATABASE_URL` (parsed into `databases:`), `API_URL`/`BASE_URL` (parsed into `apis:`), and secret-looking keys (`PASSWORD`, `TOKEN`, `KEY`) marked as `secret: true`.

### Inline Editing

Edit environment values directly from the sidebar tree view. Add or remove databases, variables, accounts, and more from the context menu.

### Copy Credentials

Right-click any database or account in the tree to copy connection strings, usernames, or passwords.

## Environment YAML Schema

Full reference for `.launchpad/*.yaml` files:

```yaml
name: "staging"
description: "Staging environment"
icon: "beaker"                      # VS Code codicon name (optional)
tabName: "Staging API"              # custom terminal tab name (optional)

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
    secret: true

databases:
  - label: "App DB"
    type: postgres
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

sections:
  Deployment: |
    Branch `develop` auto-deploys to staging.
```

## Commands

Available from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

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

## License

[MIT](LICENSE)

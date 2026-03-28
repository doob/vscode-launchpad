import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import * as os from "os";
import { discoverEnvironments, loadEnvironment } from "./parser";
import { buildSystemPrompt } from "./generator";
import { EnvironmentTreeProvider, EnvTreeItem } from "./treeView";
import { EditorWebviewProvider } from "./editorWebview";
import { EnvironmentConfig } from "./types";
import {
  getGitContext,
  getGitContextFast,
  invalidateCache,
  GitContext,
} from "./gitContext";
import { resolveAllSecrets, parseEnvFile } from "./secrets";
import {
  checkDatabase,
  checkApi,
  checkDocker,
  buildComposeArgs,
  HealthResult,
} from "./healthCheck";
import {
  updateYamlValue,
  deleteYamlItem,
  addYamlArrayItem,
  findYamlLineNumber,
} from "./yamlEditor";

let statusBarItem: vscode.StatusBarItem;
let fileWatcher: vscode.FileSystemWatcher | undefined;
let gitWatcher: vscode.FileSystemWatcher | undefined;
let treeProvider: EnvironmentTreeProvider;
let editorWebview: EditorWebviewProvider;
let healthOutputChannel: vscode.OutputChannel | undefined;

// Track active terminals so we can update their names
const trackedTerminals = new Map<
  vscode.Terminal,
  { envName: string; baseName: string; envConfig?: EnvironmentConfig; workspaceRoot?: string }
>();

// Track running script terminals (key = "envName::scriptLabel")
const runningScripts = new Map<string, vscode.Terminal>();

// Track temp MCP config files for cleanup
const tempMcpFiles: string[] = [];

export function activate(context: vscode.ExtensionContext) {
  const root = getWorkspaceRoot();

  // Tree view
  treeProvider = new EnvironmentTreeProvider(root, () => getConfig().envDir);
  treeProvider.setRunningScriptsProvider(() => new Set(runningScripts.keys()));
  const activeEnv = context.workspaceState.get<string>("activeEnvironment");
  treeProvider.setActive(activeEnv);

  const treeView = vscode.window.createTreeView("launchpad.environmentList", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Editor webview
  editorWebview = new EditorWebviewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      EditorWebviewProvider.viewId,
      editorWebview
    )
  );

  // Open webview editor when a tree item is selected
  treeView.onDidChangeSelection((e) => {
    const item = e.selection[0];
    if (item?.envConfig && item.filePath) {
      editorWebview.setEnvironment(item.envConfig, item.filePath);
    }
  });

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50
  );
  statusBarItem.command = "launchpad.selectEnvironment";
  statusBarItem.tooltip = "Click to switch environment";
  context.subscriptions.push(statusBarItem);
  refreshStatusBar(context);

  // Commands
  context.subscriptions.push(
    // Core commands
    vscode.commands.registerCommand("launchpad.selectEnvironment", () =>
      selectEnvironment(context)
    ),
    vscode.commands.registerCommand("launchpad.createEnvironment", () =>
      createEnvironment(context)
    ),
    vscode.commands.registerCommand("launchpad.editEnvironment", () =>
      editEnvironment(context)
    ),
    vscode.commands.registerCommand("launchpad.clearEnvironment", () =>
      clearEnvironment(context)
    ),
    vscode.commands.registerCommand(
      "launchpad.launchSession",
      (item?: EnvTreeItem) => launchSession(context, item)
    ),
    vscode.commands.registerCommand("launchpad.refreshTree", () =>
      treeProvider.refresh()
    ),
    vscode.commands.registerCommand(
      "launchpad.editEnvFile",
      (item?: EnvTreeItem) => editEnvFile(item)
    ),

    // Copy commands
    vscode.commands.registerCommand(
      "launchpad.copyConnectionString",
      (item?: EnvTreeItem) => copyConnectionString(item)
    ),
    vscode.commands.registerCommand(
      "launchpad.copyPassword",
      (item?: EnvTreeItem) => copyPassword(item)
    ),
    vscode.commands.registerCommand(
      "launchpad.copyUsername",
      (item?: EnvTreeItem) => copyUsername(item)
    ),

    // Duplicate
    vscode.commands.registerCommand(
      "launchpad.duplicateEnvironment",
      (item?: EnvTreeItem) => duplicateEnvironment(context, item)
    ),

    // Import from .env
    vscode.commands.registerCommand("launchpad.importFromEnv", () =>
      importFromEnv(context)
    ),

    // Health check
    vscode.commands.registerCommand(
      "launchpad.healthCheck",
      (item?: EnvTreeItem) => runHealthCheck(item)
    ),

    // Run script
    vscode.commands.registerCommand(
      "launchpad.runScript",
      (item?: EnvTreeItem) => runScript(item)
    ),

    // Stop script
    vscode.commands.registerCommand(
      "launchpad.stopScript",
      (item?: EnvTreeItem) => stopScript(item)
    ),

    // Edit tree item (input box / quick pick / boolean toggle)
    vscode.commands.registerCommand(
      "launchpad.editTreeItem",
      (item?: EnvTreeItem) => editTreeItem(item)
    ),

    // Open YAML at line for a tree item
    vscode.commands.registerCommand(
      "launchpad.openAtLine",
      (item?: EnvTreeItem) => openAtLine(item)
    ),

    // Add item to a group
    vscode.commands.registerCommand(
      "launchpad.addItem",
      (item?: EnvTreeItem) => addItem(item)
    ),

    // Delete item from a group
    vscode.commands.registerCommand(
      "launchpad.deleteItem",
      (item?: EnvTreeItem) => deleteItem(item)
    )
  );

  // File watchers
  setupFileWatcher(context);
  setupGitWatcher(context);

  // Clean up tracked terminals when they close; stop Docker if configured
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      const info = trackedTerminals.get(terminal);
      if (info?.envConfig && info.workspaceRoot) {
        dockerComposeDown(info.envConfig, info.workspaceRoot);
      }
      trackedTerminals.delete(terminal);

      // Clean up script terminal tracking
      for (const [key, t] of runningScripts) {
        if (t === terminal) {
          runningScripts.delete(key);
          treeProvider.refresh();
          break;
        }
      }
    })
  );
}

function getConfig() {
  const config = vscode.workspace.getConfiguration("launchpad");
  return {
    envDir: config.get<string>("environmentsDir", ".launchpad"),
  };
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function refreshStatusBar(context: vscode.ExtensionContext) {
  const activeEnv = context.workspaceState.get<string>("activeEnvironment");
  if (activeEnv) {
    statusBarItem.text = `$(server-environment) ENV: ${activeEnv}`;
  } else {
    statusBarItem.text = "$(server-environment) No Env";
  }
  statusBarItem.show();
}

// ── Resolve terminal icon from environment config ──

const ENV_ICON_MAP: Record<string, string> = {
  prod: "warning",
  production: "warning",
  staging: "beaker",
  stage: "beaker",
  dev: "tools",
  development: "tools",
  local: "home",
  "local-dev": "home",
  test: "flask",
  testing: "flask",
  qa: "checklist",
  sandbox: "sandbox",
  demo: "play",
  preview: "eye",
};

function resolveTerminalIcon(
  envConfig: EnvironmentConfig
): vscode.ThemeIcon {
  if (envConfig.icon) {
    return new vscode.ThemeIcon(envConfig.icon);
  }

  const key = envConfig.name.toLowerCase().trim();
  const mapped = ENV_ICON_MAP[key];
  if (mapped) {
    return new vscode.ThemeIcon(mapped);
  }

  for (const [keyword, icon] of Object.entries(ENV_ICON_MAP)) {
    if (key.includes(keyword)) {
      return new vscode.ThemeIcon(icon);
    }
  }

  return new vscode.ThemeIcon("server-environment");
}

// ── Terminal tab name ──

function buildTabName(baseName: string, gitCtx: GitContext): string {
  if (gitCtx.short) {
    return `${baseName} [${gitCtx.short}]`;
  }
  return baseName;
}

let updateDebounce: NodeJS.Timeout | undefined;

function scheduleTerminalNameUpdate() {
  if (updateDebounce) {
    clearTimeout(updateDebounce);
  }
  updateDebounce = setTimeout(updateTerminalNames, 500);
}

function updateTerminalNames() {
  const root = getWorkspaceRoot();
  if (!root || trackedTerminals.size === 0) {
    return;
  }

  const gitCtx = getGitContextFast(root);

  for (const [terminal, info] of trackedTerminals) {
    const newName = buildTabName(info.baseName, gitCtx);
    terminal.sendText(
      `printf '\\033]2;${escapeForPrintf(newName)}\\007'`,
      true
    );
  }
}

function escapeForPrintf(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
}

// ── Build the `claude` CLI command from an environment config ──

function buildClaudeCommand(
  envConfig: EnvironmentConfig,
  mcpConfigPath?: string
): string {
  const args: string[] = ["claude"];

  // System prompt
  const prompt = buildSystemPrompt(envConfig);
  args.push("--append-system-prompt", shellQuote(prompt));

  // Session name
  args.push("--name", shellQuote(`env:${envConfig.name}`));

  // Model override
  if (envConfig.claude?.model) {
    args.push("--model", shellQuote(envConfig.claude.model));
  }

  // Permission mode
  if (envConfig.claude?.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  // Allowed tools
  if (envConfig.claude?.allowedTools?.length) {
    args.push(
      "--allowedTools",
      ...envConfig.claude.allowedTools.map(shellQuote)
    );
  }

  // MCP servers config file
  if (mcpConfigPath) {
    args.push("--mcp-config", shellQuote(mcpConfigPath));
  }

  return args.join(" ");
}

function shellQuote(s: string): string {
  return (
    "$'" +
    s
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t") +
    "'"
  );
}

// ── Write MCP config to temp file ──

function writeMcpConfig(envConfig: EnvironmentConfig): string | undefined {
  if (!envConfig.mcpServers?.length) {
    return undefined;
  }

  const mcpConfig: Record<string, any> = { mcpServers: {} };
  for (const server of envConfig.mcpServers) {
    mcpConfig.mcpServers[server.name] = {
      command: server.command,
      args: server.args || [],
      ...(server.env ? { env: server.env } : {}),
    };
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `claude-env-mcp-${Date.now()}.json`
  );
  fs.writeFileSync(tmpFile, JSON.stringify(mcpConfig, null, 2));
  tempMcpFiles.push(tmpFile);

  return tmpFile;
}

// ── Run pre-launch hooks ──

async function runPreLaunchHooks(
  envConfig: EnvironmentConfig,
  workspaceRoot: string
): Promise<boolean> {
  const hooks = envConfig.hooks?.preLaunch;
  if (!hooks?.length) {
    return true;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `${envConfig.name}: Running pre-launch hooks...`,
      cancellable: true,
    },
    async (progress, token) => {
      for (let i = 0; i < hooks.length; i++) {
        if (token.isCancellationRequested) {
          vscode.window.showWarningMessage("Pre-launch hooks cancelled.");
          return false;
        }

        const hook = hooks[i];
        progress.report({
          message: `(${i + 1}/${hooks.length}) ${hook.command}`,
          increment: (100 / hooks.length),
        });

        try {
          cp.execSync(hook.command, {
            cwd: hook.cwd || workspaceRoot,
            encoding: "utf-8",
            timeout: hook.timeout || 30000,
            stdio: "pipe",
          });
        } catch (err: any) {
          const msg = `Hook failed: ${hook.command}\n${err.stderr || err.message}`;
          if (hook.continueOnError) {
            vscode.window.showWarningMessage(msg);
          } else {
            vscode.window.showErrorMessage(msg);
            return false;
          }
        }
      }

      return true;
    }
  );
}

// ── Docker Compose lifecycle ──

async function dockerComposeUp(
  envConfig: EnvironmentConfig,
  workspaceRoot: string
): Promise<boolean> {
  const docker = envConfig.docker;
  if (!docker || docker.upOnLaunch === false) {
    return true;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `${envConfig.name}: Starting Docker services...`,
      cancellable: true,
    },
    async (progress, token) => {
      const baseArgs = buildComposeArgs(docker);
      const upArgs = [...baseArgs, "up", "-d"];

      if (docker.build) {
        upArgs.push("--build");
      }

      if (docker.waitHealthy !== false) {
        upArgs.push("--wait");
        if (docker.waitTimeout) {
          upArgs.push("--wait-timeout", String(docker.waitTimeout));
        }
      }

      if (docker.services?.length) {
        upArgs.push(...docker.services);
      }

      const cmd = `docker ${upArgs.join(" ")}`;

      try {
        progress.report({ message: cmd });
        cp.execSync(cmd, {
          cwd: workspaceRoot,
          encoding: "utf-8",
          timeout: ((docker.waitTimeout || 60) + 30) * 1000,
          stdio: "pipe",
        });
        return true;
      } catch (err: any) {
        const msg = `Docker Compose failed: ${err.stderr || err.message}`;
        const action = await vscode.window.showWarningMessage(
          msg,
          "Launch Anyway",
          "Cancel"
        );
        return action === "Launch Anyway";
      }
    }
  );
}

function dockerComposeDown(
  envConfig: EnvironmentConfig,
  workspaceRoot: string
): void {
  const docker = envConfig.docker;
  if (!docker || !docker.downOnExit) {
    return;
  }

  const baseArgs = buildComposeArgs(docker);
  const downArgs = [...baseArgs, "down"];

  if (docker.services?.length) {
    downArgs.push(...docker.services);
  }

  try {
    cp.execSync(`docker ${downArgs.join(" ")}`, {
      cwd: workspaceRoot,
      encoding: "utf-8",
      timeout: 30000,
      stdio: "pipe",
    });
  } catch {
    // Best effort — terminal is closing
  }
}

// ── Launch session: open terminal with `claude` CLI ──

async function launchSession(
  context: vscode.ExtensionContext,
  item?: EnvTreeItem
) {
  let envFilePath: string | undefined;
  let envName: string | undefined;

  if (item?.filePath) {
    envFilePath = item.filePath;
    envName = item.label as string;
  } else {
    const root = getWorkspaceRoot();
    if (!root) {
      vscode.window.showWarningMessage("Open a workspace first.");
      return;
    }
    const { envDir } = getConfig();
    const envs = discoverEnvironments(path.join(root, envDir));
    if (envs.length === 0) {
      vscode.window.showWarningMessage("No environments found.");
      return;
    }

    const picked = await vscode.window.showQuickPick(
      envs.map((e) => ({ label: e.name, filePath: e.filePath })),
      { placeHolder: "Pick an environment to launch" }
    );
    if (!picked) {
      return;
    }
    envFilePath = picked.filePath;
    envName = picked.label;
  }

  const root = getWorkspaceRoot()!;

  try {
    // Load and resolve secrets
    const rawConfig = loadEnvironment(envFilePath);
    let envConfig: EnvironmentConfig;

    try {
      envConfig = await resolveAllSecrets(rawConfig, root);
    } catch (err: any) {
      const proceed = await vscode.window.showWarningMessage(
        `Secret resolution issues:\n${err.message}\n\nLaunch anyway with unresolved values?`,
        "Launch Anyway",
        "Cancel"
      );
      if (proceed !== "Launch Anyway") {
        return;
      }
      envConfig = rawConfig;
    }

    // Run pre-launch hooks
    const hooksOk = await runPreLaunchHooks(envConfig, root);
    if (!hooksOk) {
      return;
    }

    // Start Docker Compose services
    const dockerOk = await dockerComposeUp(envConfig, root);
    if (!dockerOk) {
      return;
    }

    // Write MCP config if needed
    const mcpConfigPath = writeMcpConfig(envConfig);

    // Build command
    const command = buildClaudeCommand(envConfig, mcpConfigPath);

    // Build terminal env vars
    const termEnv: Record<string, string> = {};
    if (envConfig.variables?.length) {
      for (const v of envConfig.variables) {
        termEnv[v.name] = v.value;
      }
    }
    if (envConfig.claude?.environmentVariables) {
      Object.assign(termEnv, envConfig.claude.environmentVariables);
    }

    // Build terminal name with git context
    const terminalIcon = resolveTerminalIcon(envConfig);
    const gitCtx = getGitContext(root);
    const baseName = envConfig.tabName || `Claude: ${envConfig.name}`;
    const terminalName = buildTabName(baseName, gitCtx);

    // Create terminal and launch
    const terminal = vscode.window.createTerminal({
      name: terminalName,
      cwd: root,
      env: termEnv,
      iconPath: terminalIcon,
    });
    terminal.show();
    terminal.sendText(command);

    // Track for dynamic updates and docker-down-on-exit
    trackedTerminals.set(terminal, {
      envName: envConfig.name,
      baseName,
      envConfig,
      workspaceRoot: root,
    });

    // Update state
    await context.workspaceState.update("activeEnvironment", envName);
    await context.workspaceState.update("activeEnvironmentFile", envFilePath);
    refreshStatusBar(context);
    treeProvider.setActive(envName);
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Failed to launch session: ${err.message}`
    );
  }
}

// ── Select environment (quick pick → launch) ──

async function selectEnvironment(context: vscode.ExtensionContext) {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("Open a workspace first.");
    return;
  }

  const { envDir } = getConfig();
  const envs = discoverEnvironments(path.join(root, envDir));

  if (envs.length === 0) {
    const create = await vscode.window.showInformationMessage(
      `No environments found in ${envDir}/. Create one?`,
      "Create",
      "Cancel"
    );
    if (create === "Create") {
      await createEnvironment(context);
    }
    return;
  }

  const picked = await vscode.window.showQuickPick(
    envs.map((e) => ({ label: e.name, description: e.filePath })),
    { placeHolder: "Select an environment" }
  );

  if (!picked) {
    return;
  }

  const env = envs.find((e) => e.name === picked.label)!;
  await launchSession(context, {
    label: env.name,
    filePath: env.filePath,
    collapsibleState: vscode.TreeItemCollapsibleState.None,
  } as EnvTreeItem);
}

// ── Create new environment ──

async function createEnvironment(context: vscode.ExtensionContext) {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("Open a workspace first.");
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: "Environment name",
    placeHolder: "e.g. staging, production, local-dev",
  });

  if (!name) {
    return;
  }

  const { envDir } = getConfig();
  const fullDir = path.join(root, envDir);
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }

  const fileName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-") + ".yaml";
  const filePath = path.join(fullDir, fileName);

  const template = buildTemplate(name);
  fs.writeFileSync(filePath, template, "utf-8");

  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);

  treeProvider.refresh();

  vscode.window.showInformationMessage(
    `Created environment: ${fileName}. Edit it, then click ▶ to launch a session.`
  );
}

function buildTemplate(name: string): string {
  return `name: "${name}"
description: "Description of the ${name} environment"

# Claude Code CLI settings
claude:
  dangerouslySkipPermissions: false
  # model: "claude-sonnet-4-6"
  # allowedTools:
  #   - "Bash(git:*)"
  #   - "Read"
  #   - "Edit"
  # environmentVariables:
  #   DEBUG: "true"

# System prompt — passed to claude via --append-system-prompt
systemPrompt: |
  You are working in the ${name} environment.
  Be careful with any destructive operations.

# Environment variables — set as real env vars AND included in system prompt
# Supports secret references: op://vault/item/field, env://.env/KEY, $VAR, keychain://service/account
variables:
  - name: NODE_ENV
    value: "${name}"
  - name: API_KEY
    value: "your-api-key-here"
    secret: true

# Database connections
databases:
  - label: "Primary DB"
    type: postgres
    host: localhost
    port: 5432
    database: myapp_${name}
    username: myapp
    password: "changeme"

# Test / service accounts
accounts:
  - label: "Admin User"
    username: admin@example.com
    password: "test1234"
    role: admin
  - label: "Regular User"
    username: user@example.com
    password: "test1234"
    role: user

# API endpoints
apis:
  - label: "Backend API"
    url: "http://localhost:3000/api"
    notes: "Local development server"

# Per-environment MCP servers
# mcpServers:
#   - name: "postgres"
#     command: "npx"
#     args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@localhost/db"]
#   - name: "sentry"
#     command: "npx"
#     args: ["-y", "@sentry/mcp-server"]
#     env:
#       SENTRY_AUTH_TOKEN: "your-token"

# Docker Compose — start services before launching Claude
# docker:
#   composeFile: docker-compose.local.yml   # or [docker-compose.yml, docker-compose.local.yml]
#   services: [postgres, redis]             # optional: specific services (default: all)
#   upOnLaunch: true                        # auto-start on launch (default: true)
#   downOnExit: false                       # auto-stop when terminal closes (default: false)
#   build: false                            # run with --build (default: false)
#   waitHealthy: true                       # wait for healthy status (default: true)
#   waitTimeout: 60                         # seconds to wait (default: 60)
#   projectName: myapp                      # override compose project name

# Runnable scripts — quick-launch from the sidebar
# scripts:
#   - label: "Dev Server"
#     command: "pnpm dev"
#   - label: "Build"
#     command: "pnpm build"
#   - label: "Tests"
#     command: "pnpm test"
#     cwd: "packages/api"

# Pre-launch hooks — commands to run before Claude starts
# hooks:
#   preLaunch:
#     - command: "npm run migrate"
#       timeout: 60000

# Custom sections — any additional context for Claude
sections:
  Important Notes: |
    - This is the ${name} environment
    - Add any important context here
`;
}

// ── Edit active environment ──

async function editEnvironment(context: vscode.ExtensionContext) {
  const activeFile = context.workspaceState.get<string>(
    "activeEnvironmentFile"
  );
  if (!activeFile || !fs.existsSync(activeFile)) {
    vscode.window.showWarningMessage("No active environment to edit.");
    return;
  }

  const doc = await vscode.workspace.openTextDocument(activeFile);
  await vscode.window.showTextDocument(doc);
}

// ── Edit env file from tree item ──

async function editEnvFile(item?: EnvTreeItem) {
  if (!item?.filePath) {
    return;
  }
  const doc = await vscode.workspace.openTextDocument(item.filePath);
  await vscode.window.showTextDocument(doc);
}

// ── Clear active environment ──

async function clearEnvironment(context: vscode.ExtensionContext) {
  await context.workspaceState.update("activeEnvironment", undefined);
  await context.workspaceState.update("activeEnvironmentFile", undefined);
  refreshStatusBar(context);
  treeProvider.setActive(undefined);

  vscode.window.showInformationMessage("Environment cleared.");
}

// ── Copy credentials ──

async function copyConnectionString(item?: EnvTreeItem) {
  if (!item?.dbConfig) {
    return;
  }
  const db = item.dbConfig;
  const port = db.port ? `:${db.port}` : "";
  const auth =
    db.username && db.password
      ? `${db.username}:${db.password}@`
      : db.username
        ? `${db.username}@`
        : "";

  const connStr =
    db.connectionString ||
    `${db.type}://${auth}${db.host}${port}/${db.database}`;

  await vscode.env.clipboard.writeText(connStr);
  vscode.window.showInformationMessage(`Copied: ${db.label} connection string`);
}

async function copyPassword(item?: EnvTreeItem) {
  let password: string | undefined;
  let label: string | undefined;

  if (item?.dbConfig) {
    password = item.dbConfig.password;
    label = item.dbConfig.label;
  } else if (item?.accountConfig) {
    password = item.accountConfig.password;
    label = item.accountConfig.label;
  }

  if (!password) {
    vscode.window.showWarningMessage("No password available.");
    return;
  }

  await vscode.env.clipboard.writeText(password);
  vscode.window.showInformationMessage(`Copied: ${label} password`);
}

async function copyUsername(item?: EnvTreeItem) {
  let username: string | undefined;
  let label: string | undefined;

  if (item?.dbConfig) {
    username = item.dbConfig.username;
    label = item.dbConfig.label;
  } else if (item?.accountConfig) {
    username = item.accountConfig.username;
    label = item.accountConfig.label;
  }

  if (!username) {
    vscode.window.showWarningMessage("No username available.");
    return;
  }

  await vscode.env.clipboard.writeText(username);
  vscode.window.showInformationMessage(`Copied: ${label} username`);
}

// ── Duplicate environment ──

async function duplicateEnvironment(
  context: vscode.ExtensionContext,
  item?: EnvTreeItem
) {
  if (!item?.filePath || !fs.existsSync(item.filePath)) {
    vscode.window.showWarningMessage("Select an environment to duplicate.");
    return;
  }

  const newName = await vscode.window.showInputBox({
    prompt: "Name for the new environment",
    placeHolder: "e.g. staging-v2, production-eu",
    value: `${item.label}-copy`,
  });

  if (!newName) {
    return;
  }

  const sourceContent = fs.readFileSync(item.filePath, "utf-8");
  // Replace the name field in the YAML
  const newContent = sourceContent.replace(
    /^name:\s*["']?.*["']?\s*$/m,
    `name: "${newName}"`
  );

  const { envDir } = getConfig();
  const root = getWorkspaceRoot()!;
  const fullDir = path.join(root, envDir);
  const fileName =
    newName.toLowerCase().replace(/[^a-z0-9-]/g, "-") + ".yaml";
  const filePath = path.join(fullDir, fileName);

  if (fs.existsSync(filePath)) {
    vscode.window.showErrorMessage(`File already exists: ${fileName}`);
    return;
  }

  fs.writeFileSync(filePath, newContent, "utf-8");

  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);

  treeProvider.refresh();
  vscode.window.showInformationMessage(
    `Duplicated "${item.label}" → "${newName}"`
  );
}

// ── Import from .env ──

async function importFromEnv(context: vscode.ExtensionContext) {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("Open a workspace first.");
    return;
  }

  const files = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.file(root),
    filters: { "Env files": ["env", "env.*"] },
    title: "Select .env file to import",
  });

  if (!files?.length) {
    return;
  }

  const envFileContent = fs.readFileSync(files[0].fsPath, "utf-8");
  const vars = parseEnvFile(envFileContent);

  if (Object.keys(vars).length === 0) {
    vscode.window.showWarningMessage("No variables found in the .env file.");
    return;
  }

  const envName = await vscode.window.showInputBox({
    prompt: "Environment name for the imported config",
    placeHolder: "e.g. local-dev, staging",
    value: path.basename(files[0].fsPath, path.extname(files[0].fsPath)),
  });

  if (!envName) {
    return;
  }

  // Build YAML
  const secretKeywords = [
    "SECRET",
    "PASSWORD",
    "PASS",
    "KEY",
    "TOKEN",
    "AUTH",
    "CREDENTIAL",
    "PRIVATE",
  ];

  let yaml = `name: "${envName}"
description: "Imported from ${path.basename(files[0].fsPath)}"

systemPrompt: |
  You are working in the ${envName} environment.

variables:
`;

  for (const [key, value] of Object.entries(vars)) {
    const isSecret = secretKeywords.some((kw) =>
      key.toUpperCase().includes(kw)
    );
    yaml += `  - name: ${key}\n`;
    yaml += `    value: "${value.replace(/"/g, '\\"')}"\n`;
    if (isSecret) {
      yaml += `    secret: true\n`;
    }
  }

  // Try to auto-detect databases from DATABASE_URL etc.
  const dbUrl = vars["DATABASE_URL"] || vars["DB_URL"];
  if (dbUrl) {
    try {
      const url = new URL(dbUrl);
      yaml += `
databases:
  - label: "Imported DB"
    type: ${url.protocol.replace(":", "").replace("postgresql", "postgres")}
    host: ${url.hostname}
    port: ${url.port || "5432"}
    database: ${url.pathname.slice(1)}
    username: ${url.username || ""}
    password: "${url.password || ""}"
`;
    } catch {
      // Not a valid URL, skip
    }
  }

  // Try to auto-detect API endpoints
  const apiVars = Object.entries(vars).filter(
    ([k]) =>
      k.includes("API_URL") ||
      k.includes("API_BASE") ||
      k.includes("BASE_URL") ||
      k.includes("ENDPOINT")
  );
  if (apiVars.length) {
    yaml += `\napis:\n`;
    for (const [key, url] of apiVars) {
      yaml += `  - label: "${key}"\n    url: "${url}"\n`;
    }
  }

  const { envDir } = getConfig();
  const fullDir = path.join(root, envDir);
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }

  const fileName =
    envName.toLowerCase().replace(/[^a-z0-9-]/g, "-") + ".yaml";
  const filePath = path.join(fullDir, fileName);

  fs.writeFileSync(filePath, yaml, "utf-8");

  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);

  treeProvider.refresh();
  vscode.window.showInformationMessage(
    `Imported ${Object.keys(vars).length} variables from ${path.basename(files[0].fsPath)}`
  );
}

// ── Health check ──

async function runHealthCheck(item?: EnvTreeItem) {
  if (!item?.envConfig) {
    vscode.window.showWarningMessage("Select an environment to health check.");
    return;
  }

  const config = item.envConfig;
  const hasTargets =
    (config.databases?.length || 0) +
      (config.apis?.length || 0) +
      (config.docker ? 1 : 0) >
    0;

  if (!hasTargets) {
    vscode.window.showInformationMessage(
      `${config.name}: No databases, APIs, or Docker services to check.`
    );
    return;
  }

  // Get or create output channel
  if (!healthOutputChannel) {
    healthOutputChannel = vscode.window.createOutputChannel(
      "Launchpad Health"
    );
  }
  healthOutputChannel.clear();
  healthOutputChannel.show(true);
  healthOutputChannel.appendLine(`Health Check: ${config.name}`);
  healthOutputChannel.appendLine(`${"─".repeat(50)}`);
  healthOutputChannel.appendLine("");

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Health checking ${config.name}...`,
    },
    async () => {
      const checks: Promise<HealthResult | HealthResult[]>[] = [];

      if (config.docker) {
        const root = getWorkspaceRoot();
        if (root) {
          checks.push(checkDocker(config.docker, root));
        }
      }
      if (config.databases) {
        for (const db of config.databases) {
          checks.push(checkDatabase(db));
        }
      }
      if (config.apis) {
        for (const api of config.apis) {
          checks.push(checkApi(api));
        }
      }

      const results = await Promise.allSettled(checks);
      let passed = 0;
      let failed = 0;

      for (const result of results) {
        if (result.status === "fulfilled") {
          const values = Array.isArray(result.value)
            ? result.value
            : [result.value];
          for (const r of values) {
            const icon = r.ok ? "✓" : "✗";
            const line = `  ${icon} ${r.label}: ${r.message} (${r.latencyMs}ms)`;
            healthOutputChannel!.appendLine(line);
            if (r.ok) {
              passed++;
            } else {
              failed++;
            }
          }
        } else {
          healthOutputChannel!.appendLine(
            `  ✗ Error: ${result.reason}`
          );
          failed++;
        }
      }

      healthOutputChannel!.appendLine("");
      healthOutputChannel!.appendLine(
        `Results: ${passed} passed, ${failed} failed`
      );

      if (failed > 0) {
        vscode.window.showWarningMessage(
          `${config.name}: ${failed} check(s) failed. See output for details.`
        );
      } else {
        vscode.window.showInformationMessage(
          `${config.name}: All ${passed} checks passed.`
        );
      }
    }
  );
}

// ── Run / stop scripts ──

function scriptKey(envName: string, label: string): string {
  return `${envName}::${label}`;
}

function runScript(item?: EnvTreeItem) {
  if (!item?.scriptConfig) {
    vscode.window.showWarningMessage("Select a script to run.");
    return;
  }

  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("Open a workspace first.");
    return;
  }

  const script = item.scriptConfig;
  const envName = item.envName || "";
  const key = scriptKey(envName, script.label);

  // If already running, just show that terminal
  const existing = runningScripts.get(key);
  if (existing) {
    existing.show();
    return;
  }

  const cwd = script.cwd ? path.join(root, script.cwd) : root;

  let terminal: vscode.Terminal;
  if (script.split && vscode.window.activeTerminal) {
    // Split alongside the active terminal
    terminal = vscode.window.createTerminal({
      name: script.label,
      cwd,
      iconPath: new vscode.ThemeIcon("terminal"),
      location: { parentTerminal: vscode.window.activeTerminal },
    });
  } else {
    terminal = vscode.window.createTerminal({
      name: script.label,
      cwd,
      iconPath: new vscode.ThemeIcon("terminal"),
    });
  }
  terminal.show();
  terminal.sendText(script.command);

  runningScripts.set(key, terminal);
  treeProvider.refresh();
}

function stopScript(item?: EnvTreeItem) {
  if (!item?.scriptConfig) {
    vscode.window.showWarningMessage("Select a script to stop.");
    return;
  }

  const script = item.scriptConfig;
  const envName = item.envName || "";
  const key = scriptKey(envName, script.label);

  const terminal = runningScripts.get(key);
  if (terminal) {
    terminal.dispose();
    runningScripts.delete(key);
    treeProvider.refresh();
  }
}

// ── Edit tree item (Approach 1: Input Box + Approach 3: Quick Pick) ──

async function editTreeItem(item?: EnvTreeItem) {
  if (!item?.filePath || !item.yamlPath || !item.editMeta) {
    return;
  }

  const meta = item.editMeta;

  switch (meta.type) {
    case "boolean": {
      const picked = await vscode.window.showQuickPick(["true", "false"], {
        placeHolder: `${item.label}: currently ${meta.currentValue}`,
      });
      if (picked !== undefined) {
        updateYamlValue(item.filePath, item.yamlPath, picked === "true");
        treeProvider.refresh();
      }
      break;
    }

    case "enum": {
      const picked = await vscode.window.showQuickPick(
        (meta.options || []).map((o) => ({
          label: o,
          picked: o === meta.currentValue,
        })),
        { placeHolder: `${item.label}: currently "${meta.currentValue}"` }
      );
      if (picked) {
        updateYamlValue(item.filePath, item.yamlPath, picked.label);
        treeProvider.refresh();
      }
      break;
    }

    case "text": {
      const value = await vscode.window.showInputBox({
        prompt: `Edit ${meta.fieldName || item.label}`,
        value: String(meta.currentValue ?? ""),
      });
      if (value !== undefined) {
        updateYamlValue(item.filePath, item.yamlPath, value);
        treeProvider.refresh();
      }
      break;
    }

    case "composite": {
      // Show a quick pick of editable fields for this composite item
      await editCompositeItem(item);
      break;
    }
  }
}

async function editCompositeItem(item: EnvTreeItem) {
  if (!item.filePath || !item.yamlPath || !item.editMeta) {
    return;
  }

  const section = item.editMeta.section;
  type FieldDef = { label: string; field: string; type: "text" | "number" | "password" | "enum"; options?: string[] };
  let fields: FieldDef[] = [];
  let currentValues: Record<string, any> = {};

  if (section === "databases" && item.dbConfig) {
    const db = item.dbConfig;
    currentValues = db;
    fields = [
      { label: "Label", field: "label", type: "text" },
      { label: "Type", field: "type", type: "enum", options: ["postgres", "mysql", "redis", "mongodb", "sqlite", "mariadb", "mssql"] },
      { label: "Host", field: "host", type: "text" },
      { label: "Port", field: "port", type: "number" },
      { label: "Database", field: "database", type: "text" },
      { label: "Username", field: "username", type: "text" },
      { label: "Password", field: "password", type: "password" },
      { label: "Notes", field: "notes", type: "text" },
    ];
  } else if (section === "accounts" && item.accountConfig) {
    currentValues = item.accountConfig;
    fields = [
      { label: "Label", field: "label", type: "text" },
      { label: "Username", field: "username", type: "text" },
      { label: "Password", field: "password", type: "password" },
      { label: "Role", field: "role", type: "text" },
      { label: "Notes", field: "notes", type: "text" },
    ];
  } else if (section === "apis" && item.apiConfig) {
    currentValues = item.apiConfig;
    fields = [
      { label: "Label", field: "label", type: "text" },
      { label: "URL", field: "url", type: "text" },
      { label: "Auth", field: "auth", type: "text" },
      { label: "Notes", field: "notes", type: "text" },
    ];
  } else if (section === "variables") {
    // Get current values from YAML
    try {
      const { getYamlValue } = require("./yamlEditor");
      const node = getYamlValue(item.filePath, item.yamlPath);
      if (node) { currentValues = typeof node === "object" ? node : {}; }
    } catch {}
    fields = [
      { label: "Name", field: "name", type: "text" },
      { label: "Value", field: "value", type: "text" },
    ];
  } else if (section === "scripts" && item.scriptConfig) {
    currentValues = item.scriptConfig;
    fields = [
      { label: "Label", field: "label", type: "text" },
      { label: "Command", field: "command", type: "text" },
      { label: "Working Dir", field: "cwd", type: "text" },
    ];
  } else if (section === "mcpServers") {
    try {
      const { getYamlValue } = require("./yamlEditor");
      const node = getYamlValue(item.filePath, item.yamlPath);
      if (node) { currentValues = typeof node === "object" ? node : {}; }
    } catch {}
    fields = [
      { label: "Name", field: "name", type: "text" },
      { label: "Command", field: "command", type: "text" },
    ];
  } else if (section === "hooks.preLaunch") {
    try {
      const { getYamlValue } = require("./yamlEditor");
      const node = getYamlValue(item.filePath, item.yamlPath);
      if (node) { currentValues = typeof node === "object" ? node : {}; }
    } catch {}
    fields = [
      { label: "Command", field: "command", type: "text" },
      { label: "Timeout (ms)", field: "timeout", type: "number" },
    ];
  } else {
    return;
  }

  // Show quick pick of fields to edit
  const picked = await vscode.window.showQuickPick(
    fields.map((f) => ({
      label: f.label,
      description: String(currentValues[f.field] ?? ""),
      field: f,
    })),
    { placeHolder: `Edit ${item.label} — pick a field` }
  );

  if (!picked) {
    return;
  }

  const f = picked.field;
  const fieldPath = [...item.yamlPath, f.field];

  if (f.type === "enum" && f.options) {
    const choice = await vscode.window.showQuickPick(f.options, {
      placeHolder: `${f.label}: currently "${currentValues[f.field] ?? ""}"`,
    });
    if (choice !== undefined) {
      updateYamlValue(item.filePath, fieldPath, choice);
      treeProvider.refresh();
    }
  } else {
    const value = await vscode.window.showInputBox({
      prompt: `Edit ${f.label}`,
      value: String(currentValues[f.field] ?? ""),
      password: f.type === "password",
    });
    if (value !== undefined) {
      const finalValue = f.type === "number" && value !== "" ? Number(value) : value;
      updateYamlValue(item.filePath, fieldPath, finalValue);
      treeProvider.refresh();
    }
  }
}

// ── Open YAML at line (Approach 4) ──

async function openAtLine(item?: EnvTreeItem) {
  if (!item?.filePath) {
    return;
  }

  let line = 1;
  if (item.yamlPath) {
    line = findYamlLineNumber(item.filePath, item.yamlPath);
  }

  const doc = await vscode.workspace.openTextDocument(item.filePath);
  const editor = await vscode.window.showTextDocument(doc);
  const pos = new vscode.Position(Math.max(0, line - 1), 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(
    new vscode.Range(pos, pos),
    vscode.TextEditorRevealType.InCenter
  );
}

// ── Add item to a group ──

async function addItem(item?: EnvTreeItem) {
  if (!item?.filePath || !item.yamlPath) {
    return;
  }

  const ctx = item.contextValue;
  let template: any;

  switch (ctx) {
    case "group-variables": {
      const name = await vscode.window.showInputBox({
        prompt: "Variable name",
        placeHolder: "e.g. API_KEY",
      });
      if (!name) { return; }
      const value = await vscode.window.showInputBox({
        prompt: `Value for ${name}`,
      });
      if (value === undefined) { return; }
      const isSecret = await vscode.window.showQuickPick(["No", "Yes"], {
        placeHolder: "Is this a secret?",
      });
      template = { name, value, ...(isSecret === "Yes" ? { secret: true } : {}) };
      break;
    }

    case "group-databases": {
      const label = await vscode.window.showInputBox({
        prompt: "Database label",
        placeHolder: "e.g. Primary DB",
      });
      if (!label) { return; }
      const type = await vscode.window.showQuickPick(
        ["postgres", "mysql", "redis", "mongodb", "sqlite", "mariadb", "mssql"],
        { placeHolder: "Database type" }
      );
      if (!type) { return; }
      const host = await vscode.window.showInputBox({
        prompt: "Host",
        value: "localhost",
      });
      if (!host) { return; }
      const port = await vscode.window.showInputBox({
        prompt: "Port",
        value: type === "postgres" ? "5432" : type === "mysql" ? "3306" : type === "redis" ? "6379" : "",
      });
      const database = await vscode.window.showInputBox({
        prompt: "Database name",
        placeHolder: "mydb",
      });
      template = {
        label, type, host,
        ...(port ? { port: Number(port) } : {}),
        database: database || "mydb",
      };
      break;
    }

    case "group-accounts": {
      const label = await vscode.window.showInputBox({
        prompt: "Account label",
        placeHolder: "e.g. Admin User",
      });
      if (!label) { return; }
      const username = await vscode.window.showInputBox({
        prompt: "Username",
        placeHolder: "user@example.com",
      });
      if (!username) { return; }
      const role = await vscode.window.showInputBox({
        prompt: "Role (optional)",
        placeHolder: "admin, user, etc.",
      });
      template = { label, username, ...(role ? { role } : {}) };
      break;
    }

    case "group-apis": {
      const label = await vscode.window.showInputBox({
        prompt: "API label",
        placeHolder: "e.g. Backend API",
      });
      if (!label) { return; }
      const url = await vscode.window.showInputBox({
        prompt: "URL",
        placeHolder: "http://localhost:3000/api",
      });
      if (!url) { return; }
      template = { label, url };
      break;
    }

    case "group-scripts": {
      const label = await vscode.window.showInputBox({
        prompt: "Script label",
        placeHolder: "e.g. Dev Server",
      });
      if (!label) { return; }
      const command = await vscode.window.showInputBox({
        prompt: "Shell command",
        placeHolder: "npm run dev",
      });
      if (!command) { return; }
      template = { label, command };
      break;
    }

    case "group-hooks": {
      const command = await vscode.window.showInputBox({
        prompt: "Hook command",
        placeHolder: "npm run migrate",
      });
      if (!command) { return; }
      template = { command };
      break;
    }

    case "group-mcpServers": {
      const name = await vscode.window.showInputBox({
        prompt: "MCP server name",
        placeHolder: "e.g. postgres",
      });
      if (!name) { return; }
      const command = await vscode.window.showInputBox({
        prompt: "Command",
        placeHolder: "npx",
      });
      if (!command) { return; }
      template = { name, command };
      break;
    }

    default:
      return;
  }

  addYamlArrayItem(item.filePath, item.yamlPath, template);
  treeProvider.refresh();
  vscode.window.showInformationMessage(`Added new item to ${item.label}`);
}

// ── Delete item from a group ──

async function deleteItem(item?: EnvTreeItem) {
  if (!item?.filePath || !item.yamlPath) {
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Delete "${item.label}"?`,
    { modal: true },
    "Delete"
  );

  if (confirmed !== "Delete") {
    return;
  }

  deleteYamlItem(item.filePath, item.yamlPath);
  treeProvider.refresh();
  vscode.window.showInformationMessage(`Deleted "${item.label}"`);
}

// ── File watcher ──

function setupFileWatcher(context: vscode.ExtensionContext) {
  const root = getWorkspaceRoot();
  if (!root) {
    return;
  }

  const { envDir } = getConfig();
  const pattern = new vscode.RelativePattern(
    path.join(root, envDir),
    "*.{yaml,yml,json}"
  );

  fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

  fileWatcher.onDidChange(() => { treeProvider.refresh(); editorWebview?.clear(); });
  fileWatcher.onDidCreate(() => treeProvider.refresh());
  fileWatcher.onDidDelete(() => { treeProvider.refresh(); editorWebview?.clear(); });
  context.subscriptions.push(fileWatcher);
}

// ── Git HEAD watcher ──

function setupGitWatcher(context: vscode.ExtensionContext) {
  const root = getWorkspaceRoot();
  if (!root) {
    return;
  }

  const gitHeadPath = path.join(root, ".git", "HEAD");
  if (!fs.existsSync(gitHeadPath)) {
    return;
  }

  const gitPattern = new vscode.RelativePattern(
    path.join(root, ".git"),
    "HEAD"
  );

  gitWatcher = vscode.workspace.createFileSystemWatcher(gitPattern);

  gitWatcher.onDidChange(() => {
    invalidateCache();
    scheduleTerminalNameUpdate();
  });

  context.subscriptions.push(gitWatcher);

  const gitExtension = vscode.extensions.getExtension("vscode.git");
  if (gitExtension?.isActive) {
    const git = gitExtension.exports.getAPI(1);
    if (git?.repositories?.length) {
      git.repositories[0].state.onDidChange(() => {
        invalidateCache();
        scheduleTerminalNameUpdate();
      });
    }
  }
}

// ── Cleanup ──

export function deactivate() {
  fileWatcher?.dispose();
  gitWatcher?.dispose();
  statusBarItem?.dispose();
  healthOutputChannel?.dispose();
  trackedTerminals.clear();

  // Clean up temp MCP config files
  for (const f of tempMcpFiles) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
}

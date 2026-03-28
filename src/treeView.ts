import * as vscode from "vscode";
import * as path from "path";
import { discoverEnvironments, loadEnvironment } from "./parser";
import {
  EnvironmentConfig,
  DatabaseConfig,
  TestAccount,
  ApiEndpoint,
  McpServerConfig,
  ScriptConfig,
  HookConfig,
} from "./types";

export class EnvironmentTreeProvider
  implements vscode.TreeDataProvider<EnvTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    EnvTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private activeEnvName: string | undefined;
  private getRunningScriptKeys: () => Set<string> = () => new Set();

  constructor(
    private workspaceRoot: string | undefined,
    private getEnvDir: () => string
  ) {}

  setRunningScriptsProvider(fn: () => Set<string>) {
    this.getRunningScriptKeys = fn;
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined);
  }

  setActive(name: string | undefined) {
    this.activeEnvName = name;
    this.refresh();
  }

  getTreeItem(element: EnvTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: EnvTreeItem): EnvTreeItem[] {
    if (!this.workspaceRoot) {
      return [];
    }

    // Nested children (db items, account items, etc.)
    if (element?.children) {
      return element.children;
    }

    // Top-level: show environments
    if (!element) {
      const dir = path.join(this.workspaceRoot, this.getEnvDir());
      const envs = discoverEnvironments(dir);

      if (envs.length === 0) {
        const placeholder = new EnvTreeItem(
          "No environments found",
          "",
          vscode.TreeItemCollapsibleState.None
        );
        placeholder.description = `Create one in ${this.getEnvDir()}/`;
        placeholder.command = {
          command: "launchpad.createEnvironment",
          title: "Create Environment",
        };
        return [placeholder];
      }

      return envs.map((e) => {
        const isActive = e.name === this.activeEnvName;
        let config: EnvironmentConfig | undefined;
        try {
          config = loadEnvironment(e.filePath);
        } catch {}

        const item = new EnvTreeItem(
          e.name,
          e.filePath,
          config
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None
        );

        const skipPerms = config?.claude?.dangerouslySkipPermissions;
        const desc = isActive ? "● active" : config?.description || "";
        item.description = skipPerms ? `${desc} ⚡` : desc;
        item.tooltip = skipPerms
          ? `${e.name} (skip permissions enabled)`
          : e.name;
        item.iconPath = new vscode.ThemeIcon(
          isActive ? "check" : "server-environment"
        );
        item.contextValue = isActive ? "env-active" : "env-inactive";
        item.envConfig = config;

        return item;
      });
    }

    // Children: show details of an environment
    if (element.envConfig) {
      return this.getEnvDetails(element.envConfig, element.filePath);
    }

    return [];
  }

  private getEnvDetails(
    config: EnvironmentConfig,
    envFilePath: string
  ): EnvTreeItem[] {
    const items: EnvTreeItem[] = [];

    // Claude settings
    if (config.claude) {
      const settingsGroup = new EnvTreeItem(
        "Claude Settings",
        envFilePath,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      settingsGroup.iconPath = new vscode.ThemeIcon("settings-gear");
      settingsGroup.contextValue = "group-claude";
      settingsGroup.yamlPath = ["claude"];
      settingsGroup.children = [];

      if (config.claude.dangerouslySkipPermissions !== undefined) {
        const item = new EnvTreeItem(
          "Skip Permissions",
          envFilePath,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = config.claude.dangerouslySkipPermissions
          ? "enabled ⚡"
          : "disabled";
        item.iconPath = new vscode.ThemeIcon(
          config.claude.dangerouslySkipPermissions ? "warning" : "shield"
        );
        item.contextValue = "editable-bool";
        item.yamlPath = ["claude", "dangerouslySkipPermissions"];
        item.editMeta = { type: "boolean", currentValue: config.claude.dangerouslySkipPermissions };
        settingsGroup.children.push(item);
      }

      if (config.claude.model) {
        const item = new EnvTreeItem(
          "Model",
          envFilePath,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = config.claude.model;
        item.iconPath = new vscode.ThemeIcon("hubot");
        item.contextValue = "editable-enum";
        item.yamlPath = ["claude", "model"];
        item.editMeta = {
          type: "enum",
          currentValue: config.claude.model,
          options: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
        };
        settingsGroup.children.push(item);
      }

      if (config.claude.environmentVariables) {
        const vars = Object.entries(config.claude.environmentVariables);
        for (const [k, v] of vars) {
          const item = new EnvTreeItem(
            k,
            envFilePath,
            vscode.TreeItemCollapsibleState.None
          );
          item.description = v;
          item.iconPath = new vscode.ThemeIcon("symbol-constant");
          item.contextValue = "editable-text";
          item.yamlPath = ["claude", "environmentVariables", k];
          item.editMeta = { type: "text", currentValue: v, fieldName: k };
          settingsGroup.children.push(item);
        }
      }

      if (settingsGroup.children.length > 0) {
        items.push(settingsGroup);
      }
    }

    // Docker
    if (config.docker) {
      const docker = config.docker;
      const files = Array.isArray(docker.composeFile)
        ? docker.composeFile
        : docker.composeFile
          ? [docker.composeFile]
          : ["docker-compose.yml"];

      const dockerGroup = new EnvTreeItem(
        "Docker Compose",
        envFilePath,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      dockerGroup.iconPath = new vscode.ThemeIcon("package");
      dockerGroup.contextValue = "group-docker";
      dockerGroup.yamlPath = ["docker"];
      dockerGroup.children = [];

      const fileItem = new EnvTreeItem(
        "Compose File",
        envFilePath,
        vscode.TreeItemCollapsibleState.None
      );
      fileItem.description = files.join(", ");
      fileItem.iconPath = new vscode.ThemeIcon("file");
      fileItem.contextValue = "editable-text";
      fileItem.yamlPath = ["docker", "composeFile"];
      fileItem.editMeta = { type: "text", currentValue: files.join(", "), fieldName: "Compose File" };
      dockerGroup.children.push(fileItem);

      if (docker.services?.length) {
        for (const svc of docker.services) {
          const svcItem = new EnvTreeItem(
            svc,
            envFilePath,
            vscode.TreeItemCollapsibleState.None
          );
          svcItem.iconPath = new vscode.ThemeIcon("symbol-module");
          svcItem.description = "service";
          dockerGroup.children.push(svcItem);
        }
      }

      const flags: string[] = [];
      if (docker.upOnLaunch !== false) { flags.push("auto-start"); }
      if (docker.downOnExit) { flags.push("auto-stop"); }
      if (docker.build) { flags.push("--build"); }
      if (flags.length) {
        const flagItem = new EnvTreeItem(
          "Options",
          envFilePath,
          vscode.TreeItemCollapsibleState.None
        );
        flagItem.description = flags.join(", ");
        flagItem.iconPath = new vscode.ThemeIcon("settings-gear");
        dockerGroup.children.push(flagItem);
      }

      items.push(dockerGroup);
    }

    // Databases
    if (config.databases?.length) {
      const dbGroup = new EnvTreeItem(
        `Databases (${config.databases.length})`,
        envFilePath,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      dbGroup.iconPath = new vscode.ThemeIcon("database");
      dbGroup.contextValue = "group-databases";
      dbGroup.yamlPath = ["databases"];
      dbGroup.children = config.databases.map((db, i) => {
        const item = new EnvTreeItem(
          db.label,
          envFilePath,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = `${db.type} · ${db.host}:${db.port || ""}/${db.database}`;
        item.iconPath = new vscode.ThemeIcon("plug");
        item.contextValue = "db-item";
        item.dbConfig = db;
        item.yamlPath = ["databases", i];
        item.editMeta = { type: "composite", index: i, section: "databases" };
        return item;
      });
      items.push(dbGroup);
    }

    // Test accounts
    if (config.accounts?.length) {
      const accGroup = new EnvTreeItem(
        `Accounts (${config.accounts.length})`,
        envFilePath,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      accGroup.iconPath = new vscode.ThemeIcon("person");
      accGroup.contextValue = "group-accounts";
      accGroup.yamlPath = ["accounts"];
      accGroup.children = config.accounts.map((a, i) => {
        const item = new EnvTreeItem(
          a.label,
          envFilePath,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = `${a.username} · ${a.role || ""}`;
        item.iconPath = new vscode.ThemeIcon("account");
        item.contextValue = "account-item";
        item.accountConfig = a;
        item.yamlPath = ["accounts", i];
        item.editMeta = { type: "composite", index: i, section: "accounts" };
        return item;
      });
      items.push(accGroup);
    }

    // API endpoints
    if (config.apis?.length) {
      const apiGroup = new EnvTreeItem(
        `APIs (${config.apis.length})`,
        envFilePath,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      apiGroup.iconPath = new vscode.ThemeIcon("globe");
      apiGroup.contextValue = "group-apis";
      apiGroup.yamlPath = ["apis"];
      apiGroup.children = config.apis.map((api, i) => {
        const item = new EnvTreeItem(
          api.label,
          envFilePath,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = api.url;
        item.iconPath = new vscode.ThemeIcon("link");
        item.contextValue = "api-item";
        item.apiConfig = api;
        item.yamlPath = ["apis", i];
        item.editMeta = { type: "composite", index: i, section: "apis" };
        return item;
      });
      items.push(apiGroup);
    }

    // Environment variables
    if (config.variables?.length) {
      const varGroup = new EnvTreeItem(
        `Variables (${config.variables.length})`,
        envFilePath,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      varGroup.iconPath = new vscode.ThemeIcon("symbol-variable");
      varGroup.contextValue = "group-variables";
      varGroup.yamlPath = ["variables"];
      varGroup.children = config.variables.map((v, i) => {
        const item = new EnvTreeItem(
          v.name,
          envFilePath,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = v.secret ? "••••••••" : v.value;
        item.iconPath = new vscode.ThemeIcon("symbol-constant");
        item.contextValue = "variable-item";
        item.yamlPath = ["variables", i];
        item.editMeta = { type: "composite", index: i, section: "variables" };
        return item;
      });
      items.push(varGroup);
    }

    // MCP servers
    if (config.mcpServers?.length) {
      const mcpGroup = new EnvTreeItem(
        `MCP Servers (${config.mcpServers.length})`,
        envFilePath,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      mcpGroup.iconPath = new vscode.ThemeIcon("extensions");
      mcpGroup.contextValue = "group-mcpServers";
      mcpGroup.yamlPath = ["mcpServers"];
      mcpGroup.children = config.mcpServers.map((mcp, i) => {
        const item = new EnvTreeItem(
          mcp.name,
          envFilePath,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = `${mcp.command} ${(mcp.args || []).join(" ")}`;
        item.iconPath = new vscode.ThemeIcon("plug");
        item.contextValue = "mcp-item";
        item.yamlPath = ["mcpServers", i];
        item.editMeta = { type: "composite", index: i, section: "mcpServers" };
        return item;
      });
      items.push(mcpGroup);
    }

    // Scripts
    if (config.scripts?.length) {
      const running = config.scripts.filter((s) =>
        this.getRunningScriptKeys().has(`${config.name}::${s.label}`)
      ).length;
      const groupLabel = running > 0
        ? `Scripts (${running}/${config.scripts.length} running)`
        : `Scripts (${config.scripts.length})`;

      const scriptGroup = new EnvTreeItem(
        groupLabel,
        envFilePath,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      scriptGroup.iconPath = new vscode.ThemeIcon("terminal");
      scriptGroup.contextValue = "group-scripts";
      scriptGroup.yamlPath = ["scripts"];
      scriptGroup.children = config.scripts.map((script, i) => {
        const key = `${config.name}::${script.label}`;
        const isRunning = this.getRunningScriptKeys().has(key);

        const item = new EnvTreeItem(
          script.label,
          envFilePath,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = isRunning ? "● running" : script.command;
        item.iconPath = new vscode.ThemeIcon(
          isRunning ? "debug-stop" : "play",
          isRunning ? new vscode.ThemeColor("charts.green") : undefined
        );
        item.contextValue = isRunning ? "script-running" : "script-item";
        item.scriptConfig = script;
        item.envName = config.name;
        item.yamlPath = ["scripts", i];
        item.editMeta = { type: "composite", index: i, section: "scripts" };
        item.tooltip = isRunning
          ? `${script.command} (running)`
          : script.cwd
            ? `${script.command} (in ${script.cwd})`
            : script.command;
        return item;
      });
      items.push(scriptGroup);
    }

    // Hooks
    if (config.hooks?.preLaunch?.length) {
      const hookGroup = new EnvTreeItem(
        `Pre-Launch Hooks (${config.hooks.preLaunch.length})`,
        envFilePath,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      hookGroup.iconPath = new vscode.ThemeIcon("play-circle");
      hookGroup.contextValue = "group-hooks";
      hookGroup.yamlPath = ["hooks", "preLaunch"];
      hookGroup.children = config.hooks.preLaunch.map((hook, i) => {
        const item = new EnvTreeItem(
          `Hook ${i + 1}`,
          envFilePath,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = hook.command;
        item.iconPath = new vscode.ThemeIcon("terminal");
        item.contextValue = "hook-item";
        item.yamlPath = ["hooks", "preLaunch", i];
        item.editMeta = { type: "composite", index: i, section: "hooks.preLaunch" };
        item.tooltip = hook.continueOnError
          ? `${hook.command} (continue on error)`
          : hook.command;
        return item;
      });
      items.push(hookGroup);
    }

    return items;
  }
}

export interface EditMeta {
  type: "text" | "boolean" | "enum" | "composite";
  currentValue?: any;
  fieldName?: string;
  options?: string[];
  index?: number;
  section?: string;
}

export class EnvTreeItem extends vscode.TreeItem {
  public envConfig?: EnvironmentConfig;
  public children?: EnvTreeItem[];
  public filePath: string;

  // YAML editing metadata
  public yamlPath?: (string | number)[];
  public editMeta?: EditMeta;

  // Metadata for copy-to-clipboard, health checks, and scripts
  public dbConfig?: DatabaseConfig;
  public accountConfig?: TestAccount;
  public apiConfig?: ApiEndpoint;
  public scriptConfig?: ScriptConfig;
  public envName?: string;

  constructor(
    public readonly label: string,
    filePath: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.filePath = filePath;
  }
}

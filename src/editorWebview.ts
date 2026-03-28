import * as vscode from "vscode";
import * as fs from "fs";
import { EnvironmentConfig } from "./types";
import { updateYamlValue, deleteYamlItem, addYamlArrayItem } from "./yamlEditor";

export class EditorWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "launchpad.editor";

  private _view?: vscode.WebviewView;
  private _envConfig?: EnvironmentConfig;
  private _filePath?: string;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public setEnvironment(config: EnvironmentConfig, filePath: string) {
    this._envConfig = config;
    this._filePath = filePath;
    this._updateWebview();
  }

  public clear() {
    this._envConfig = undefined;
    this._filePath = undefined;
    this._updateWebview();
  }

  public refresh(config: EnvironmentConfig, filePath: string) {
    this._envConfig = config;
    this._filePath = filePath;
    this._updateWebview();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.onDidReceiveMessage((msg) =>
      this._handleMessage(msg)
    );

    this._updateWebview();
  }

  private _handleMessage(msg: any) {
    if (!this._filePath) {
      return;
    }

    switch (msg.type) {
      case "updateField":
        updateYamlValue(this._filePath, msg.path, msg.value);
        break;

      case "deleteItem":
        deleteYamlItem(this._filePath, msg.path);
        this._reloadAndRefresh();
        break;

      case "addItem":
        addYamlArrayItem(this._filePath, msg.arrayPath, msg.value);
        this._reloadAndRefresh();
        break;

      case "openFile":
        if (this._filePath) {
          vscode.workspace
            .openTextDocument(this._filePath)
            .then((doc) => vscode.window.showTextDocument(doc));
        }
        break;
    }
  }

  private _reloadAndRefresh() {
    if (!this._filePath || !fs.existsSync(this._filePath)) {
      return;
    }
    try {
      const YAML = require("yaml");
      const content = fs.readFileSync(this._filePath, "utf-8");
      this._envConfig = YAML.parse(content) as EnvironmentConfig;
      this._updateWebview();
    } catch {}
  }

  private _updateWebview() {
    if (!this._view) {
      return;
    }

    if (!this._envConfig) {
      this._view.webview.html = this._getEmptyHtml();
      return;
    }

    this._view.webview.html = this._getEditorHtml(this._envConfig);
  }

  private _getEmptyHtml(): string {
    return `<!DOCTYPE html>
<html><head>${this._getStyles()}</head>
<body>
  <div class="empty">
    <p>Select an environment to edit</p>
  </div>
</body></html>`;
  }

  private _getEditorHtml(config: EnvironmentConfig): string {
    return `<!DOCTYPE html>
<html><head>${this._getStyles()}</head>
<body>
  <div class="editor">
    <div class="header">
      <h2>${escapeHtml(config.name)}</h2>
      <button class="icon-btn" onclick="openFile()" title="Open YAML file">
        <span class="codicon">Edit YAML</span>
      </button>
    </div>

    ${this._renderGeneral(config)}
    ${this._renderClaude(config)}
    ${this._renderVariables(config)}
    ${this._renderDatabases(config)}
    ${this._renderAccounts(config)}
    ${this._renderApis(config)}
    ${this._renderMcpServers(config)}
    ${this._renderScripts(config)}
    ${this._renderHooks(config)}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function updateField(path, value) {
      vscode.postMessage({ type: 'updateField', path: JSON.parse(path), value });
    }

    function deleteItem(path) {
      if (confirm('Delete this item?')) {
        vscode.postMessage({ type: 'deleteItem', path: JSON.parse(path) });
      }
    }

    function addItem(arrayPath, value) {
      vscode.postMessage({ type: 'addItem', arrayPath: JSON.parse(arrayPath), value: JSON.parse(value) });
    }

    function openFile() {
      vscode.postMessage({ type: 'openFile' });
    }

    function handleInput(el, path) {
      clearTimeout(el._debounce);
      el._debounce = setTimeout(() => {
        let value = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'number' && el.value !== '') value = Number(el.value);
        updateField(path, value);
      }, 400);
    }

    function handleSelect(el, path) {
      updateField(path, el.value);
    }
  </script>
</body></html>`;
  }

  private _renderGeneral(config: EnvironmentConfig): string {
    return `
    <details class="section" open>
      <summary>General</summary>
      <div class="fields">
        ${this._field("Name", "text", config.name, '["name"]')}
        ${this._field("Description", "text", config.description || "", '["description"]')}
        ${this._field("Tab Name", "text", config.tabName || "", '["tabName"]')}
        ${this._field("Icon", "text", config.icon || "", '["icon"]', "Codicon name")}
      </div>
    </details>`;
  }

  private _renderClaude(config: EnvironmentConfig): string {
    if (!config.claude && !config.systemPrompt) {
      return "";
    }

    const c = config.claude || {};
    return `
    <details class="section">
      <summary>Claude Settings</summary>
      <div class="fields">
        ${this._select("Model", c.model || "", '["claude","model"]', [
          "", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001",
        ])}
        ${this._checkbox("Skip Permissions", c.dangerouslySkipPermissions || false, '["claude","dangerouslySkipPermissions"]')}
        ${this._textarea("System Prompt", config.systemPrompt || "", '["systemPrompt"]')}
      </div>
    </details>`;
  }

  private _renderVariables(config: EnvironmentConfig): string {
    if (!config.variables?.length) {
      return `
      <details class="section">
        <summary>Variables</summary>
        <div class="fields">
          <button class="add-btn" onclick="addItem('[\\"variables\\"]', '{\\"name\\":\\"NEW_VAR\\",\\"value\\":\\"\\"}')">+ Add Variable</button>
        </div>
      </details>`;
    }

    const items = config.variables
      .map(
        (v, i) => `
      <div class="list-item">
        <div class="item-header">
          <strong>${escapeHtml(v.name)}</strong>
          <button class="delete-btn" onclick="deleteItem('[\\"variables\\",${i}]')" title="Delete">&times;</button>
        </div>
        <div class="item-fields">
          ${this._field("Name", "text", v.name, `["variables",${i},"name"]`)}
          ${this._field("Value", v.secret ? "password" : "text", v.value, `["variables",${i},"value"]`)}
          ${this._checkbox("Secret", v.secret || false, `["variables",${i},"secret"]`)}
        </div>
      </div>`
      )
      .join("");

    return `
    <details class="section" open>
      <summary>Variables (${config.variables.length})</summary>
      <div class="fields">
        ${items}
        <button class="add-btn" onclick="addItem('[\\"variables\\"]', '{\\"name\\":\\"NEW_VAR\\",\\"value\\":\\"\\"}')">+ Add Variable</button>
      </div>
    </details>`;
  }

  private _renderDatabases(config: EnvironmentConfig): string {
    if (!config.databases?.length) {
      return `
      <details class="section">
        <summary>Databases</summary>
        <div class="fields">
          <button class="add-btn" onclick="addItem('[\\"databases\\"]', '{\\"label\\":\\"New DB\\",\\"type\\":\\"postgres\\",\\"host\\":\\"localhost\\",\\"port\\":5432,\\"database\\":\\"mydb\\"}')">+ Add Database</button>
        </div>
      </details>`;
    }

    const dbTypes = ["postgres", "mysql", "redis", "mongodb", "sqlite", "mariadb", "mssql"];
    const items = config.databases
      .map(
        (db, i) => `
      <div class="list-item">
        <div class="item-header">
          <strong>${escapeHtml(db.label)}</strong>
          <button class="delete-btn" onclick="deleteItem('[\\"databases\\",${i}]')" title="Delete">&times;</button>
        </div>
        <div class="item-fields">
          ${this._field("Label", "text", db.label, `["databases",${i},"label"]`)}
          ${this._select("Type", db.type, `["databases",${i},"type"]`, dbTypes)}
          ${this._field("Host", "text", db.host, `["databases",${i},"host"]`)}
          ${this._field("Port", "number", db.port ?? "", `["databases",${i},"port"]`)}
          ${this._field("Database", "text", db.database, `["databases",${i},"database"]`)}
          ${this._field("Username", "text", db.username || "", `["databases",${i},"username"]`)}
          ${this._field("Password", "password", db.password || "", `["databases",${i},"password"]`)}
          ${this._field("Notes", "text", db.notes || "", `["databases",${i},"notes"]`)}
        </div>
      </div>`
      )
      .join("");

    return `
    <details class="section">
      <summary>Databases (${config.databases.length})</summary>
      <div class="fields">
        ${items}
        <button class="add-btn" onclick="addItem('[\\"databases\\"]', '{\\"label\\":\\"New DB\\",\\"type\\":\\"postgres\\",\\"host\\":\\"localhost\\",\\"port\\":5432,\\"database\\":\\"mydb\\"}')">+ Add Database</button>
      </div>
    </details>`;
  }

  private _renderAccounts(config: EnvironmentConfig): string {
    if (!config.accounts?.length) {
      return `
      <details class="section">
        <summary>Accounts</summary>
        <div class="fields">
          <button class="add-btn" onclick="addItem('[\\"accounts\\"]', '{\\"label\\":\\"New Account\\",\\"username\\":\\"user@example.com\\",\\"role\\":\\"user\\"}')">+ Add Account</button>
        </div>
      </details>`;
    }

    const items = config.accounts
      .map(
        (a, i) => `
      <div class="list-item">
        <div class="item-header">
          <strong>${escapeHtml(a.label)}</strong>
          <button class="delete-btn" onclick="deleteItem('[\\"accounts\\",${i}]')" title="Delete">&times;</button>
        </div>
        <div class="item-fields">
          ${this._field("Label", "text", a.label, `["accounts",${i},"label"]`)}
          ${this._field("Username", "text", a.username, `["accounts",${i},"username"]`)}
          ${this._field("Password", "password", a.password || "", `["accounts",${i},"password"]`)}
          ${this._field("Role", "text", a.role || "", `["accounts",${i},"role"]`)}
          ${this._field("Notes", "text", a.notes || "", `["accounts",${i},"notes"]`)}
        </div>
      </div>`
      )
      .join("");

    return `
    <details class="section">
      <summary>Accounts (${config.accounts.length})</summary>
      <div class="fields">
        ${items}
        <button class="add-btn" onclick="addItem('[\\"accounts\\"]', '{\\"label\\":\\"New Account\\",\\"username\\":\\"user@example.com\\",\\"role\\":\\"user\\"}')">+ Add Account</button>
      </div>
    </details>`;
  }

  private _renderApis(config: EnvironmentConfig): string {
    if (!config.apis?.length) {
      return `
      <details class="section">
        <summary>APIs</summary>
        <div class="fields">
          <button class="add-btn" onclick="addItem('[\\"apis\\"]', '{\\"label\\":\\"New API\\",\\"url\\":\\"http://localhost:3000\\"}')">+ Add API</button>
        </div>
      </details>`;
    }

    const items = config.apis
      .map(
        (api, i) => `
      <div class="list-item">
        <div class="item-header">
          <strong>${escapeHtml(api.label)}</strong>
          <button class="delete-btn" onclick="deleteItem('[\\"apis\\",${i}]')" title="Delete">&times;</button>
        </div>
        <div class="item-fields">
          ${this._field("Label", "text", api.label, `["apis",${i},"label"]`)}
          ${this._field("URL", "text", api.url, `["apis",${i},"url"]`)}
          ${this._field("Auth", "text", api.auth || "", `["apis",${i},"auth"]`)}
          ${this._field("Notes", "text", api.notes || "", `["apis",${i},"notes"]`)}
        </div>
      </div>`
      )
      .join("");

    return `
    <details class="section">
      <summary>APIs (${config.apis.length})</summary>
      <div class="fields">
        ${items}
        <button class="add-btn" onclick="addItem('[\\"apis\\"]', '{\\"label\\":\\"New API\\",\\"url\\":\\"http://localhost:3000\\"}')">+ Add API</button>
      </div>
    </details>`;
  }

  private _renderMcpServers(config: EnvironmentConfig): string {
    if (!config.mcpServers?.length) {
      return "";
    }

    const items = config.mcpServers
      .map(
        (mcp, i) => `
      <div class="list-item">
        <div class="item-header">
          <strong>${escapeHtml(mcp.name)}</strong>
          <button class="delete-btn" onclick="deleteItem('[\\"mcpServers\\",${i}]')" title="Delete">&times;</button>
        </div>
        <div class="item-fields">
          ${this._field("Name", "text", mcp.name, `["mcpServers",${i},"name"]`)}
          ${this._field("Command", "text", mcp.command, `["mcpServers",${i},"command"]`)}
        </div>
      </div>`
      )
      .join("");

    return `
    <details class="section">
      <summary>MCP Servers (${config.mcpServers.length})</summary>
      <div class="fields">
        ${items}
      </div>
    </details>`;
  }

  private _renderScripts(config: EnvironmentConfig): string {
    if (!config.scripts?.length) {
      return `
      <details class="section">
        <summary>Scripts</summary>
        <div class="fields">
          <button class="add-btn" onclick="addItem('[\\"scripts\\"]', '{\\"label\\":\\"New Script\\",\\"command\\":\\"npm run dev\\"}')">+ Add Script</button>
        </div>
      </details>`;
    }

    const items = config.scripts
      .map(
        (s, i) => `
      <div class="list-item">
        <div class="item-header">
          <strong>${escapeHtml(s.label)}</strong>
          <button class="delete-btn" onclick="deleteItem('[\\"scripts\\",${i}]')" title="Delete">&times;</button>
        </div>
        <div class="item-fields">
          ${this._field("Label", "text", s.label, `["scripts",${i},"label"]`)}
          ${this._field("Command", "text", s.command, `["scripts",${i},"command"]`)}
          ${this._field("Working Dir", "text", s.cwd || "", `["scripts",${i},"cwd"]`)}
          ${this._checkbox("Split Terminal", s.split || false, `["scripts",${i},"split"]`)}
        </div>
      </div>`
      )
      .join("");

    return `
    <details class="section">
      <summary>Scripts (${config.scripts.length})</summary>
      <div class="fields">
        ${items}
        <button class="add-btn" onclick="addItem('[\\"scripts\\"]', '{\\"label\\":\\"New Script\\",\\"command\\":\\"npm run dev\\"}')">+ Add Script</button>
      </div>
    </details>`;
  }

  private _renderHooks(config: EnvironmentConfig): string {
    const hooks = config.hooks?.preLaunch;
    if (!hooks?.length) {
      return "";
    }

    const items = hooks
      .map(
        (h, i) => `
      <div class="list-item">
        <div class="item-header">
          <strong>Hook ${i + 1}</strong>
          <button class="delete-btn" onclick="deleteItem('[\\"hooks\\",\\"preLaunch\\",${i}]')" title="Delete">&times;</button>
        </div>
        <div class="item-fields">
          ${this._field("Command", "text", h.command, `["hooks","preLaunch",${i},"command"]`)}
          ${this._field("Timeout (ms)", "number", h.timeout ?? 30000, `["hooks","preLaunch",${i},"timeout"]`)}
          ${this._checkbox("Continue on Error", h.continueOnError || false, `["hooks","preLaunch",${i},"continueOnError"]`)}
        </div>
      </div>`
      )
      .join("");

    return `
    <details class="section">
      <summary>Pre-Launch Hooks (${hooks.length})</summary>
      <div class="fields">
        ${items}
      </div>
    </details>`;
  }

  // ── Field helpers ──

  private _field(
    label: string,
    type: string,
    value: any,
    pathJson: string,
    placeholder?: string
  ): string {
    const escaped = escapeHtml(String(value ?? ""));
    const ph = placeholder ? `placeholder="${escapeHtml(placeholder)}"` : "";
    return `
      <div class="field">
        <label>${escapeHtml(label)}</label>
        <input type="${type}" value="${escaped}" ${ph}
          oninput="handleInput(this, '${escapeAttr(pathJson)}')" />
      </div>`;
  }

  private _select(
    label: string,
    value: string,
    pathJson: string,
    options: string[]
  ): string {
    const opts = options
      .map(
        (o) =>
          `<option value="${escapeHtml(o)}" ${o === value ? "selected" : ""}>${escapeHtml(o || "(none)")}</option>`
      )
      .join("");
    return `
      <div class="field">
        <label>${escapeHtml(label)}</label>
        <select onchange="handleSelect(this, '${escapeAttr(pathJson)}')">
          ${opts}
        </select>
      </div>`;
  }

  private _checkbox(label: string, checked: boolean, pathJson: string): string {
    return `
      <div class="field checkbox-field">
        <label>
          <input type="checkbox" ${checked ? "checked" : ""}
            onchange="handleInput(this, '${escapeAttr(pathJson)}')" />
          ${escapeHtml(label)}
        </label>
      </div>`;
  }

  private _textarea(label: string, value: string, pathJson: string): string {
    return `
      <div class="field">
        <label>${escapeHtml(label)}</label>
        <textarea rows="4" oninput="handleInput(this, '${escapeAttr(pathJson)}')">${escapeHtml(value)}</textarea>
      </div>`;
  }

  private _getStyles(): string {
    return `
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        padding: 8px;
      }

      .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .header h2 {
        font-size: 14px;
        font-weight: 600;
      }

      .icon-btn {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        padding: 3px 8px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 11px;
      }
      .icon-btn:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }

      .section {
        margin-bottom: 8px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
      }

      summary {
        padding: 6px 10px;
        font-weight: 600;
        font-size: 12px;
        cursor: pointer;
        background: var(--vscode-sideBarSectionHeader-background);
        color: var(--vscode-sideBarSectionHeader-foreground);
        border-radius: 3px;
        user-select: none;
      }

      .fields {
        padding: 8px 10px;
      }

      .field {
        margin-bottom: 8px;
      }

      .field label {
        display: block;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 2px;
      }

      .field input[type="text"],
      .field input[type="password"],
      .field input[type="number"],
      .field select,
      .field textarea {
        width: 100%;
        padding: 4px 6px;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, transparent);
        border-radius: 2px;
        outline: none;
      }

      .field input:focus,
      .field select:focus,
      .field textarea:focus {
        border-color: var(--vscode-focusBorder);
      }

      .field textarea {
        resize: vertical;
        min-height: 60px;
      }

      .checkbox-field label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        cursor: pointer;
      }

      .checkbox-field input[type="checkbox"] {
        width: auto;
        accent-color: var(--vscode-checkbox-background);
      }

      .list-item {
        margin-bottom: 10px;
        padding: 8px;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
      }

      .item-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
      }

      .item-header strong {
        font-size: 12px;
      }

      .delete-btn {
        background: none;
        border: none;
        color: var(--vscode-errorForeground);
        font-size: 16px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
        opacity: 0.6;
      }
      .delete-btn:hover {
        opacity: 1;
      }

      .item-fields .field {
        margin-bottom: 6px;
      }

      .add-btn {
        width: 100%;
        padding: 6px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: 1px dashed var(--vscode-panel-border);
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        margin-top: 4px;
      }
      .add-btn:hover {
        background: var(--vscode-button-secondaryHoverBackground);
        border-style: solid;
      }
    </style>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return s.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
}

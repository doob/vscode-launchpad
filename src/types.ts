export interface EnvironmentVariable {
  name: string;
  value: string;
  /** If true, value is masked in UI. Supports secret references: op://, env://, $VAR, keychain:// */
  secret?: boolean;
}

export interface DatabaseConfig {
  label: string;
  type: string;
  host: string;
  port?: number;
  database: string;
  /** Supports secret references: op://, env://, $VAR, keychain:// */
  username?: string;
  /** Supports secret references: op://, env://, $VAR, keychain:// */
  password?: string;
  connectionString?: string;
  notes?: string;
}

export interface TestAccount {
  label: string;
  username: string;
  /** Supports secret references: op://, env://, $VAR, keychain:// */
  password?: string;
  role?: string;
  notes?: string;
}

export interface ApiEndpoint {
  label: string;
  url: string;
  auth?: string;
  notes?: string;
}

export interface McpServerConfig {
  /** MCP server name (used as key in the config) */
  name: string;
  /** Command to run the MCP server */
  command: string;
  /** Arguments to the command */
  args?: string[];
  /** Environment variables for the MCP server */
  env?: Record<string, string>;
}

export interface DockerConfig {
  /** Path to docker-compose file (default: "docker-compose.yml") */
  composeFile?: string | string[];
  /** Specific services to manage (default: all) */
  services?: string[];
  /** Run `docker compose up -d` before launching Claude (default: true) */
  upOnLaunch?: boolean;
  /** Run `docker compose down` when the terminal closes (default: false) */
  downOnExit?: boolean;
  /** Override the Compose project name */
  projectName?: string;
  /** Run with --build flag (default: false) */
  build?: boolean;
  /** Wait for services to be healthy before launching (default: true) */
  waitHealthy?: boolean;
  /** Timeout in seconds for waiting on healthy services (default: 60) */
  waitTimeout?: number;
}

export interface ScriptConfig {
  /** Display name for the script */
  label: string;
  /** Shell command to execute (e.g. "pnpm dev") */
  command: string;
  /** Working directory relative to workspace root (defaults to workspace root) */
  cwd?: string;
  /** Open in a split terminal alongside the active terminal (default: false) */
  split?: boolean;
}

export interface HookConfig {
  /** Shell command to execute */
  command: string;
  /** Working directory (defaults to workspace root) */
  cwd?: string;
  /** Timeout in milliseconds (default 30000) */
  timeout?: number;
  /** If true, continue launching even if this hook fails */
  continueOnError?: boolean;
}

export interface ClaudeSettings {
  /** Skip permission prompts (--dangerously-skip-permissions) */
  dangerouslySkipPermissions?: boolean;

  /** Override the model for this environment */
  model?: string;

  /** Allowed tools (e.g. "Bash(git:*)", "Read", "Edit") */
  allowedTools?: string[];

  /** Custom environment variables passed to Claude */
  environmentVariables?: Record<string, string>;
}

export interface EnvironmentConfig {
  name: string;
  description?: string;
  icon?: string;

  /** Custom tab name for the terminal (defaults to "Claude: <name>") */
  tabName?: string;

  /** Claude Code CLI settings */
  claude?: ClaudeSettings;

  /** Free-form system prompt injected via --append-system-prompt */
  systemPrompt?: string;

  /** Environment variables — set as real env vars AND included in system prompt */
  variables?: EnvironmentVariable[];

  /** Database connections */
  databases?: DatabaseConfig[];

  /** Test / service accounts */
  accounts?: TestAccount[];

  /** API endpoints */
  apis?: ApiEndpoint[];

  /** Per-environment MCP servers passed via --mcp-config */
  mcpServers?: McpServerConfig[];

  /** Docker Compose services required by this environment */
  docker?: DockerConfig;

  /** Runnable scripts (e.g. "bun dev", "bun run build") */
  scripts?: ScriptConfig[];

  /** Lifecycle hooks */
  hooks?: {
    /** Commands to run before launching Claude */
    preLaunch?: HookConfig[];
  };

  /** Arbitrary extra sections (key = heading, value = markdown body) */
  sections?: Record<string, string>;
}

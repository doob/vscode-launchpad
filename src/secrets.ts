import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import { EnvironmentConfig } from "./types";

/**
 * Resolve a secret reference to its actual value.
 *
 * Supported formats:
 *   op://vault/item/field       → 1Password CLI
 *   env://filename/KEY          → .env file relative to workspace root
 *   $VAR or ${VAR}              → OS environment variable
 *   keychain://service/account  → macOS Keychain / Linux secret-tool
 *   anything else               → returned as-is (plain text)
 */
export async function resolveSecret(
  value: string,
  workspaceRoot?: string
): Promise<string> {
  if (!value) {
    return value;
  }

  // 1Password: op://vault/item/field
  if (value.startsWith("op://")) {
    return resolve1Password(value);
  }

  // .env file: env://filename/KEY
  if (value.startsWith("env://")) {
    return resolveEnvFile(value, workspaceRoot);
  }

  // OS keychain: keychain://service/account
  if (value.startsWith("keychain://")) {
    return resolveKeychain(value);
  }

  // Environment variable: $VAR or ${VAR}
  if (value.startsWith("$")) {
    return resolveEnvVar(value);
  }

  // Plain text passthrough
  return value;
}

function resolve1Password(ref: string): string {
  try {
    const result = cp.execSync(`op read "${ref}"`, {
      encoding: "utf-8",
      timeout: 10000,
    });
    return result.trim();
  } catch (err: any) {
    if (err.message?.includes("ENOENT") || err.message?.includes("not found")) {
      throw new Error(
        `1Password CLI (op) not found. Install from https://1password.com/downloads/command-line/`
      );
    }
    throw new Error(`Failed to resolve 1Password secret "${ref}": ${err.message}`);
  }
}

function resolveEnvFile(ref: string, workspaceRoot?: string): string {
  // env://path/to/.env/KEY — supports nested paths for monorepos
  // e.g. env://apps/web/.env/DATABASE_URL or env://.env.local/API_KEY
  const withoutPrefix = ref.slice("env://".length);
  const slashIdx = withoutPrefix.lastIndexOf("/");
  if (slashIdx === -1) {
    throw new Error(`Invalid env:// reference "${ref}". Format: env://filename/KEY`);
  }

  const filename = withoutPrefix.slice(0, slashIdx);
  const key = withoutPrefix.slice(slashIdx + 1);

  const filePath = workspaceRoot
    ? path.resolve(workspaceRoot, filename)
    : filename;

  if (!fs.existsSync(filePath)) {
    throw new Error(`Env file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const vars = parseEnvFile(content);

  if (!(key in vars)) {
    throw new Error(`Key "${key}" not found in ${filename}`);
  }

  return vars[key];
}

function resolveEnvVar(ref: string): string {
  // $VAR or ${VAR}
  let varName = ref;
  if (varName.startsWith("${") && varName.endsWith("}")) {
    varName = varName.slice(2, -1);
  } else if (varName.startsWith("$")) {
    varName = varName.slice(1);
  }

  const value = process.env[varName];
  if (value === undefined) {
    throw new Error(`Environment variable "${varName}" is not set`);
  }

  return value;
}

function resolveKeychain(ref: string): string {
  // keychain://service/account
  const withoutPrefix = ref.slice("keychain://".length);
  const slashIdx = withoutPrefix.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(
      `Invalid keychain:// reference "${ref}". Format: keychain://service/account`
    );
  }

  const service = withoutPrefix.slice(0, slashIdx);
  const account = withoutPrefix.slice(slashIdx + 1);

  if (process.platform === "darwin") {
    try {
      const result = cp.execSync(
        `security find-generic-password -s "${service}" -a "${account}" -w`,
        { encoding: "utf-8", timeout: 5000 }
      );
      return result.trim();
    } catch {
      throw new Error(
        `Keychain lookup failed for service="${service}" account="${account}"`
      );
    }
  } else if (process.platform === "linux") {
    try {
      const result = cp.execSync(
        `secret-tool lookup service "${service}" account "${account}"`,
        { encoding: "utf-8", timeout: 5000 }
      );
      return result.trim();
    } catch {
      throw new Error(
        `secret-tool lookup failed for service="${service}" account="${account}"`
      );
    }
  } else {
    throw new Error(`Keychain resolution not supported on ${process.platform}`);
  }
}

/**
 * Parse a .env file into a key-value map.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

/**
 * Deep-resolve all secret references in an environment config.
 * Returns a new config with all secrets replaced by their actual values.
 * The original config is not mutated.
 */
export async function resolveAllSecrets(
  env: EnvironmentConfig,
  workspaceRoot?: string
): Promise<EnvironmentConfig> {
  // Deep clone
  const resolved: EnvironmentConfig = JSON.parse(JSON.stringify(env));
  const errors: string[] = [];

  // Resolve database passwords
  if (resolved.databases) {
    for (const db of resolved.databases) {
      if (db.password) {
        try {
          db.password = await resolveSecret(db.password, workspaceRoot);
        } catch (err: any) {
          errors.push(`DB "${db.label}": ${err.message}`);
        }
      }
      if (db.username) {
        try {
          db.username = await resolveSecret(db.username, workspaceRoot);
        } catch (err: any) {
          errors.push(`DB "${db.label}" username: ${err.message}`);
        }
      }
      if (db.connectionString) {
        try {
          db.connectionString = await resolveSecret(
            db.connectionString,
            workspaceRoot
          );
        } catch (err: any) {
          errors.push(`DB "${db.label}" connectionString: ${err.message}`);
        }
      }
    }
  }

  // Resolve account passwords
  if (resolved.accounts) {
    for (const acc of resolved.accounts) {
      if (acc.password) {
        try {
          acc.password = await resolveSecret(acc.password, workspaceRoot);
        } catch (err: any) {
          errors.push(`Account "${acc.label}": ${err.message}`);
        }
      }
    }
  }

  // Resolve secret variables
  if (resolved.variables) {
    for (const v of resolved.variables) {
      if (v.secret) {
        try {
          v.value = await resolveSecret(v.value, workspaceRoot);
        } catch (err: any) {
          errors.push(`Variable "${v.name}": ${err.message}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Secret resolution errors:\n${errors.join("\n")}`);
  }

  return resolved;
}

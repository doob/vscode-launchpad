import { EnvironmentConfig } from "./types";

/**
 * Build a plain-text system prompt from an environment config.
 * This is passed directly to `claude --append-system-prompt`.
 */
export function buildSystemPrompt(env: EnvironmentConfig): string {
  const lines: string[] = [];

  lines.push(`# Active Environment: ${env.name}`);

  if (env.description) {
    lines.push("");
    lines.push(env.description);
  }

  if (env.systemPrompt) {
    lines.push("");
    lines.push(env.systemPrompt.trim());
  }

  if (env.variables?.length) {
    lines.push("");
    lines.push("## Environment Variables");
    for (const v of env.variables) {
      const display = v.secret ? "********" : v.value;
      lines.push(`- ${v.name}: ${display}`);
    }
  }

  if (env.docker) {
    lines.push("");
    lines.push("## Docker Compose");
    const files = Array.isArray(env.docker.composeFile)
      ? env.docker.composeFile
      : env.docker.composeFile
        ? [env.docker.composeFile]
        : ["docker-compose.yml"];
    lines.push(`- Compose file(s): ${files.join(", ")}`);
    if (env.docker.services?.length) {
      lines.push(`- Services: ${env.docker.services.join(", ")}`);
    }
    if (env.docker.projectName) {
      lines.push(`- Project name: ${env.docker.projectName}`);
    }
    lines.push(
      `- Auto-started on launch: ${env.docker.upOnLaunch !== false ? "yes" : "no"}`
    );
    lines.push(
      "- These Docker services are running and available for this session."
    );
  }

  if (env.databases?.length) {
    lines.push("");
    lines.push("## Databases");
    for (const db of env.databases) {
      lines.push("");
      lines.push(`### ${db.label}`);
      lines.push(`- Type: ${db.type}`);
      lines.push(`- Host: ${db.host}`);
      if (db.port) {
        lines.push(`- Port: ${db.port}`);
      }
      lines.push(`- Database: ${db.database}`);
      if (db.username) {
        lines.push(`- Username: ${db.username}`);
      }
      if (db.password) {
        lines.push(`- Password: ${db.password}`);
      }
      if (db.connectionString) {
        lines.push(`- Connection String: ${db.connectionString}`);
      }
      if (db.notes) {
        lines.push(`- Notes: ${db.notes}`);
      }
    }
  }

  if (env.accounts?.length) {
    lines.push("");
    lines.push("## Test Accounts");
    for (const a of env.accounts) {
      lines.push(
        `- ${a.label}: ${a.username} / ${a.password ?? "-"} (${a.role ?? "-"})${a.notes ? " — " + a.notes : ""}`
      );
    }
  }

  if (env.apis?.length) {
    lines.push("");
    lines.push("## API Endpoints");
    for (const api of env.apis) {
      lines.push(`- ${api.label}: ${api.url}`);
      if (api.auth) {
        lines.push(`  Auth: ${api.auth}`);
      }
      if (api.notes) {
        lines.push(`  ${api.notes}`);
      }
    }
  }

  if (env.sections) {
    for (const [heading, body] of Object.entries(env.sections)) {
      lines.push("");
      lines.push(`## ${heading}`);
      lines.push("");
      lines.push(body.trim());
    }
  }

  return lines.join("\n");
}

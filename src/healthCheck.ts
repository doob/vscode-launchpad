import * as net from "net";
import * as cp from "child_process";
import { DatabaseConfig, ApiEndpoint, DockerConfig } from "./types";

export interface HealthResult {
  label: string;
  ok: boolean;
  message: string;
  latencyMs: number;
}

/**
 * Check database connectivity via TCP socket.
 * For Redis, sends PING and checks for PONG.
 */
export async function checkDatabase(db: DatabaseConfig): Promise<HealthResult> {
  const port = db.port || getDefaultPort(db.type);
  const start = Date.now();

  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 3000;

    socket.setTimeout(timeout);

    socket.on("connect", () => {
      const latency = Date.now() - start;

      if (db.type.toLowerCase() === "redis") {
        // Send Redis PING
        socket.write("PING\r\n");
        socket.once("data", (data) => {
          socket.destroy();
          const response = data.toString().trim();
          if (response.includes("+PONG")) {
            resolve({
              label: db.label,
              ok: true,
              message: `Connected (Redis PONG)`,
              latencyMs: latency,
            });
          } else {
            resolve({
              label: db.label,
              ok: true,
              message: `Port open, unexpected response: ${response}`,
              latencyMs: latency,
            });
          }
        });
      } else {
        socket.destroy();
        resolve({
          label: db.label,
          ok: true,
          message: `Port ${port} reachable`,
          latencyMs: latency,
        });
      }
    });

    socket.on("error", (err) => {
      socket.destroy();
      resolve({
        label: db.label,
        ok: false,
        message: `Connection failed: ${err.message}`,
        latencyMs: Date.now() - start,
      });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        label: db.label,
        ok: false,
        message: `Connection timed out (${timeout}ms)`,
        latencyMs: timeout,
      });
    });

    socket.connect(port, db.host);
  });
}

/**
 * Check API endpoint via HTTP HEAD request.
 */
export async function checkApi(api: ApiEndpoint): Promise<HealthResult> {
  const start = Date.now();
  const timeout = 5000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(api.url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timer);

    return {
      label: api.label,
      ok: response.ok || response.status < 500,
      message: `HTTP ${response.status} ${response.statusText}`,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      label: api.label,
      ok: false,
      message: err.name === "AbortError" ? `Timed out (${timeout}ms)` : err.message,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Build docker compose CLI args from DockerConfig.
 */
export function buildComposeArgs(docker: DockerConfig, cwd?: string): string[] {
  const args: string[] = ["compose"];

  const files = Array.isArray(docker.composeFile)
    ? docker.composeFile
    : docker.composeFile
      ? [docker.composeFile]
      : [];

  for (const f of files) {
    args.push("-f", f);
  }

  if (docker.projectName) {
    args.push("-p", docker.projectName);
  }

  return args;
}

/**
 * Check Docker Compose service status.
 */
export async function checkDocker(
  docker: DockerConfig,
  cwd: string
): Promise<HealthResult[]> {
  const results: HealthResult[] = [];
  const baseArgs = buildComposeArgs(docker);

  try {
    const start = Date.now();
    const output = cp.execSync(
      `docker ${baseArgs.join(" ")} ps --format json`,
      { cwd, encoding: "utf-8", timeout: 10000, stdio: "pipe" }
    );

    // docker compose ps --format json outputs one JSON object per line
    const containers = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const latency = Date.now() - start;

    if (containers.length === 0) {
      results.push({
        label: "Docker Compose",
        ok: false,
        message: "No containers running",
        latencyMs: latency,
      });
      return results;
    }

    for (const c of containers) {
      const name = c.Service || c.Name || "unknown";
      const state = (c.State || "").toLowerCase();
      const health = (c.Health || "").toLowerCase();

      const isRunning = state === "running";
      const isHealthy = health === "" || health === "healthy";

      results.push({
        label: `Docker: ${name}`,
        ok: isRunning && isHealthy,
        message: health ? `${state} (${health})` : state,
        latencyMs: latency,
      });
    }
  } catch (err: any) {
    results.push({
      label: "Docker Compose",
      ok: false,
      message: `Failed: ${err.message}`,
      latencyMs: 0,
    });
  }

  return results;
}

function getDefaultPort(type: string): number {
  switch (type.toLowerCase()) {
    case "postgres":
    case "postgresql":
      return 5432;
    case "mysql":
    case "mariadb":
      return 3306;
    case "redis":
      return 6379;
    case "mongo":
    case "mongodb":
      return 27017;
    case "mssql":
    case "sqlserver":
      return 1433;
    default:
      return 0;
  }
}

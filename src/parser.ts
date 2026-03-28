import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { EnvironmentConfig } from "./types";

/**
 * Load an environment config from a .yaml, .yml, or .json file.
 */
export function loadEnvironment(filePath: string): EnvironmentConfig {
  const raw = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".json") {
    return JSON.parse(raw) as EnvironmentConfig;
  }
  return YAML.parse(raw) as EnvironmentConfig;
}

/**
 * Discover all environment files in the given directory.
 */
export function discoverEnvironments(
  dir: string
): { name: string; filePath: string }[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return [".yaml", ".yml", ".json"].includes(ext);
  });

  return entries.map((f) => {
    const filePath = path.join(dir, f);
    try {
      const env = loadEnvironment(filePath);
      return { name: env.name || path.basename(f, path.extname(f)), filePath };
    } catch {
      return { name: path.basename(f, path.extname(f)), filePath };
    }
  });
}

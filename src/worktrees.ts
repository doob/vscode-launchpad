import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

export const WORKTREES_DIR = ".claude/worktrees";
export const RECORD_FILE = ".claude/worktrees/.launchpad-sessions.json";

/** Lowercase, kebab-case, git-and-fs-safe slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface WorktreePaths {
  dirName: string;
  relPath: string;
  branch: string;
}

/**
 * Compute a unique worktree dir name / path / branch for an env, given the
 * dir names already present under .claude/worktrees. Uses a counter suffix so
 * it is deterministic and collision-safe. Fills the lowest available gap, so
 * existing dirs ["staging-1","staging-3"] yield "staging-2".
 */
export function nextWorktreePaths(
  envName: string,
  existingDirNames: string[]
): WorktreePaths {
  const slug = slugify(envName);
  if (!slug) {
    throw new Error(
      `Cannot create a worktree for environment "${envName}": its name has no usable characters for a directory/branch name.`
    );
  }
  const taken = new Set(existingDirNames);
  let n = 1;
  while (taken.has(`${slug}-${n}`)) {
    n++;
  }
  const dirName = `${slug}-${n}`;
  return {
    dirName,
    relPath: `${WORKTREES_DIR}/${dirName}`,
    branch: `launchpad/${dirName}`,
  };
}

export interface GitWorktree {
  path: string;
  head?: string;
  branch?: string; // short name, e.g. "launchpad/staging-1"; undefined if detached
}

export interface SessionRecordEntry {
  env: string;
  worktreePath: string; // relative to repo root, e.g. ".claude/worktrees/staging-1"
  branch: string;
  createdAt: string; // ISO 8601
  originalEnvFile: string; // relative path to the env YAML/JSON
}

export function readRecord(file: string): SessionRecordEntry[] {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeRecord(file: string, entries: SessionRecordEntry[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(entries, null, 2));
}

export function addRecordEntry(file: string, entry: SessionRecordEntry): void {
  const entries = readRecord(file);
  entries.push(entry);
  writeRecord(file, entries);
}

/**
 * Drop record entries whose worktree no longer exists in git. `existingAbsPaths`
 * are absolute paths from `git worktree list`; `repoRoot` resolves the relative
 * worktreePath for comparison.
 */
export function reconcileRecord(
  entries: SessionRecordEntry[],
  existingAbsPaths: string[],
  repoRoot: string
): SessionRecordEntry[] {
  const live = new Set(existingAbsPaths.map((p) => path.resolve(p)));
  return entries.filter((e) =>
    live.has(path.resolve(repoRoot, e.worktreePath))
  );
}

/** Run git with args in repoRoot, returning stdout. Throws on non-zero exit. */
function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

/** True if repoRoot is inside a git work tree. */
export function isGitRepo(repoRoot: string): boolean {
  try {
    git(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/** List existing worktree dir names under .claude/worktrees (for unique naming). */
export function existingWorktreeDirNames(repoRoot: string): string[] {
  const dir = path.join(repoRoot, WORKTREES_DIR);
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** Create a new worktree + branch off HEAD. Returns the absolute worktree path. */
export function addWorktree(
  repoRoot: string,
  relPath: string,
  branch: string
): string {
  const abs = path.join(repoRoot, relPath);
  git(repoRoot, ["worktree", "add", "-b", branch, abs, "HEAD"]);
  return abs;
}

export function listWorktrees(repoRoot: string): GitWorktree[] {
  return parseWorktreePorcelain(
    git(repoRoot, ["worktree", "list", "--porcelain"])
  );
}

/** Remove a worktree (force, to tolerate uncommitted changes). */
export function removeWorktree(repoRoot: string, absPath: string): void {
  git(repoRoot, ["worktree", "remove", "--force", absPath]);
}

/** Glob patterns used to auto-detect env files when no explicit list is given. */
export const ENV_FILE_GLOBS = ["**/.env", "**/.env.*"];

/** True if a basename is an env file we want to seed worktrees with:
 *  `.env` or `.env.*`, excluding template files (*.example/*.sample/*.template). */
export function isEnvFileName(name: string): boolean {
  if (name !== ".env" && !name.startsWith(".env.")) return false;
  return !/\.(example|sample|template)$/i.test(name);
}

/**
 * Copy repo-relative files from repoRoot into the worktree, preserving
 * directory structure. Never throws on a single failure — collects them.
 * Skips files missing in the source.
 */
export function copyFilesIntoWorktree(
  repoRoot: string,
  worktreeAbs: string,
  relPaths: string[]
): { copied: string[]; failed: { path: string; error: string }[] } {
  const copied: string[] = [];
  const failed: { path: string; error: string }[] = [];
  for (const rel of relPaths) {
    const src = path.join(repoRoot, rel);
    const dest = path.join(worktreeAbs, rel);
    try {
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      copied.push(rel);
    } catch (err: any) {
      failed.push({ path: rel, error: err?.message ?? String(err) });
    }
  }
  return { copied, failed };
}

/** Parse `git worktree list --porcelain` output. */
export function parseWorktreePorcelain(output: string): GitWorktree[] {
  const result: GitWorktree[] = [];
  let current: GitWorktree | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length).trim() };
      result.push(current);
    } else if (!current) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ")) {
      current.branch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "");
    }
  }
  return result;
}

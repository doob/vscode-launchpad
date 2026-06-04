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

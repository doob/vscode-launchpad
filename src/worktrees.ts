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
 * it is deterministic and collision-safe.
 */
export function nextWorktreePaths(
  envName: string,
  existingDirNames: string[]
): WorktreePaths {
  const slug = slugify(envName);
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

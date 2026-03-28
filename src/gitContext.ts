import * as cp from "child_process";
import * as path from "path";

export interface GitContext {
  branch: string | undefined;
  pr: string | undefined;
  worktree: string | undefined;
  short: string; // e.g. "feat/login", "PR#87", "wt:hotfix"
}

function exec(cmd: string, cwd: string): string | undefined {
  try {
    return cp.execSync(cmd, { cwd, encoding: "utf-8", timeout: 3000 }).trim();
  } catch {
    return undefined;
  }
}

// ── Cache ──
// PR lookups are network calls via `gh` — cache per branch, TTL 60s.
// Branch/worktree detection is local git only — always fast, no cache needed.

const prCache = new Map<string, { pr: string | undefined; ts: number }>();
const PR_CACHE_TTL = 60_000; // 1 minute

/**
 * Get git context. Fast path (branch + worktree) is synchronous local git.
 * PR detection uses cache to avoid repeated `gh` network calls.
 */
export function getGitContext(cwd: string): GitContext {
  const branch = exec("git rev-parse --abbrev-ref HEAD", cwd);
  const worktree = detectWorktree(cwd);
  const pr = getCachedPR(cwd, branch);

  const parts: string[] = [];
  if (pr) {
    parts.push(`PR#${pr}`);
  }
  if (worktree) {
    parts.push(`wt:${worktree}`);
  }
  if (branch && branch !== "HEAD") {
    parts.push(shortenBranch(branch));
  }

  return {
    branch,
    pr,
    worktree,
    short: parts.join(" · ") || "detached",
  };
}

/**
 * Lightweight variant — only branch + worktree, no PR lookup.
 * Use this for frequent updates (file watcher events).
 */
export function getGitContextFast(cwd: string): GitContext {
  const branch = exec("git rev-parse --abbrev-ref HEAD", cwd);
  const worktree = detectWorktree(cwd);

  // Reuse cached PR if we have one, but don't fetch
  const cacheKey = branch || "__detached__";
  const cached = prCache.get(cacheKey);
  const pr = cached ? cached.pr : undefined;

  const parts: string[] = [];
  if (pr) {
    parts.push(`PR#${pr}`);
  }
  if (worktree) {
    parts.push(`wt:${worktree}`);
  }
  if (branch && branch !== "HEAD") {
    parts.push(shortenBranch(branch));
  }

  return {
    branch,
    pr,
    worktree,
    short: parts.join(" · ") || "detached",
  };
}

function detectWorktree(cwd: string): string | undefined {
  const gitCommonDir = exec("git rev-parse --git-common-dir", cwd);
  const gitDir = exec("git rev-parse --git-dir", cwd);

  if (!gitCommonDir || !gitDir) {
    return undefined;
  }

  const resolvedCommon = path.resolve(cwd, gitCommonDir);
  const resolvedGit = path.resolve(cwd, gitDir);

  if (resolvedCommon !== resolvedGit) {
    return path.basename(cwd);
  }

  return undefined;
}

function getCachedPR(
  cwd: string,
  branch: string | undefined
): string | undefined {
  const cacheKey = branch || "__detached__";
  const cached = prCache.get(cacheKey);

  if (cached && Date.now() - cached.ts < PR_CACHE_TTL) {
    return cached.pr;
  }

  // Fetch in background to avoid blocking — return stale or undefined
  fetchPRAsync(cwd, cacheKey);
  return cached?.pr;
}

function fetchPRAsync(cwd: string, cacheKey: string): void {
  try {
    const child = cp.exec(
      "gh pr view --json number --jq .number 2>/dev/null",
      { cwd, timeout: 5000 },
      (err, stdout) => {
        const pr = stdout?.trim();
        prCache.set(cacheKey, {
          pr: pr && /^\d+$/.test(pr) ? pr : undefined,
          ts: Date.now(),
        });
      }
    );
    // Don't let this child block Node exit
    child.unref();
  } catch {
    // Silently fail — PR info is optional
  }
}

function shortenBranch(branch: string): string {
  const ticketMatch = branch.match(/(?:^|\/|_)([A-Z]+-\d+)/i);
  if (ticketMatch) {
    return ticketMatch[1].toUpperCase();
  }

  const stripped = branch.replace(
    /^(feature|feat|fix|bugfix|hotfix|chore|release|dependabot)\//i,
    ""
  );

  if (stripped.length > 25) {
    return stripped.substring(0, 22) + "...";
  }

  return stripped;
}

/**
 * Clear caches — call on branch change to force fresh PR lookup.
 */
export function invalidateCache(): void {
  prCache.clear();
}

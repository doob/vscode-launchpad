# Worktree Session Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make worktree-launched Claude sessions findable on disk after a crash/reboot by having the extension own worktree creation, record which environment owns each worktree, and surface them in a top-level "Worktrees" sidebar node.

**Architecture:** Stop passing `-w` to the `claude` CLI. Instead, when `claude.worktree: true`, the extension runs `git worktree add` itself, launches the terminal with `cwd` set to that worktree, and writes a JSON record (`.claude/worktrees/.launchpad-sessions.json`) mapping environment → worktree path/branch. A new top-level sidebar node joins live `git worktree list` output with that record to show every worktree, with navigation and removal actions.

**Tech Stack:** TypeScript, VS Code Extension API, Node built-ins (`fs`, `path`, `child_process`), Bun test runner. All testable logic lives in `src/worktrees.ts` (no `vscode` import) so `bun test` runs headless.

---

## File Structure

- **Create `src/worktrees.ts`** — pure + IO helpers: `slugify`, `nextWorktreePaths`, `parseWorktreePorcelain`, `readRecord`, `writeRecord`, `reconcileRecord`, plus thin git wrappers `addWorktree`, `listWorktrees`, `removeWorktree`. Imports only `fs`, `path`, `child_process`. The `SessionRecordEntry` type lives here.
- **Create `src/worktrees.test.ts`** — Bun tests for the pure/IO functions.
- **Modify `src/extension.ts`** — create worktree + write record in `launchSession`; drop `-w` in `buildClaudeCommand`; register four worktree commands.
- **Modify `src/treeView.ts`** — top-level "Worktrees" node + worktree items; new fields on `EnvTreeItem`.
- **Modify `package.json`** — four commands + `view/item/context` menu entries + `view/title` refresh applies already.
- **Modify `README.md`, `CLAUDE.md`, `examples/*.yaml`, `schemas/environment.schema.json`** — document changed `claude.worktree` behavior.

---

### Task 1: Worktree module scaffold + `slugify` + `nextWorktreePaths`

**Files:**
- Create: `src/worktrees.ts`
- Create: `src/worktrees.test.ts`
- Modify: `package.json` (add `test` script)

- [ ] **Step 1: Add the test script**

In `package.json` `"scripts"`, add after `"lint"`:

```json
    "test": "bun test",
```

- [ ] **Step 2: Write the failing test**

Create `src/worktrees.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { slugify, nextWorktreePaths } from "./worktrees";

describe("slugify", () => {
  test("lowercases and kebab-cases", () => {
    expect(slugify("My Staging Env")).toBe("my-staging-env");
  });
  test("strips unsafe characters", () => {
    expect(slugify("feature/Foo_Bar!")).toBe("feature-foo-bar");
  });
  test("collapses repeats and trims dashes", () => {
    expect(slugify("  a   b  ")).toBe("a-b");
  });
});

describe("nextWorktreePaths", () => {
  test("first id is 1 when no existing dirs", () => {
    const r = nextWorktreePaths("staging", []);
    expect(r.dirName).toBe("staging-1");
    expect(r.relPath).toBe(".claude/worktrees/staging-1");
    expect(r.branch).toBe("launchpad/staging-1");
  });
  test("skips existing dir names for the same env", () => {
    const r = nextWorktreePaths("staging", ["staging-1", "staging-2", "other-1"]);
    expect(r.dirName).toBe("staging-3");
  });
  test("slugifies the env name", () => {
    const r = nextWorktreePaths("My Env", []);
    expect(r.dirName).toBe("my-env-1");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test src/worktrees.test.ts`
Expected: FAIL — `Cannot find module './worktrees'`.

- [ ] **Step 4: Write minimal implementation**

Create `src/worktrees.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/worktrees.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/worktrees.ts src/worktrees.test.ts package.json
git commit -m "feat: worktree path/branch slug helpers"
```

---

### Task 2: `parseWorktreePorcelain`

**Files:**
- Modify: `src/worktrees.ts`
- Test: `src/worktrees.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/worktrees.test.ts`:

```ts
import { parseWorktreePorcelain } from "./worktrees";

describe("parseWorktreePorcelain", () => {
  const sample = [
    "worktree /repo",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    "worktree /repo/.claude/worktrees/staging-1",
    "HEAD def456",
    "branch refs/heads/launchpad/staging-1",
    "",
    "worktree /repo/.claude/worktrees/detached-1",
    "HEAD aaa111",
    "detached",
    "",
  ].join("\n");

  test("parses all worktrees with path/head/branch", () => {
    const wts = parseWorktreePorcelain(sample);
    expect(wts).toHaveLength(3);
    expect(wts[0]).toEqual({ path: "/repo", head: "abc123", branch: "main" });
    expect(wts[1].branch).toBe("launchpad/staging-1");
  });

  test("detached worktree has undefined branch", () => {
    const wts = parseWorktreePorcelain(sample);
    expect(wts[2].branch).toBeUndefined();
    expect(wts[2].path).toBe("/repo/.claude/worktrees/detached-1");
  });

  test("empty input yields empty array", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/worktrees.test.ts`
Expected: FAIL — `parseWorktreePorcelain is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/worktrees.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/worktrees.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worktrees.ts src/worktrees.test.ts
git commit -m "feat: parse git worktree porcelain output"
```

---

### Task 3: Record read/write/reconcile

**Files:**
- Modify: `src/worktrees.ts`
- Test: `src/worktrees.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/worktrees.test.ts`:

```ts
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  readRecord,
  writeRecord,
  addRecordEntry,
  reconcileRecord,
  type SessionRecordEntry,
} from "./worktrees";

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-test-"));
  return path.join(dir, "rec.json");
}

const entry: SessionRecordEntry = {
  env: "staging",
  worktreePath: ".claude/worktrees/staging-1",
  branch: "launchpad/staging-1",
  createdAt: "2026-06-04T10:00:00.000Z",
  originalEnvFile: ".launchpad/staging.yaml",
};

describe("record read/write", () => {
  test("readRecord returns [] for missing file", () => {
    expect(readRecord(path.join(os.tmpdir(), "does-not-exist-xyz.json"))).toEqual([]);
  });
  test("write then read round-trips", () => {
    const f = tmpFile();
    writeRecord(f, [entry]);
    expect(readRecord(f)).toEqual([entry]);
  });
  test("readRecord returns [] for corrupt JSON", () => {
    const f = tmpFile();
    fs.writeFileSync(f, "{ not json");
    expect(readRecord(f)).toEqual([]);
  });
  test("addRecordEntry appends and persists", () => {
    const f = tmpFile();
    writeRecord(f, []);
    addRecordEntry(f, entry);
    expect(readRecord(f)).toEqual([entry]);
  });
});

describe("reconcileRecord", () => {
  test("drops entries whose worktree path is gone", () => {
    const e2 = { ...entry, worktreePath: ".claude/worktrees/staging-2" };
    const kept = reconcileRecord([entry, e2], ["/repo/.claude/worktrees/staging-1"], "/repo");
    expect(kept).toEqual([entry]);
  });
  test("keeps all when all paths present", () => {
    const kept = reconcileRecord([entry], ["/repo/.claude/worktrees/staging-1"], "/repo");
    expect(kept).toEqual([entry]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/worktrees.test.ts`
Expected: FAIL — missing exports (`readRecord`, etc.).

- [ ] **Step 3: Write minimal implementation**

Add to `src/worktrees.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/worktrees.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worktrees.ts src/worktrees.test.ts
git commit -m "feat: session record read/write/reconcile"
```

---

### Task 4: Git worktree wrappers (`addWorktree`, `listWorktrees`, `removeWorktree`)

**Files:**
- Modify: `src/worktrees.ts`

These are thin `execFileSync` wrappers verified manually in the Extension Dev Host (Task 9), not unit-tested. No new test.

- [ ] **Step 1: Add the implementation**

Add to `src/worktrees.ts`:

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `bun run compile`
Expected: no errors.

- [ ] **Step 3: Run the full module test suite (no regressions)**

Run: `bun test src/worktrees.test.ts`
Expected: PASS (all prior tests still green).

- [ ] **Step 4: Commit**

```bash
git add src/worktrees.ts
git commit -m "feat: git worktree add/list/remove wrappers"
```

---

### Task 5: Drop `-w` and create the worktree at launch

**Files:**
- Modify: `src/extension.ts:311-314` (remove `-w`)
- Modify: `src/extension.ts` `launchSession` (~514-636)

- [ ] **Step 1: Remove the `-w` flag from `buildClaudeCommand`**

In `src/extension.ts`, delete these lines (currently ~311-314):

```ts
  // Open in a new git worktree
  if (envConfig.claude?.worktree) {
    args.push("-w");
  }
```

- [ ] **Step 2: Import the worktree helpers**

At the top of `src/extension.ts`, add to the imports:

```ts
import {
  addWorktree,
  addRecordEntry,
  existingWorktreeDirNames,
  isGitRepo,
  nextWorktreePaths,
  RECORD_FILE,
  type SessionRecordEntry,
} from "./worktrees";
```

- [ ] **Step 3: Create the worktree before `createTerminal`**

In `launchSession`, locate the block that builds the terminal name (the
`const terminalIcon = ...` / `const terminal = vscode.window.createTerminal({ ... cwd: root ... })`
section, ~602-616). Immediately BEFORE `const terminal = vscode.window.createTerminal({`, insert:

```ts
    // Determine launch cwd — own the worktree ourselves when requested.
    let launchCwd = root;
    if (envConfig.claude?.worktree) {
      if (!isGitRepo(root)) {
        vscode.window.showWarningMessage(
          "claude.worktree is set but this workspace is not a git repository — launching in the workspace root instead."
        );
      } else {
        try {
          const { relPath, branch } = nextWorktreePaths(
            envConfig.name,
            existingWorktreeDirNames(root)
          );
          launchCwd = addWorktree(root, relPath, branch);
          const recordEntry: SessionRecordEntry = {
            env: envConfig.name,
            worktreePath: relPath,
            branch,
            createdAt: new Date().toISOString(),
            originalEnvFile: path.relative(root, envFilePath!),
          };
          addRecordEntry(path.join(root, RECORD_FILE), recordEntry);
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Failed to create git worktree: ${err.message}. Launching in the workspace root instead.`
          );
          launchCwd = root;
        }
      }
    }
```

- [ ] **Step 4: Use `launchCwd` for the terminal**

Change the `createTerminal` call's `cwd` from `cwd: root,` to:

```ts
      cwd: launchCwd,
```

- [ ] **Step 5: Refresh the tree so the new worktree shows**

Immediately after the existing `treeProvider.setActive(envName);` line, add:

```ts
    treeProvider.refresh();
```

- [ ] **Step 6: Type-check and build**

Run: `bun run compile && bun run build`
Expected: no errors; `dist/extension.js` rebuilt.

- [ ] **Step 7: Commit**

```bash
git add src/extension.ts
git commit -m "feat: own git worktree creation at launch, write session record"
```

---

### Task 6: Top-level "Worktrees" node in the tree view

**Files:**
- Modify: `src/treeView.ts` (imports, `EnvTreeItem` fields, `getChildren`)

- [ ] **Step 1: Import worktree helpers and types in treeView.ts**

Add to the imports at the top of `src/treeView.ts`:

```ts
import {
  isGitRepo,
  listWorktrees,
  readRecord,
  reconcileRecord,
  writeRecord,
  WORKTREES_DIR,
  RECORD_FILE,
  type GitWorktree,
  type SessionRecordEntry,
} from "./worktrees";
```

- [ ] **Step 2: Add worktree fields to `EnvTreeItem`**

In the `EnvTreeItem` class (after `public envName?: string;`), add:

```ts
  public worktreeAbsPath?: string;
```

- [ ] **Step 3: Add the Worktrees node at the top level**

In `getChildren`, inside the `if (!element) {` block, AFTER computing `envs` and
the empty-environments placeholder branch but BEFORE `return envs.map(...)`,
capture the env items and prepend the worktrees node. Replace:

```ts
      return envs.map((e) => {
```

with:

```ts
      const envItems = envs.map((e) => {
```

Then, at the END of that `.map(...)` (after the closing `});` of the map), add:

```ts
      const wtNode = this.buildWorktreesNode();
      return wtNode ? [wtNode, ...envItems] : envItems;
```

(So the final value of the `if (!element)` block is `wtNode ? [...] : envItems`
instead of the bare `return envs.map(...)`.)

- [ ] **Step 4: Add the `buildWorktreesNode` method**

Add this private method to `EnvironmentTreeProvider` (e.g. right after `getChildren`):

```ts
  /** Top-level node listing live worktrees joined with the session record. */
  private buildWorktreesNode(): EnvTreeItem | undefined {
    const root = this.workspaceRoot;
    if (!root || !isGitRepo(root)) {
      return undefined;
    }

    let worktrees: GitWorktree[];
    try {
      worktrees = listWorktrees(root);
    } catch {
      return undefined;
    }

    const underDir = worktrees.filter((w) =>
      path
        .resolve(w.path)
        .startsWith(path.resolve(root, WORKTREES_DIR) + path.sep)
    );
    if (underDir.length === 0) {
      return undefined;
    }

    // Reconcile the record against what actually exists, persisting the prune.
    const recordFile = path.join(root, RECORD_FILE);
    const reconciled = reconcileRecord(
      readRecord(recordFile),
      underDir.map((w) => w.path),
      root
    );
    writeRecord(recordFile, reconciled);
    const byPath = new Map<string, SessionRecordEntry>(
      reconciled.map((e) => [path.resolve(root, e.worktreePath), e])
    );

    const group = new EnvTreeItem(
      "Worktrees",
      "",
      vscode.TreeItemCollapsibleState.Expanded
    );
    group.contextValue = "group-worktrees";
    group.iconPath = new vscode.ThemeIcon("git-branch");
    group.children = underDir.map((w) => {
      const abs = path.resolve(w.path);
      const rec = byPath.get(abs);
      const label = rec ? rec.env : w.branch || path.basename(w.path);
      const item = new EnvTreeItem(
        label,
        "",
        vscode.TreeItemCollapsibleState.None
      );
      item.description = rec ? w.branch || "" : "(unknown env)";
      item.tooltip = abs;
      item.iconPath = new vscode.ThemeIcon("folder");
      item.contextValue = "worktree-item";
      item.worktreeAbsPath = abs;
      item.command = {
        command: "launchpad.openWorktreeFolder",
        title: "Open Worktree in New Window",
        arguments: [item],
      };
      return item;
    });
    return group;
  }
```

- [ ] **Step 5: Type-check and build**

Run: `bun run compile && bun run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/treeView.ts
git commit -m "feat: top-level Worktrees node joining git state with record"
```

---

### Task 7: Worktree commands + package.json wiring

**Files:**
- Modify: `src/extension.ts` (register four commands)
- Modify: `package.json` (`commands` + `view/item/context` menus)

- [ ] **Step 1: Register the commands in `activate`**

In `src/extension.ts` `activate`, alongside the other
`context.subscriptions.push(vscode.commands.registerCommand(...))` calls, add:

```ts
    vscode.commands.registerCommand(
      "launchpad.openWorktreeFolder",
      (item?: EnvTreeItem) => {
        if (!item?.worktreeAbsPath) return;
        vscode.commands.executeCommand(
          "vscode.openFolder",
          vscode.Uri.file(item.worktreeAbsPath),
          { forceNewWindow: true }
        );
      }
    ),
    vscode.commands.registerCommand(
      "launchpad.revealWorktree",
      (item?: EnvTreeItem) => {
        if (!item?.worktreeAbsPath) return;
        vscode.commands.executeCommand(
          "revealFileInOS",
          vscode.Uri.file(item.worktreeAbsPath)
        );
      }
    ),
    vscode.commands.registerCommand(
      "launchpad.openWorktreeTerminal",
      (item?: EnvTreeItem) => {
        if (!item?.worktreeAbsPath) return;
        const term = vscode.window.createTerminal({
          name: `wt: ${item.label}`,
          cwd: item.worktreeAbsPath,
        });
        term.show();
      }
    ),
    vscode.commands.registerCommand(
      "launchpad.removeWorktree",
      async (item?: EnvTreeItem) => {
        if (!item?.worktreeAbsPath) return;
        const ok = await vscode.window.showWarningMessage(
          `Remove worktree at ${item.worktreeAbsPath}? This deletes the working directory.`,
          { modal: true },
          "Remove"
        );
        if (ok !== "Remove") return;
        const root = getWorkspaceRoot();
        if (!root) return;
        try {
          removeWorktree(root, item.worktreeAbsPath);
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Failed to remove worktree: ${err.message}`
          );
          return;
        }
        treeProvider.refresh();
      }
    ),
```

- [ ] **Step 2: Import `removeWorktree` in extension.ts**

Add `removeWorktree` to the existing `./worktrees` import added in Task 5:

```ts
import {
  addWorktree,
  addRecordEntry,
  existingWorktreeDirNames,
  isGitRepo,
  nextWorktreePaths,
  removeWorktree,
  RECORD_FILE,
  type SessionRecordEntry,
} from "./worktrees";
```

- [ ] **Step 3: Add the commands to `package.json`**

In `package.json` `"contributes" → "commands"`, add four entries:

```json
      {
        "command": "launchpad.openWorktreeFolder",
        "title": "Open Worktree in New Window",
        "category": "Launchpad",
        "icon": "$(empty-window)"
      },
      {
        "command": "launchpad.revealWorktree",
        "title": "Reveal Worktree in File Explorer",
        "category": "Launchpad",
        "icon": "$(folder-opened)"
      },
      {
        "command": "launchpad.openWorktreeTerminal",
        "title": "Open Terminal in Worktree",
        "category": "Launchpad",
        "icon": "$(terminal)"
      },
      {
        "command": "launchpad.removeWorktree",
        "title": "Remove Worktree",
        "category": "Launchpad",
        "icon": "$(trash)"
      }
```

- [ ] **Step 4: Add the menu entries to `package.json`**

In `package.json` `"contributes" → "menus" → "view/item/context"`, add:

```json
        {
          "command": "launchpad.openWorktreeFolder",
          "when": "view == launchpad.environmentList && viewItem == worktree-item",
          "group": "inline@1"
        },
        {
          "command": "launchpad.openWorktreeTerminal",
          "when": "view == launchpad.environmentList && viewItem == worktree-item",
          "group": "inline@2"
        },
        {
          "command": "launchpad.openWorktreeFolder",
          "when": "view == launchpad.environmentList && viewItem == worktree-item",
          "group": "1_actions@1"
        },
        {
          "command": "launchpad.revealWorktree",
          "when": "view == launchpad.environmentList && viewItem == worktree-item",
          "group": "1_actions@2"
        },
        {
          "command": "launchpad.openWorktreeTerminal",
          "when": "view == launchpad.environmentList && viewItem == worktree-item",
          "group": "1_actions@3"
        },
        {
          "command": "launchpad.removeWorktree",
          "when": "view == launchpad.environmentList && viewItem == worktree-item",
          "group": "2_manage@1"
        }
```

- [ ] **Step 5: Type-check and build**

Run: `bun run compile && bun run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: worktree navigation and removal commands"
```

---

### Task 8: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `schemas/environment.schema.json`
- Modify: `examples/local-dev.yaml`, `examples/staging.yaml`

- [ ] **Step 1: Update the `worktree` description in the JSON schema**

In `schemas/environment.schema.json`, find the `worktree` property and update its
`description` to reflect the new behavior:

```json
        "worktree": {
          "type": "boolean",
          "description": "Launch the session in a dedicated git worktree under .claude/worktrees, created and tracked by Launchpad. The worktree appears in the sidebar 'Worktrees' section so you can find it again after a crash or restart."
        }
```

- [ ] **Step 2: Update README**

In `README.md`, find the section/line documenting `claude.worktree` (the `-w`
mention from commit 524e69e). Replace the description so it states that Launchpad
creates and tracks the worktree under `.claude/worktrees`, names the branch
`launchpad/<env>-<n>`, and lists it in the sidebar **Worktrees** section with
actions to open it in a new window, reveal it, open a terminal there, or remove
it. Remove any claim that it passes `-w` to the CLI.

- [ ] **Step 3: Update CLAUDE.md**

In `CLAUDE.md`, under the module list, update the `gitContext.ts` neighbours /
add a line for `worktrees.ts`:

```
- `worktrees.ts` — owns git worktree creation for `claude.worktree` sessions, the on-disk session record (`.claude/worktrees/.launchpad-sessions.json`), and helpers to list/reconcile/remove worktrees for the sidebar
```

Also update the launch-flow note so it no longer says the worktree is created via
the CLI `-w` flag.

- [ ] **Step 4: Update example YAML comments**

In `examples/local-dev.yaml` and `examples/staging.yaml`, update the inline
comment next to `worktree:` to read:

```yaml
    worktree: true   # launch in a tracked git worktree under .claude/worktrees (find it later in the sidebar)
```

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md schemas/environment.schema.json examples/local-dev.yaml examples/staging.yaml
git commit -m "docs: document Launchpad-owned worktree behavior"
```

---

### Task 9: Manual verification in the Extension Dev Host

**Files:** none (manual QA)

- [ ] **Step 1: Build and launch the dev host**

Run: `bun run build`, then press **F5** in VS Code to open the Extension
Development Host on a git-repo workspace that has at least one environment with
`claude.worktree: true`.

- [ ] **Step 2: Launch a worktree session**

Launch the environment from the sidebar. Verify:
- a new terminal opens with its cwd inside `.claude/worktrees/<env>-1`,
- `git worktree list` shows the new worktree on branch `launchpad/<env>-1`,
- `.claude/worktrees/.launchpad-sessions.json` contains a matching entry.

- [ ] **Step 3: Verify the Worktrees node**

Confirm a top-level **Worktrees** node lists the worktree with the env name and
branch. Launch a second concurrent session and confirm both appear distinctly.

- [ ] **Step 4: Verify the actions**

For a worktree item, confirm: click opens the folder in a new window; "Reveal"
opens the OS file explorer; "Open Terminal in Worktree" opens a terminal there;
"Remove Worktree" (after confirm) deletes it, and the node updates / disappears
when empty.

- [ ] **Step 5: Verify reboot survival and reconcile**

Close and reopen the dev-host window; confirm the Worktrees node still lists
existing worktrees. Manually run `git worktree remove --force <path>` on one, then
refresh the tree; confirm it disappears and the record file no longer lists it.

- [ ] **Step 6: Verify non-git + fallback**

On a non-git workspace, confirm no Worktrees node appears and launching a
`worktree: true` env shows the warning and launches in the workspace root.

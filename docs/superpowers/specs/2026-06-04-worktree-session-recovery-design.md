# Worktree Session Recovery — Design

**Date:** 2026-06-04
**Status:** Approved (pending spec review)

## Problem

When `claude.worktree: true` is set, sessions launch in a git worktree under
`.claude/worktrees`. If a session breaks mid-way — terminal tab closes, VS Code
restarts, or the machine reboots — it is hard to find which worktree on disk the
session was running in. The pain is acute when several worktree sessions run at
once, because nothing records which worktree belongs to which environment.

The root cause: today the extension delegates worktree creation to the `claude`
CLI via the `-w` flag, so it never learns the path the CLI picks and cannot map a
worktree back to the environment that spawned it.

## Goal (scope)

Reliably **locate on disk** which worktree corresponds to which environment, and
navigate there — even after a full VS Code restart or reboot. Out of scope:
auto-resuming the `claude` session for the user (navigation is enough; resume
works naturally once you are in the right directory).

## Approach

**The extension owns worktree creation.** Stop passing `-w`; instead the
extension runs `git worktree add` itself, controls the path and branch naming,
and writes an on-disk record mapping environment → worktree. The sidebar surfaces
all worktrees by joining live git state with that record.

This is the only approach that makes attribution correct under concurrency (the
core complaint). The cost is reimplementing what `-w` did (branch creation +
cleanup).

## Part 1 — Owning the worktree at launch

### Trigger
The `claude.worktree: true` config flag is unchanged for users. Only its
implementation changes: the extension no longer appends `-w` to the claude
command.

### Worktree creation
Just before `createTerminal` in `launchSession` (extension.ts), when
`worktree === true`:

1. Compute a worktree path: `.claude/worktrees/<env-slug>-<shortid>`.
   - `<env-slug>` is the environment name lowercased and kebab-cased.
   - `<shortid>` is a short, collision-safe suffix. `Date.now()` / `Math.random()`
     are not reliably available mid-flow, so the suffix is derived from a
     git-safe unique scheme (e.g. a counter against existing
     `.claude/worktrees` entries, plus the env slug). Uniqueness is guaranteed by
     checking the target path does not already exist before `git worktree add`.
2. Run `git worktree add -b launchpad/<env-slug>-<shortid> <path> HEAD` from
   `root`. The branch name carries the env so it is identifiable in
   `git worktree list` and `git branch` as well.
3. Set the terminal's `cwd` to `<path>` instead of `root`. Everything else
   (system-prompt env var, command string, hooks) is identical.
   Pre-launch hooks and Docker Compose continue to default to `root` (they have
   their own `cwd` field) — unchanged.
4. On failure (`git worktree add` errors — dirty conflict, not a git repo, etc.):
   show a clear error toast and fall back to launching at `root`, so the session
   still starts.

### Session record
On-disk source of truth that survives reboot.

- Location: `.claude/worktrees/.launchpad-sessions.json` — lives alongside the
  worktrees and inherits whatever ignores `.claude/worktrees`.
- One entry per launched worktree:
  ```json
  {
    "env": "staging",
    "worktreePath": ".claude/worktrees/staging-1",
    "branch": "launchpad/staging-1",
    "createdAt": "2026-06-04T10:00:00.000Z",
    "originalEnvFile": ".launchpad/staging.yaml"
  }
  ```
- `createdAt` is stamped from a timestamp captured at the launch call site (since
  `Date.now()` is not reliably available deeper in the flow) and passed in.
- Written immediately after a successful `git worktree add`. This link is the
  thing that is lost today.

## Part 2 — Surfacing & lifecycle

### Placement
A single top-level collapsible **"Worktrees"** node, sibling to the environment
list, shown only when worktrees exist. Not nested per-env: a worktree can outlive
its environment (deleted YAML), and the user needs to see all concurrent sessions
in one place.

### Data flow (on expand)
1. Run `git worktree list --porcelain` from `root` → truth for what exists.
2. Read `.launchpad-sessions.json` → env attribution.
3. Join on path, filtered to worktrees under `.claude/worktrees`:
   - **Tracked** (in both) → label shows env name + branch.
   - **Orphaned** (on disk, not in record) → label shows branch + "(unknown
     env)", still fully navigable.
4. **Reconcile:** record entries whose path no longer appears in
   `git worktree list` are stale (worktree removed outside the extension) →
   auto-pruned from the JSON on read, so the record self-heals.

### Worktree tree item
Shows env name, branch, and path (as description/tooltip). Actions via
`view/item/context` menu plus a default click:

- **Open Folder in New Window** (default click) — `vscode.openFolder` on the
  worktree. Gets you back to where the session was.
- **Reveal in Finder/Explorer** — `revealFileInOS`.
- **Open Terminal Here** — new terminal with `cwd` at the worktree (handy for
  `claude --resume`).
- **Remove Worktree** — `git worktree remove` + prune the record entry.

### Refresh
The node re-reads on the existing tree refresh and the existing git watcher — no
polling.

### Edge cases
- Non-git workspace → node hidden.
- `git worktree add` failure at launch → error toast + fallback to `root`.
- Concurrent launches → each gets a unique path/branch, so no collision.

## Testing

- Unit-test the record read/write/reconcile as pure functions over a temp dir
  plus faked `git worktree list --porcelain` output.
- Unit-test the path/branch slug generation (slugging, uniqueness).
- VS Code tree wiring verified manually in the Extension Dev Host, matching how
  the rest of the extension is tested.

## Files affected

- `src/extension.ts` — worktree creation in `launchSession`; drop `-w` in
  `buildClaudeCommand`; record write; new commands (open folder, reveal, open
  terminal, remove).
- `src/types.ts` — session record type.
- `src/treeView.ts` — top-level Worktrees node + worktree items.
- New module (e.g. `src/worktrees.ts`) — record read/write/reconcile, git
  worktree add/list/remove helpers, slug generation.
- `package.json` — new commands + `view/item/context` menu entries.
- `README.md`, `CLAUDE.md`, example YAMLs / schema — document the changed
  `claude.worktree` behavior (per the Maintenance rule).

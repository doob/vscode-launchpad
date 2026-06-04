import { describe, expect, test } from "bun:test";
import { slugify, nextWorktreePaths } from "./worktrees";
import { parseWorktreePorcelain } from "./worktrees";
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
    expect(r.relPath).toBe(".claude/worktrees/staging-3");
    expect(r.branch).toBe("launchpad/staging-3");
  });
  test("throws when the env name has no usable characters", () => {
    expect(() => nextWorktreePaths("!!!", [])).toThrow();
  });
  test("slugifies the env name", () => {
    const r = nextWorktreePaths("My Env", []);
    expect(r.dirName).toBe("my-env-1");
  });
});

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

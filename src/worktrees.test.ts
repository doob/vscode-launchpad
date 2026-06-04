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

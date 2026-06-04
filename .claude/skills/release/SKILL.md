---
name: release
description: "Package the Launchpad VS Code extension. Use this skill when the user says /release, wants to bump the version, package a .vsix, or prepare a new version of the extension."
---

# Release — Launchpad VS Code Extension

This skill handles versioning, changelog updates, packaging, and publishing for the Launchpad extension.

> **Distribution:** Every release is attached as a `.vsix` to a GitHub Release, and published to **Open VSX** (`open-vsx.org`) for **automatic upgrades**. Open VSX reaches stock VS Code (via the Extensions panel after the user adds it as a gallery, or by direct install), Cursor, Windsurf, VSCodium, Gitpod, and Theia.
>
> The Microsoft VS Code Marketplace is intentionally **not** used — its Azure DevOps publisher setup is more friction than it's worth here. Open VSX provides the same auto-update mechanism without it.
>
> Open VSX publishing requires an `open-vsx.org` access token. The skill reads it from the `OVSX_PAT` environment variable; if it is not set, the skill stops after the GitHub Release and tells the user how to provide it.

## Usage

```
/release              → interactive: ask what kind of release (patch/minor/major)
/release patch        → bump patch, update changelog, package
/release minor        → bump minor version
/release major        → bump major version
```

Append `--no-publish` to stop after the GitHub Release (skip registry publishing).

## Release Flow

Follow these steps in order. Each step depends on the previous one succeeding.

### 1. Pre-flight checks

Before doing anything, verify the environment is ready:

```bash
# Must be on main branch with clean working tree
git status --porcelain
git branch --show-current

# Node modules installed
test -d node_modules || bun install

# vsce available
bunx @vscode/vsce --version

# Type-check passes (the real correctness gate)
bun run compile

# Lint passes — NOTE: `bun run lint` calls eslint, which may not be installed
# (not in devDependencies). If it fails with "eslint: command not found",
# treat it as a non-blocking environment gap, note it, and rely on compile.
bun run lint || true

# Build succeeds (this also runs via vscode:prepublish)
bun run build

# Tests pass
bun test
```

If `compile`, `build`, or `test` fails, stop and fix the issues before continuing. A missing-eslint lint failure is non-blocking; any other failure is.

### 2. Determine version bump

Read the current version from `package.json`. If the user specified patch/minor/major, use that. Otherwise, ask them.

- **patch** (0.6.0 → 0.6.1): bug fixes, small tweaks
- **minor** (0.6.0 → 0.7.0): new features, meaningful changes
- **major** (0.6.0 → 1.0.0): breaking changes, major milestones

Bump the version by editing the `"version"` field in `package.json` directly (e.g. `0.7.2` → `0.8.0`). Do NOT use `bun version` — it is not available here (`bun` treats `version` as a missing script). We handle the git commit and tag ourselves after updating the changelog.

### 3. Update CHANGELOG.md

Read the current `CHANGELOG.md`. Add a new section at the top (below the header) for the new version with today's date.

To populate the changelog entry:
1. Look at `git log` since the last version tag (or the last changelog entry date)
2. Categorize changes into **Added**, **Changed**, **Fixed**, **Removed** sections (only include sections that have entries)
3. Write clear, user-facing descriptions — not commit messages

The changelog follows [Keep a Changelog](https://keepachangelog.com/) format. Match the style of existing entries.

### 4. Package the .vsix

```bash
bunx @vscode/vsce package --no-dependencies
```

This produces `launchpad-<version>.vsix` in the project root. The `--no-dependencies` flag is used because the extension bundles everything via esbuild (the only runtime dependency `yaml` is included in the bundle).

Verify the .vsix was created and report its file size.

### 5. Git commit and tag

After packaging:

```bash
git add package.json CHANGELOG.md
git commit -m "release: v<version>"
git tag "v<version>"
```

Push the commit and tag:
```bash
git push && git push --tags
```

### 6. Create GitHub Release

Create a GitHub release with the `.vsix` attached. Use the changelog entry for the release notes:

```bash
gh release create "v<version>" launchpad-<version>.vsix \
  --title "v<version>" \
  --notes "<changelog entry for this version>"
```

The `--notes` body should include the changelog sections (Added, Changed, Fixed, etc.) formatted in markdown. Also include an install instruction at the bottom:

```markdown
## Install

Download `launchpad-<version>.vsix` and run:
\`\`\`bash
code --install-extension launchpad-<version>.vsix
\`\`\`
```

### 7. Publish to Open VSX

This is what delivers automatic upgrades to users. Skip this step entirely if the user passed `--no-publish`.

First check for the token:

```bash
test -n "$OVSX_PAT" && echo "token present" || echo "OVSX_PAT not set"
```

**If `OVSX_PAT` is not set**, stop here (after the GitHub Release) and tell the user:
> Open VSX publishing needs a token. Create an account at https://open-vsx.org, generate an access token (Settings → Access Tokens), then re-run with it available — e.g. `OVSX_PAT=<token> claude` for the session, or paste it via `! export OVSX_PAT=<token>`. First-time publishers must also create the `doob` namespace once: `bunx ovsx create-namespace doob -p <token>`.

**If `OVSX_PAT` is set**, publish the already-built `.vsix` (do not rebuild):

```bash
bunx ovsx publish launchpad-<version>.vsix -p "$OVSX_PAT"
```

Report the Open VSX extension URL: `https://open-vsx.org/extension/doob/launchpad`.

If publish fails with a namespace error, run `bunx ovsx create-namespace doob -p "$OVSX_PAT"` once, then retry the publish.

### 8. Summary

Report back:
- Previous version → new version
- Changelog entry (abbreviated)
- .vsix file path and size
- Git tag created
- GitHub release URL
- Open VSX status (published + URL, or skipped because `OVSX_PAT` was absent / `--no-publish`)
- Whether changes were pushed

## Error Handling

- **Dirty working tree**: warn the user and list the uncommitted changes. Ask if they want to proceed anyway (changes will be included in the release commit) or if they'd rather commit first.
- **compile/build/test failure**: stop immediately, show the errors, and help fix them. A `bun run lint` failure caused by eslint not being installed is non-blocking.
- **Open VSX publish failure**: the GitHub Release already succeeded, so the release is not lost — report the error, suggest the namespace fix if relevant, and let the user retry just the publish step (`bunx ovsx publish launchpad-<version>.vsix -p "$OVSX_PAT"`).

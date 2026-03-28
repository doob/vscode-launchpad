---
name: release
description: "Package and publish the Launchpad VS Code extension. Use this skill when the user says /release, wants to bump the version, publish to the marketplace, create a release, package a .vsix, or prepare a new version of the extension."
---

# Release — Launchpad VS Code Extension

This skill handles versioning, changelog updates, packaging, and publishing for the Launchpad extension.

## Usage

```
/release              → interactive: ask what kind of release (patch/minor/major)
/release patch        → bump patch, update changelog, package, and publish
/release minor        → bump minor version
/release major        → bump major version
/release --dry-run    → do everything except the actual publish
/release --package    → only produce the .vsix file, skip publishing
```

## Release Flow

Follow these steps in order. Each step depends on the previous one succeeding.

### 1. Pre-flight checks

Before doing anything, verify the environment is ready:

```bash
# Must be on main branch with clean working tree
git status --porcelain
git branch --show-current

# Node modules installed
test -d node_modules || npm install

# vsce available
npx @vscode/vsce --version

# Lint passes
npm run lint

# Build succeeds (this also runs via vscode:prepublish)
npm run build
```

If lint or build fails, stop and fix the issues before continuing. Do not skip these checks.

### 2. Determine version bump

Read the current version from `package.json`. If the user specified patch/minor/major, use that. Otherwise, ask them.

- **patch** (0.6.0 → 0.6.1): bug fixes, small tweaks
- **minor** (0.6.0 → 0.7.0): new features, meaningful changes
- **major** (0.6.0 → 1.0.0): breaking changes, major milestones

Bump the version using npm:
```bash
npm version <patch|minor|major> --no-git-tag-version
```

The `--no-git-tag-version` flag is important — we handle the git commit and tag ourselves after updating the changelog.

### 3. Update CHANGELOG.md

Read the current `CHANGELOG.md`. Add a new section at the top (below the header) for the new version with today's date.

To populate the changelog entry:
1. Look at `git log` since the last version tag (or the last changelog entry date)
2. Categorize changes into **Added**, **Changed**, **Fixed**, **Removed** sections (only include sections that have entries)
3. Write clear, user-facing descriptions — not commit messages

The changelog follows [Keep a Changelog](https://keepachangelog.com/) format. Match the style of existing entries.

### 4. Package the .vsix

```bash
npx @vscode/vsce package --no-dependencies
```

This produces `launchpad-<version>.vsix` in the project root. The `--no-dependencies` flag is used because the extension bundles everything via esbuild (the only runtime dependency `yaml` is included in the bundle).

Verify the .vsix was created and report its file size.

### 5. Publish (unless --dry-run or --package)

```bash
npx @vscode/vsce publish --no-dependencies
```

This requires a Personal Access Token (PAT) for the VS Code Marketplace. If publishing fails due to auth:
- Tell the user to run: `npx @vscode/vsce login doob`
- Or set the `VSCE_PAT` environment variable

**Do not proceed with publish without confirming with the user first.** Publishing is irreversible — a version number cannot be reused once published.

### 6. Git commit and tag

After a successful publish (or after packaging if `--package`):

```bash
git add package.json CHANGELOG.md
git commit -m "release: v<version>"
git tag "v<version>"
```

Ask the user if they want to push:
```bash
git push && git push --tags
```

### 7. Summary

Report back:
- Previous version → new version
- Changelog entry (abbreviated)
- .vsix file path and size
- Whether it was published or dry-run
- Git tag created
- Whether changes were pushed

## Error Handling

- **Dirty working tree**: warn the user and list the uncommitted changes. Ask if they want to proceed anyway (changes will be included in the release commit) or if they'd rather commit first.
- **Lint/build failure**: stop immediately, show the errors, and help fix them.
- **Publish auth failure**: guide the user to authenticate with `vsce login` or set `VSCE_PAT`.
- **Network failure during publish**: the .vsix is already built locally, so nothing is lost. The user can retry with `npx @vscode/vsce publish --packagePath launchpad-<version>.vsix`.

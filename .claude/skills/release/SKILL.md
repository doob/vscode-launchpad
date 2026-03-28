---
name: release
description: "Package the Launchpad VS Code extension. Use this skill when the user says /release, wants to bump the version, package a .vsix, or prepare a new version of the extension."
---

# Release — Launchpad VS Code Extension

This skill handles versioning, changelog updates, and packaging for the Launchpad extension.

> **Note:** Marketplace publishing is not yet set up. Releases are distributed as `.vsix` files attached to GitHub Releases.

## Usage

```
/release              → interactive: ask what kind of release (patch/minor/major)
/release patch        → bump patch, update changelog, package
/release minor        → bump minor version
/release major        → bump major version
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
test -d node_modules || bun install

# vsce available
bunx @vscode/vsce --version

# Lint passes
bun run lint

# Build succeeds (this also runs via vscode:prepublish)
bun run build
```

If lint or build fails, stop and fix the issues before continuing. Do not skip these checks.

### 2. Determine version bump

Read the current version from `package.json`. If the user specified patch/minor/major, use that. Otherwise, ask them.

- **patch** (0.6.0 → 0.6.1): bug fixes, small tweaks
- **minor** (0.6.0 → 0.7.0): new features, meaningful changes
- **major** (0.6.0 → 1.0.0): breaking changes, major milestones

Bump the version:
```bash
bun version <patch|minor|major> --no-git-tag-version
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

### 7. Summary

Report back:
- Previous version → new version
- Changelog entry (abbreviated)
- .vsix file path and size
- Git tag created
- GitHub release URL
- Whether changes were pushed

## Error Handling

- **Dirty working tree**: warn the user and list the uncommitted changes. Ask if they want to proceed anyway (changes will be included in the release commit) or if they'd rather commit first.
- **Lint/build failure**: stop immediately, show the errors, and help fix them.

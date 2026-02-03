# Observer Vault: Upstream Merge Guide

This document describes Observer Vault's customizations from Signal-Desktop and how to merge upstream releases.

## Quick Start

```bash
# Add upstream remote (one-time setup)
git remote add upstream https://github.com/signalapp/Signal-Desktop.git

# Merge a new release
./scripts/merge-upstream.sh v7.88.0
```

## Observer Vault Customizations

These are the key differences from upstream Signal-Desktop that must be preserved during merges:

### 1. Branding (package.json)

```json
{
  "name": "observer-vault",
  "productName": "Observer Vault",
  "description": "Secure video call recorder for community observers",
  "desktopName": "observervault.desktop",
  "repository": "https://github.com/micahflee/observer-vault.git"
}
```

**Merge strategy:** The script auto-applies branding after accepting upstream version.

### 2. RingRTC Fork

We use `@lockdown-systems/ringrtc` instead of `@signalapp/ringrtc` for audio sink features (call recording).

**Files affected:**

- `package.json` - dependency reference
- `ts/util/callQualitySurvey.dom.ts` - import path
- Any file importing from `@signalapp/ringrtc`

**Merge strategy:** Manual review to ensure our fork is used.

### 3. Disabled Call Quality Survey

The call quality survey is disabled in Observer Vault.

**File:** `ts/util/callQualitySurvey.dom.ts`

```typescript
// Observer Vault: Call quality survey is disabled
export function shouldShowCallQualitySurvey(...): boolean {
  return false;
}
```

**Merge strategy:** Preserve our implementation that always returns `false`.

### 4. Registration Challenge Handler

Custom challenge handler for registration captcha.

**Files:**

- `ts/state/smart/InstallScreen.preload.tsx`
- `ts/observervault/` directory

**Merge strategy:** Keep our custom imports and challenge handler integration.

### 5. 30-Second Disappearing Messages

Additional disappearing message option.

**Merge strategy:** Check if upstream modifies disappearing message options.

## Files That Can Auto-Accept Upstream

These files have no Observer Vault customizations and can always accept upstream:

| Category        | Pattern                          | Reason         |
| --------------- | -------------------------------- | -------------- |
| Locales         | `_locales/*/messages.json`       | Not localized  |
| Generated       | `ACKNOWLEDGMENTS.md`             | Regenerated    |
| Storybook       | `.storybook/**`                  | Not used       |
| Sticker Creator | `sticker-creator/**`             | Not used       |
| Docs            | `CONTRIBUTING.md`, `SECURITY.md` | Not customized |

## Files Deleted from Upstream

These files are automatically deleted during merges:

| File/Directory                     | Reason                            |
| ---------------------------------- | --------------------------------- |
| `.github/ISSUE_TEMPLATE/`          | We don't use Signal's issue forms |
| `.github/PULL_REQUEST_TEMPLATE.md` | We have our own workflow          |
| `.github/dependabot.yml`           | We manage dependencies manually   |

## Workflows Disabled from Upstream

These workflows are renamed to `.disabled` to prevent them from running:

| Workflow                  | Reason                          |
| ------------------------- | ------------------------------- |
| `backport.yml`            | Not used                        |
| `benchmark.yml`           | Not used                        |
| `commits.yml`             | Not used                        |
| `danger.yml`              | Not used                        |
| `icu-book.yml`            | Not used                        |
| `notes.yml`               | Not used                        |
| `release-notes.yml`       | Not used                        |
| `release.yml`             | We have our own release process |
| `reproducible-build*.yml` | Not used                        |
| `stories.yml`             | Not used                        |

**Kept workflows:** `ci.yml` (auto-accept upstream), `linux-release.yml` (our custom workflow)

## Files Requiring Manual Review

Always review these files carefully when they have conflicts:

### Core Customization Files

| File                                       | Customization             |
| ------------------------------------------ | ------------------------- |
| `package.json`                             | Branding, RingRTC fork    |
| `ts/util/callQualitySurvey.dom.ts`         | Disabled survey           |
| `ts/state/smart/InstallScreen.preload.tsx` | Challenge handler         |
| `ts/background.preload.ts`                 | Background customizations |

### Observer Vault Modules (Always Keep Ours)

- `ts/observervault/callRecorder.node.ts`
- `ts/observervault/initializeSettings.preload.ts`
- `ts/observervault/messageHandler.preload.ts`

### Files with RingRTC Imports

These import from `@lockdown-systems/ringrtc` instead of `@signalapp/ringrtc`.
Run `./scripts/audit-customizations.sh` for the current full list.

**Quick fix after merge:** Run `./scripts/fix-ringrtc-imports.sh` to replace any `@signalapp/ringrtc` imports.

## Merge Process

### Automated Steps (handled by script)

1. **Fetch upstream and create merge branch**
2. **Auto-accept locale files** - Accept all `_locales/*/messages.json` from upstream
3. **Auto-accept generated files** - `ACKNOWLEDGMENTS.md`, etc.
4. **Handle package.json** - Accept upstream, reapply branding
5. **Handle lockfile** - Accept upstream (regenerated later)

### Manual Steps (your responsibility)

1. **Review remaining conflicts** - The script will list them
2. **Preserve customizations** - Keep our RingRTC import, disabled survey, etc.
3. **Run pnpm install** - Regenerate lockfile
4. **Run pnpm generate** - Verify build works
5. **Test the application** - Especially call recording features
6. **Commit the merge**

## Common Conflict Patterns

### Pattern 1: Import Changes

Upstream adds new imports to a file we've customized:

```typescript
// CONFLICT: Upstream added 'newImport', we have 'challengeHandler'
// SOLUTION: Keep both imports
import { existingImport, newImport } from 'module';
import { challengeHandler } from '../../observervault/challengeHandler';
```

### Pattern 2: API Changes

Upstream changes function signatures:

```typescript
// CONFLICT: Function signature changed
// SOLUTION: Update to new signature but keep our logic
export function shouldShowCallQualitySurvey(
  newParam: NewType,  // Accept new parameter
  cqsTestMode?: boolean
): boolean {
  return false;  // Keep our disabled implementation
}
```

### Pattern 3: WhatsNew Modal

Upstream adds new version entries:

```typescript
// SOLUTION: Accept upstream's new version entries
// (We don't customize release notes)
```

## Post-Merge Checklist

- [ ] All conflicts resolved
- [ ] `pnpm install` succeeds
- [ ] `pnpm generate` succeeds
- [ ] Application launches
- [ ] Registration flow works
- [ ] Call recording works
- [ ] No TypeScript errors

## Troubleshooting

### JSON Syntax Errors in Locale Files

If you see JSON parse errors after resolving locale conflicts:

```bash
# Reset all locales to upstream
git checkout <upstream-tag> -- _locales/*/messages.json
git add _locales/
```

### Build Errors After Merge

1. Check for missing imports
2. Verify RingRTC import paths
3. Look for API changes that need adaptation

### Lockfile Conflicts

Always regenerate the lockfile:

```bash
git checkout --theirs pnpm-lock.yaml
pnpm install
git add pnpm-lock.yaml
```

## Reducing Future Conflicts

### Keep Customizations Minimal

- Only modify files when necessary
- Add new features in new files when possible
- Use the `ts/observervault/` directory for custom code
- Avoid modifying upstream files if hooks/extensions work

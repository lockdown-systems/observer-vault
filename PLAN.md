<!-- Copyright 2026 Signal Messenger, LLC -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Observer Vault Git History Rewrite Plan

## Overview

This document outlines a plan to rewrite the git history of Observer Vault to make future rebasing onto upstream Signal Desktop easier. The goal is to reorganize the changes into logical, self-contained commits that minimize unnecessary deletions and code changes.

## Current State Analysis

### Commits Since Fork (567ad4da77b763cb8e17076035b823740bac6a39)

The fork currently has **40 commits** with the following categories of changes:

1. **Device Registration** - New phone number registration flow (instead of device linking)
2. **Branding/Renaming** - Signal Desktop → Video Stash → Observer Vault
3. **Disappearing Messages** - Enforce 30-second disappearing messages
4. **Auto-Reply** - Automatic "sorry I'm busy" reply to text messages
5. **Auto-Download Attachments** - Download all attachments to ~/Downloads/ObserverVault
6. **Video/Audio Call Recording** - Record incoming calls using electron-audio-loopback and mediabunny
7. **Call Behavior** - Auto-accept video calls, disable outgoing audio/video, disable quality survey
8. **CI/CD Changes** - Simplified ci.yml, deleted other workflows
9. **Test Deletions** - Deleted tests that failed
10. **Locale Deletions** - Deleted all non-English locales
11. **Misc UI Changes** - Various UI simplifications and lint fixes

### Problems with Current History

1. **Commit d5a13dcd2** ("Rip out device linking...") does too many things:
   - Deletes 67 non-English locale files (512,000+ lines)
   - Deletes 3 test files
   - Adds new device registration components
   - Modifies installer state machine
2. **Workflow deletions** - Other workflows were completely deleted rather than disabled

3. **Auto-update removal** - Auto-update code was removed rather than modified to use a different update server

4. **Test deletions** - Tests were deleted rather than skipped/disabled

## Proposed New Commit Structure

The rewritten history should have the following logical commits, in order:

### Commit 1: Initial Branding Changes

**Purpose**: Rename Signal Desktop to Observer Vault without removing any functionality

- Rename in `package.json` (name, productName, description, desktopName, repository, appId, executableName)
- Rename in `_locales/en/messages.json`
- Rename in `app/startup_config.main.ts`
- Rename in `app/user_config.main.ts`
- Update references in UI components to "Observer Vault"
- Replace logo/icons in `build/icons/`, `images/`
- Update README.md with Observer Vault content
- **DO NOT** delete any locales or other files

### Commit 2: Disable Unused Workflows

**Purpose**: Disable other GitHub workflows without deleting them

- Keep all workflow files but either:
  - Add `if: false` to jobs, OR
  - Comment out the `on:` triggers, OR
  - Rename files to `.yml.disabled`
- Simplify `ci.yml`:
  - Remove tests from CI (comment out test steps)
  - Keep build steps
  - Add copyright notice for Lockdown Systems

### Commit 3: Disable Tests in CI (Without Deleting Test Files)

**Purpose**: Keep all test files but don't run them in CI

- Comment out `pnpm run test-node` and `pnpm run test-electron` steps in ci.yml
- Keep `pnpm run test-release` for release validation
- **DO NOT** delete any test files
- Tests that depend on deleted locales will naturally skip/fail, but that's okay since we're not running them

### Commit 4: Configure Update Server (Without Deleting Auto-Update Code)

**Purpose**: Keep auto-update infrastructure, just point to a different server

- Keep all files in `ts/updater/`
- Modify `config/default.json` to point to Observer Vault update server:
  - `updatesUrl`: Change to Observer Vault update server URL (TBD, or set `updatesEnabled: false` for now)
  - `updatesPublicKey`: Change to Observer Vault's public key (or keep Signal's if we're not doing updates yet)
- Keep the auto-update code in `app/main.main.ts` but configure it appropriately
- If updates aren't ready yet, simply set `updatesEnabled: false` in config

### Commit 5: Switch to Production Signal Servers

**Purpose**: Use production Signal servers instead of staging

- Update `config/default.json`:
  - `serverUrl`: `https://chat.signal.org`
  - `storageUrl`: `https://storage.signal.org`
  - `directoryUrl`: `https://cdsi.signal.org`
  - `cdn`: Production CDN URLs
  - `sfuUrl`: `https://sfu.voip.signal.org/`
  - `challengeUrl`: Production captcha URLs
  - `serverPublicParams`, `backupServerPublicParams`, `serverTrustRoots`, etc.

### Commit 6: Add Device Registration Flow

**Purpose**: Add new phone number registration alongside (not replacing) device linking

- Add new components:
  - `ts/components/installScreen/InstallScreenPhoneNumberStep.dom.tsx`
  - `ts/components/installScreen/InstallScreenVerificationCodeStep.dom.tsx`
  - `ts/components/installScreen/InstallScreenCaptchaStep.dom.tsx`
  - `ts/components/installScreen/InstallScreenCreatingAccountStep.dom.tsx`
- Add new stylesheets:
  - `stylesheets/components/InstallScreenPhoneNumberStep.scss`
  - `stylesheets/components/InstallScreenVerificationCodeStep.scss`
  - `stylesheets/components/InstallScreenCaptchaStep.scss`
  - `stylesheets/components/InstallScreenCreatingAccountStep.scss`
- Modify `ts/state/ducks/installer.preload.ts` to add new registration states and actions
- Modify `ts/types/InstallScreen.std.ts` to add new screen types
- Modify `ts/components/InstallScreen.dom.tsx` to render new screens
- Modify `ts/state/smart/InstallScreen.preload.tsx` to default to phone registration instead of device linking
- Add `libphonenumber-js` dependency for phone number parsing
- Update `stylesheets/manifest.scss` and `stylesheets/_modules.scss`
- Modify `ts/components/installScreen/InstallScreenErrorStep.dom.tsx` for new error handling
- **Key change**: Make the install screen START with phone registration by default, but keep device linking code intact

### Commit 7: Enforce 30-Second Disappearing Messages

**Purpose**: Force all conversations to use 30-second disappearing messages

- Create `ts/observervault/messageHandler.preload.ts` with:
  - `DESIRED_EXPIRE_TIMER = 30 seconds`
  - Logic to set disappearing messages timer on conversations
- Modify `ts/messages/handleDataMessage.preload.ts` to call the message handler
- Modify `ts/background.preload.ts` to enforce timer on startup

### Commit 8: Add Auto-Reply to Messages

**Purpose**: Automatically reply "sorry I'm busy" to incoming messages

- Extend `ts/observervault/messageHandler.preload.ts` with:
  - `AUTO_REPLY_MESSAGE = "sorry I'm busy"`
  - Logic to send auto-reply after receiving a message

### Commit 9: Auto-Download Attachments

**Purpose**: Automatically download all attachments to ~/Downloads/ObserverVault

- Extend `ts/observervault/messageHandler.preload.ts` with:
  - `DOWNLOADS_DIR = ~/Downloads/ObserverVault`
  - Logic to download and save attachments
- Modify `ts/util/queueAttachmentDownloads.preload.ts` to auto-download

### Commit 10: Mark Messages as Read Automatically

**Purpose**: Automatically mark all incoming messages as read

- Modify `ts/state/ducks/conversations.preload.ts` to auto-mark as read

### Commit 11: Disable Call Quality Survey

**Purpose**: Never show the call quality survey

- Modify `ts/util/callQualitySurvey.dom.ts` to always return false/skip survey

### Commit 12: Auto-Accept Incoming Video Calls

**Purpose**: Automatically accept incoming video calls

- Modify `ts/services/calling.preload.ts`:
  - In incoming call handler, auto-accept video calls
  - For audio-only calls, auto-reject with a message

### Commit 13: Disable Outgoing Audio/Video

**Purpose**: Observer Vault doesn't send audio or video, only receives

- Modify `ts/services/calling.preload.ts`:
  - `acceptDirectCall`: Always disable camera and mic
  - `setOutgoingAudio`: Ignore, always muted
  - `setOutgoingVideo`: Ignore, always disabled
- Replace `ts/util/callingPermissions.dom.ts` with `ts/util/callingPermissions.std.ts`
- Replace `ts/util/requestMicrophonePermissions.dom.ts` with `ts/util/requestMicrophonePermissions.std.ts`
- Hide "turn on camera" buttons in UI components

### Commit 14: Add Call Recording Infrastructure

**Purpose**: Record incoming calls to disk

- Add `electron-audio-loopback` and `mediabunny` dependencies
- Add `ts/observervault/callRecorder.node.ts` with:
  - CallRecorder class using VideoSampleSource and MediaStreamAudioTrackSource
  - MP4 output for video calls, M4A for audio-only
  - Save to ~/Downloads/ObserverVault
- Initialize electron-audio-loopback in `app/main.main.ts`

### Commit 15: Wire Up Call Recording

**Purpose**: Connect call recorder to calling service

- Modify `ts/services/calling.preload.ts`:
  - Import and use callRecorder
  - Start recording on call connect
  - Stop recording on call end
  - Handle video frame callbacks for recording
- Show notification after saving recording

### Commit 16: Add Camera Flip and Quality Settings

**Purpose**: UI enhancements for call viewing

- Support flipping camera view
- Higher quality video settings
- Modify calling components as needed

### Commit 17: Screen Recording Permission Prompt (macOS)

**Purpose**: Prompt for screen recording permission on macOS

- Add permission check on app startup
- Show dialog if permission not granted

### Commit 18: UI Cleanup

**Purpose**: Minor UI changes specific to Observer Vault

- Hide "New call" and "Start a call" buttons (since we only receive calls)
- Simplify any other UI elements as needed
- Keep changes minimal and targeted

### Commit 19: Lint Fixes and License Comments

**Purpose**: Fix lint errors and update license headers

- Add lint exceptions to `ts/util/lint/exceptions.json`
- Update license comments to include Lockdown Systems
- Fix any React-useRef or other lint issues

---

## Implementation Steps

### Phase 1: Preparation

1. **Create a new branch** from the original Signal Desktop commit:

   ```bash
   git checkout 567ad4da77b763cb8e17076035b823740bac6a39
   git checkout -b rewrite-history
   ```

2. **Extract the current changes** for reference:

   ```bash
   git diff 567ad4da77b763cb8e17076035b823740bac6a39..main > /tmp/full-diff.patch
   ```

3. **Create working copies** of all new files from main:
   ```bash
   git show main:ts/observervault/messageHandler.preload.ts > /tmp/messageHandler.preload.ts
   git show main:ts/observervault/callRecorder.node.ts > /tmp/callRecorder.node.ts
   # etc. for all new files
   ```

### Phase 2: Apply Commits

Apply each commit according to the structure above. For each commit:

1. Make only the changes described for that commit
2. Test that the app still builds: `pnpm install && pnpm run generate && pnpm run build:esbuild`
3. Commit with a clear, descriptive message

### Phase 3: Verification

1. **Compare final state**: Ensure the final tree matches or exceeds the functionality of the current main branch
2. **Test the application**: Ensure all Observer Vault features work correctly
3. **Verify rebasing**: Test that the new history can be cleanly rebased onto a newer Signal Desktop commit

### Phase 4: Replace History

1. **Force push** the new history (after team coordination):
   ```bash
   git push --force origin rewrite-history:main
   ```

---

## Key Principles for Future Rebasing

1. **Never delete upstream code** - Only add to it or modify it
2. **Keep modifications minimal** - Change the smallest amount necessary
3. **Use configuration over code deletion** - Disable features via config when possible
4. **Keep all locales** - Even if we only use English, keep them for upstream compatibility
5. **Keep all tests** - Skip/disable them in CI rather than deleting
6. **Keep all workflows** - Disable rather than delete
7. **Isolate Observer Vault code** - Keep custom code in `ts/observervault/` directory
8. **Document changes** - Each commit should have a clear purpose

---

## Files to Keep That Were Previously Deleted

| File                                                | Reason to Keep                                         |
| --------------------------------------------------- | ------------------------------------------------------ |
| `_locales/*/messages.json` (all non-English)        | Upstream compatibility, avoid massive rebase conflicts |
| `.github/workflows/*.yml` (all except ci.yml)       | Disable instead of delete                              |
| `ts/test-node/app/locale_test.main.ts`              | Keep but skip in CI                                    |
| `ts/test-node/app/menu_test.node.ts`                | Keep but skip in CI                                    |
| `ts/test-node/util/expirationTimer_test.preload.ts` | Keep but don't delete the test for other locales       |
| `ts/util/callingPermissions.dom.ts`                 | Keep but import the std version in our code            |
| `ts/util/requestMicrophonePermissions.dom.ts`       | Keep but import the std version in our code            |

---

## New Files to Add

| File                                                                    | Purpose                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `ts/observervault/messageHandler.preload.ts`                            | Auto-reply, disappearing messages, attachment download |
| `ts/observervault/callRecorder.node.ts`                                 | Video/audio call recording                             |
| `ts/util/callingPermissions.std.ts`                                     | Permissions stub (always granted)                      |
| `ts/util/requestMicrophonePermissions.std.ts`                           | Permissions stub (always granted)                      |
| `ts/components/installScreen/InstallScreenPhoneNumberStep.dom.tsx`      | Phone registration UI                                  |
| `ts/components/installScreen/InstallScreenVerificationCodeStep.dom.tsx` | Verification code UI                                   |
| `ts/components/installScreen/InstallScreenCaptchaStep.dom.tsx`          | Captcha UI                                             |
| `ts/components/installScreen/InstallScreenCreatingAccountStep.dom.tsx`  | Account creation UI                                    |
| `stylesheets/components/InstallScreen*.scss`                            | Corresponding stylesheets                              |

---

## Dependencies to Add

| Package                   | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `electron-audio-loopback` | Capture system audio during calls             |
| `mediabunny`              | Encode audio/video to MP4/M4A                 |
| `libphonenumber-js`       | Parse/validate phone numbers for registration |

---

## Estimated Timeline

- **Phase 1 (Preparation)**: 1-2 hours
- **Phase 2 (Apply Commits)**: 4-8 hours
- **Phase 3 (Verification)**: 2-4 hours
- **Phase 4 (Replace History)**: 30 minutes

**Total: 1-2 days of focused work**

---

## Risks and Mitigations

| Risk                             | Mitigation                                             |
| -------------------------------- | ------------------------------------------------------ |
| Missing functionality in rewrite | Compare file-by-file diff before finalizing            |
| Breaking upstream compatibility  | Test rebase onto latest Signal Desktop                 |
| Team disruption from force push  | Coordinate with team, ensure everyone is on new branch |
| Introducing bugs                 | Full manual testing of all Observer Vault features     |

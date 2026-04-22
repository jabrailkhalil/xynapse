# Xynapse IDE - Project Context

Updated: 2026-04-22
Branch: `codex/xynapse-portable-profile`

## 1) Project scope

Xynapse IDE is a custom VS Code distribution with:
- Xynapse Assistant extension and custom UI behavior.
- Windows update flow via GitHub Releases.
- Local profile/account layer with encrypted import/export.
- Portable build pipeline for test/release artifacts.

Main folders:
- Core app: `vscode/`
- Assistant extension (built output): `vscode/extensions/xynapse-assistant/`
- Assistant source currently used for logic changes: `plugins/continue-main/extensions/vscode/`
- Portable packaging script: `portable-build.bat`

Public site:
- `https://xynapse.online`

## 2) Current architecture map

### Assistant panel and commands
- Container is registered in secondary sidebar:
  - `vscode/extensions/xynapse-assistant/package.json`
  - `viewsContainers.secondarySidebar`
- Main webview id:
  - `xynapse.xynapseGUIView`
- Provider registration:
  - `plugins/continue-main/extensions/vscode/src/extension/VsCodeExtension.ts`
- Webview implementation:
  - `plugins/continue-main/extensions/vscode/src/XynapseGUIWebviewViewProvider.ts`
- Command flow (focus/open/new window):
  - `plugins/continue-main/extensions/vscode/src/commands.ts`

### Startup and walkthrough
- Startup page logic:
  - `vscode/src/vs/workbench/contrib/welcomeGettingStarted/browser/startupPage.ts`
- Walkthrough contribution:
  - `vscode/extensions/xynapse-assistant/package.json` -> `walkthroughs`
- Known risk area:
  - duplicate onboarding tabs when startup/restore logic overlap.

### Profile/account and key payload
- Service contracts:
  - `vscode/src/vs/workbench/services/xynapseProfile/common/xynapseProfile.ts`
- Storage paths:
  - `vscode/src/vs/workbench/services/xynapseProfile/common/xynapseProfilePaths.ts`
- Service implementation:
  - `vscode/src/vs/workbench/services/xynapseProfile/common/xynapseProfileService.ts`
- Contribution/UI commands:
  - `vscode/src/vs/workbench/contrib/xynapseProfile/browser/xynapseProfile.contribution.ts`
- Encrypted bundle:
  - `vscode/src/vs/workbench/contrib/xynapseProfile/common/xynapseConfigCrypto.ts`

### GitHub update channel
- Product repo mapping:
  - `vscode/product.json` -> `githubUpdate.owner/repo`
- Update fetch/select:
  - `vscode/src/vs/platform/update/electron-main/githubUpdate.ts`
  - `vscode/src/vs/platform/update/electron-main/updateService.win32.ts`

### Portable build
- Script:
  - `portable-build.bat`
- Output:
  - `portable-build/xynapse-portable/`
- Entry executable:
  - `portable-build/xynapse-portable/Xynapse.exe`

## 3) Task tracker

### Completed
- README includes clickable site link: `https://xynapse.online`.
- README has update flow section for GitHub Releases.
- README describes profile/account (`profile.json`, `account.json`) and encrypted backup behavior.
- Portable build script and basic usage docs are present.
- Profile service supports fallback local profile creation when profile/account is missing.
- `openInNewWindow` no longer force-closes the auxiliary (right) sidebar.
- Startup walkthrough logic updated to avoid opening duplicate onboarding tabs.
- Extension startup now auto-focuses `xynapse.xynapseGUIView` to keep assistant visible by default.
- Rebuild completed:
  - `plugins/continue-main/extensions/vscode/out/extension.js`
  - `vscode/extensions/xynapse-assistant/out/extension.js`
  - `vscode/out/...` via `transpile-client-esbuild`

### In progress / unstable
- Validate assistant persistence in secondary sidebar after repeated restarts.
- Validate no duplicate onboarding tabs after clean first-run state reset.
- First-run UX consistency: exactly one onboarding flow.

### Pending
- Finalize profile migration UX so user can move account/keys between machines with minimal manual steps.
- Full release readiness pass: clean build, smoke test, packaging verification.

## 4) Known issues and root-cause hints

- If app opens with gray screen + MIME errors, runtime bundle is likely invalid/incomplete.
- Error `exports is not defined in ES module scope` indicates CommonJS/ESM mismatch in built `out/main.js` chain, often from broken build artifacts or wrong packaging state.
- Assistant "disappears" after some commands because full-screen/new-window actions can move focus/state away from the sidebar container.
- Duplicate onboarding usually comes from interaction between startup opening logic and restored walkthrough state.

## 5) Account portability guide (for bot/user handoff)

Goal: move all model keys and profile metadata to another machine.

Primary payload:
- `profile.json` (identity/configured flag)
- `account.json` (identity + keys payload)
- `config.yaml`, `config.json` (provider keys/config)

Recommended flow:
1. Export encrypted backup (`.enc`) via Xynapse profile command.
2. Transfer `.enc` file (local copy or Git-based secure flow).
3. Import `.enc` on target machine.
4. Verify account is marked configured and models are available.

Fallback behavior:
- If no profile/account exists, app creates local profile and notifies user.
- Without account payload, key-dependent models are unavailable by design.

## 6) Release gate checklist

- App starts without gray screen or main-process exceptions.
- Assistant is visible in the expected sidebar container after restart.
- Exactly one onboarding tab appears on first run.
- `Help -> Check for Updates` detects newer GitHub release correctly.
- Portable artifact launches from `Xynapse.exe` and keeps data under `data/`.
- Profile export/import recovers model keys on a clean machine.

## 7) Operating notes for next bot

- Treat current workspace as dirty; do not revert unrelated files.
- Before touching onboarding/sidebar behavior, inspect both:
  - `plugins/continue-main/extensions/vscode/src/*`
  - `vscode/src/vs/workbench/contrib/welcomeGettingStarted/*`
- For any release candidate, run a clean portable build and smoke test from the built executable, not from source tree scripts alone.

# Xynapse IDE - Project Context

Updated: 2026-04-27
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

### Council and BVC
- `/council` is free-form multi-agent planning:
  - default roles: PM, Architect, Developer, Reviewer
  - fixed critique rounds by difficulty: easy 0, medium 1, hard 2
  - output files: `council-plan.md`, `council-discussion.md`
- `/bvc` is the formal diploma algorithm:
  - default roles: Architect, Developer, Reviewer, Tester
  - fixed axes: `root_cause_location`, `fix_strategy`, `dependencies_to_update`, `test_coverage`
  - metrics: `D_vote`, `D_cov`, `T_ge2`
  - output files: `bvc-plan.md`, `bvc-discussion.md`
- Registration path:
  - `plugins/continue-main/core/commands/slash/built-in-legacy/council.ts`
  - `plugins/continue-main/core/commands/slash/built-in-legacy/index.ts`
  - YAML declares both commands in `vscode/extensions/xynapse-assistant/xynapse-config.yaml`

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
- Council/BVC are now tracked as separate intended modes:
  - Council free-form planning
  - BVC formal budgeted verified algorithm
- Assistant first-run account UX now offers two explicit paths before manual key entry:
  - Import encrypted `.enc` Xynapse profile/account backup.
  - Connect API keys manually provider by provider.
- The account-choice UI source text is English; non-English UI is applied by runtime translation:
  - `Port your Xynapse account`
  - `Import encrypted profile`
  - `Connect API keys manually`
- Webview import button sends `xynapse/importProfile`, handled by the VS Code extension through existing `xynapse.config.import`.
- Fresh encrypted profile export for manual testing was generated:
  - `C:\Users\Home-PC\Desktop\xynapse-profile-export\xynapse-account-portable-20260425T111005Z.enc`
  - Password is stored locally in the sibling `.password.txt` file; do not print it in chat/logs.
- Import password handling is tolerant:
  - the `.enc` format is `XYNCFG1` + PBKDF2-SHA256 + AES-256-GCM
  - import tries the raw password input, trimmed input, and the last non-empty line
  - this intentionally supports users pasting the whole generated `.password.txt` helper file instead of only the final password line
  - verified valid payload includes `version=1`, `profile.json`, `account.json`, `config.yaml`, `.xynapserc.json`, and `config.ts`
- Profile path fix:
  - `getXynapseDataDir()` now honors `XYNAPSE_GLOBAL_DIR` before `VSCODE_PORTABLE`/user home
  - this keeps profile import/export aligned with the assistant config path in clean/test launches
- Current main machine profile was materialized from the encrypted export into `C:\Users\Home-PC\.xynapse`:
  - backup: `C:\Users\Home-PC\Desktop\xynapse-profile-export\profile-materialize-backups\.xynapse-before-materialize-20260425T145604Z`
  - verified `profile.json`, `account.json`, and `config.yaml` exist
  - verified `config.yaml` has 22 model entries without printing secret values
- Checksum format note:
  - runtime `product.json` checksums must be unpadded base64
  - current/portable/source checksum verification passes after normalizing entries
- Duplicate `xynapse-assistant/rules.md` warning is mitigated in config load:
  - rules are deduplicated by `rule.name` in `plugins/continue-main/core/config/profile/doLoadConfig.ts`
  - this handles source/runtime/portable extension copies being visible inside the `IDE` workspace.
- Bottom status-bar language item is now `Xynapse Language`, not full IDE display language:
  - `xynapse.ideLanguage` and `xynapse.assistantLanguage` are compatibility aliases for the same selector.
  - Source of truth is `.xynapse/config.yaml` `responseLanguage`.
  - It no longer reads/writes active user-data `User/argv.json`; that was the wrong file for this fork.
  - Real Workbench display language is a separate VS Code NLS/language-pack layer using `%USERPROFILE%\.xynapse\argv.json` or `%VSCODE_PORTABLE%\argv.json`.
  - Full Workbench translation must not be promised unless bundled language packs/NLS artifacts exist.
  - Window reload applies the Xynapse panel/response language.
- Assistant onboarding localization:
  - The import-account/manual-key cards now have GUI-side RU/JA translations.
  - The webview DOM translator now normalizes whitespace before exact dictionary lookup, so multiline text nodes are less fragile.
- Current runtime was launched for testing from `VSCode-win32-x64\Xynapse.exe` with isolated no-account dirs:
  - Latest normal launch after profile/checksum fix: `C:\Users\Home-PC\Desktop\IDE\VSCode-win32-x64\Xynapse.exe`
  - Latest import-fix isolated run: `C:\Users\Home-PC\Desktop\IDE\.tmp-xynapse-import-fixed-20260425-173759\`
  - Previous language/theme run: `C:\Users\Home-PC\Desktop\IDE\.tmp-xynapse-clean-lang-theme-20260425-164236\`
- Theme fallback fix:
  - clean first-run settings may still contain VS Code's internal `__vs-dark`
  - workbench initialization now normalizes `__vs-dark` to `Default Dark+`
  - current and portable `product.json` checksums were updated and verified after the runtime bundle patch.
- Profile import runtime fix:
  - Do not use VS Code `ServicesAccessor` after any `await` inside `Action2.run()`.
  - `xynapse.config.import/export/push/pull/importFromGitSync` now capture required services and `dataDir` synchronously, then pass plain services/data into async helpers.
  - Current runtime, portable runtime, and `vscode/out-vscode` workbench bundles were patched from the transpiled source module.
  - Latest clean no-key manual import run: `C:\Users\Home-PC\Desktop\IDE\.tmp-xynapse-port-test-20260425-193650\`.
  - This run starts responsive, has no `profile.json/account.json`, no likely secrets in default key files, and no `corrupt/sqlite3/Illegal state` log hits before import.

### In progress / unstable
- Validate assistant persistence in secondary sidebar after repeated restarts.
- Validate no duplicate onboarding tabs after clean first-run state reset.
- First-run UX consistency: exactly one onboarding flow.
- Validate the new import-account choice visually in the running runtime and verify that choosing the `.enc` file restores models after restart.
- Manually click the bottom globe item and verify `RU/JA/EN` reload changes the Xynapse assistant panel language.
- If full Workbench language switching is required, implement/bundle proper VS Code language packs instead of patching webview strings.

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

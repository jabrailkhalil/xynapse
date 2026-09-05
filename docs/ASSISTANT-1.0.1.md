# Xynapse Assistant 1.0.1 — Windows x64

This release updates the standalone Assistant from public 1.0.0 to 1.0.1 and includes BVC SDK 0.1.1. Earlier local audit labels 1.0.2–1.0.4 were unpublished iterations; they are consolidated here. Local rebuilds preserve the release version.

## Changes

- Improved Yandex Cloud onboarding, model URI and secret-reference resolution, and provider error redaction.
- Native reasoning history is replayed after tool calls, including DeepSeek-compatible endpoints routed through Yandex Cloud. Raw reasoning is excluded from visible conversation events and human-readable exports.
- BVC 0.1.1 strengthens completion validation and error handling. Cancellation, truncated output, refusals and unconfirmed completion are not accepted as final plans.
- Updated production JavaScript and Rust dependencies, deferred the ESM crawler dependency until it is used, enabled effective extension minification, and included the full Continue Apache-2.0 and runtime MIT licenses.
- Repaired shared-environment runtime test isolation, E2E fixture paths and frame handling. Related source fixes address IDE settings ordering and disabled update checks.

## Install

Use **Extensions → Install from VSIX**, select `xynapse-assistant-1.0.1-win32-x64.vsix`, then reload the editor. Target: Windows x64, VS Code API 1.108 or newer. Configure your own provider and credentials before use. The separate SDK archive is `xynapse-bvc-0.1.1.tgz`.

The existing Xynapse IDE 1.108.0 installer and portable archive still include Assistant 1.0.0. Install this VSIX to update the extension. This release does not replace those IDE binaries. Users of unpublished local 1.0.2–1.0.4 builds must explicitly install the 1.0.1 VSIX because its version is lower.

## Verification

The release reuses the qualified functional payload from the local audit. Final version metadata, VSIX CRC, runtime/GUI payload parity and release secret scans are checked separately. Test counts below are suite counts, not a count of unique cases across all environments.

| Suite | Passed | Notes |
| --- | ---: | --- |
| Assistant core Vitest | 1,752 | 16 skipped, 1 todo |
| Assistant core Jest | 767 | 114 skipped |
| Assistant GUI | 424 | Includes two installed-package Tiptap security regressions |
| Extension unit tests | 121 | |
| BVC SDK | 44 | |
| Fetch / terminal security / adapters / YAML configuration | 683 | 99 / 224 / 73 / 287; one YAML test skipped |
| Native runtime workspace | 1,090 | One ignored; final dependency update passed with one test thread |

Core, GUI, extension and IDE type checks passed. Native release compilation, extension bundling and packaging passed. Isolated native host checks in VS Code 1.108.0 exercised activation, resolved model configuration, a real runtime process, file-tool execution and reasoning/tool-result continuation against a synthetic local provider. They do not establish paid-model quality or service availability.

## Known limits

- Full Selenium GUI qualification is incomplete. Autocomplete and edit accept/reject passed; a later setup lost the browser session. The final helper correction compiled, but the full GUI suite was not repeated.
- One parallel native test run crashed in the tools test executable; the complete serial workspace run passed. Parallel test stability is not established.
- Production npm audits reported zero vulnerabilities for core, extension, IDE and SDK. GUI still has 28 moderate advisory entries in the Tiptap chain: installed 2.27.3 contains the upstream mitigation, with two passing regression tests. RustSec reports zero vulnerabilities after updates; unmaintained bincode/yaml-rust advisories remain.
- Windows executables are unsigned. Linux/macOS, remote workspaces and other editor forks require separate qualification.
- BVC returns a plan with `verification: "not_run"`. Model agreement does not prove correctness, and a model-call limit is not a monetary spending cap. No model-independent advantage over single-model planning is claimed.

Source and notices are included in the release tag. Native source manifests retain their historical import hashes; Git records subsequent changes. To package the IDE from this source, supply the release VSIX through `XYNAPSE_ASSISTANT_VSIX`; `vscode/build/xynapse-assistant.json` pins its SHA-256. Personal profiles and credentials are excluded from release inputs.

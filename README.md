<div align="center">
  <img src="./Pics/logo.png" alt="Xynapse IDE" width="320">

# Xynapse IDE

**A complete Windows IDE with an AI coding system built into the workbench.**

[![Release](https://img.shields.io/github/v/release/jabrailkhalil/xynapse?display_name=tag)](https://github.com/jabrailkhalil/xynapse/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows)](https://github.com/jabrailkhalil/xynapse/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Download](https://github.com/jabrailkhalil/xynapse/releases/latest) · [Website](https://xynapse.online) · [English](./README.en.md) · [Русский](./README.ru.md)
</div>

Xynapse combines the Code - OSS 1.108.0 editor, terminal, Git workflow, extensions, and a built-in AI assistant in one desktop application. The assistant can explain a codebase, make scoped edits, run tools, plan before changing files, and execute multi-step development tasks without switching to a separate chat window.

![Xynapse Assistant](./Pics/Assistants.png)

## What makes it useful

- **One workbench, four levels of autonomy.** Chat answers questions; Plan inspects the workspace with read-only permissions; Agent works inside the workspace; Full mode is an explicit elevated mode for tasks that require unrestricted local actions.
- **Project-aware coding.** Files, folders, diffs, terminal output, diagnostics, selected code, and indexed codebase context can be attached to a request.
- **Editing that stays reviewable.** Inline Edit and agent tool calls produce concrete file changes that remain visible in the editor and source-control diff.
- **Autocomplete and next-edit workflows.** A separate autocomplete role can use a faster model without forcing the chat model to handle every keystroke.
- **Tool calling and MCP.** Compatible models can call workspace tools and configured MCP servers; parallel tool-call streaming is covered by regression tests.
- **Council and BVC planning.** Council provides a practical multi-role discussion. BVC adds a structured, budget-aware verification stage intended for tasks where planning before implementation is valuable.
- **Local credentials.** API keys are entered locally or supplied through environment variables. Profile metadata never duplicates their contents; encrypted backups use AES-256-GCM with a password-derived key.
- **Telemetry off by default.** Xynapse disables the assistant telemetry path in this distribution.

## Verified Yandex Cloud model catalog

The bundled onboarding catalog contains ten Yandex model identifiers checked on August 16, 2026:

| Role | Models |
|---|---|
| Chat / Edit | `yandexgpt-5-pro`, `yandexgpt-5.1`, `deepseek-v4-flash`, `qwen3.6-35b-a3b` |
| Chat | `aliceai-llm`, `aliceai-llm-flash`, `qwen3-235b-a22b-fp8`, `gpt-oss-120b` |
| Autocomplete | `yandexgpt-5-lite`, `gpt-oss-20b` |

All ten identifiers passed live non-streaming compatibility checks with Yandex Cloud on August 16, 2026. Tool calling was also exercised against the live provider, and streaming was checked with a reasoning-capable Qwen model. API access, quotas, and model availability remain controlled by the user's Yandex Cloud account.

## Modes and permissions

| Mode | Intended use | Runtime permission profile |
|---|---|---|
| Chat | Explain, review, ask questions | No workspace tool execution |
| Plan | Inspect and prepare an implementation plan | `read-only` |
| Agent | Implement ordinary repository tasks | `workspace-write` |
| Full | Explicitly authorized system-level work | `danger-full-access` |

The permission mapping is asserted in GUI regression tests. Full mode should be selected only for a task that genuinely needs elevated access.

## Install

1. Open the [latest GitHub release](https://github.com/jabrailkhalil/xynapse/releases/latest).
2. Choose the Windows x64 installer or the portable ZIP.
3. Start Xynapse and open a project folder.
4. In onboarding, enter a Yandex API key and folder ID, then select a model.

For environment-based configuration, set `YANDEX_API_KEY` and `YANDEX_FOLDER_ID`. The example configuration at [`vscode/extensions/xynapse-assistant/xynapse-config.yaml`](./vscode/extensions/xynapse-assistant/xynapse-config.yaml) contains placeholders only.

## Release verification

This release is not based on a single smoke test. The verification matrix includes:

- core Vitest and Jest suites for the assistant;
- GUI and VS Code extension regression suites;
- configuration, transport, provider-adapter, and terminal-security packages;
- Code - OSS compile, type/layer/lint checks, and native Node tests;
- production builds of the assistant core, GUI, extension, and Windows x64 application;
- isolated-profile application launch and packaged-extension parity checks;
- secret scanning, dependency audit review, SHA-256 generation, release download, and checksum re-verification.

<!-- RELEASE_RESULTS_START -->
Recorded results: 6,175 Code OSS Node tests and 13,697 production Chromium tests passed. The additional Firefox suite has three recorded failures; WebKit is not claimed as complete. Installation, isolated-profile startup, and uninstall were checked on September 5. See [`RELEASE-VERIFICATION.md`](./RELEASE-VERIFICATION.md) for dates, scope, and limitations.
<!-- RELEASE_RESULTS_END -->

The old synthetic `TEST-REPORT-500.md` has been replaced because its manually assigned cases were not an honest substitute for executable test output.

## Build from source

Requirements: Windows x64, Git with Git LFS, Node.js 22.21.1, Python 3, and Visual Studio 2022 Build Tools with the C++ workload. Regenerating the bundled command-line runtime additionally requires Rust; the release was verified with Rust 1.95.0.

```powershell
git lfs pull
cd vscode
npm ci
npm run gulp compile-build-without-mangling
npm run gulp vscode-win32-x64
```

The root `.gitignore` intentionally keeps the Code - OSS build sources, safe `.npmrc` runtime-target files, and the assistant source tree. Generated `node_modules`, `out`, packaged application, and portable output remain ignored.

## Research

Xynapse includes the implementation used to study budget-aware verification before coding. The repository contains a 60-task evaluation and three LaTeX articles, each citing the author's diploma:

- [Adaptive budget allocation in BVC](./research/bvc-evaluation/main60/articles/latex/01_adaptive_budget_bvc.tex)
- [Reproducible evaluation of BVC](./research/bvc-evaluation/main60/articles/latex/02_reproducible_evaluation_bvc.tex)
- [Upfront BVC for programming and vibe coding](./research/bvc-evaluation/main60/articles/latex/03_upfront_bvc_vibecoding.tex)

The papers distinguish measured results from interpretation; this README does not turn partial quality effects into broader claims.

![Xynapse Council](./Pics/Council.png)

## Project and licensing

Xynapse is maintained by **Dzhabrail Khalilov**. Issues and reproducible bug reports are welcome in the [GitHub tracker](https://github.com/jabrailkhalil/xynapse/issues).

Xynapse-specific code is released under the [MIT License](./LICENSE). The distribution is based on Microsoft Code - OSS (MIT) and includes a modified Continue-derived assistant (Apache License 2.0). Component licenses and third-party notices are preserved; see [`NOTICE`](./NOTICE), [`vscode/LICENSE.txt`](./vscode/LICENSE.txt), [`vscode/ThirdPartyNotices.txt`](./vscode/ThirdPartyNotices.txt), and [`plugins/continue-main/LICENSE`](./plugins/continue-main/LICENSE).

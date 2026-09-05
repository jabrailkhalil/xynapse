<div align="center">
  <img src="./Pics/logo.png" alt="Xynapse IDE" width="320">

# Xynapse IDE

**A Windows IDE with a project-aware AI coding system built into the workbench.**

[![Release](https://img.shields.io/github/v/release/jabrailkhalil/xynapse?display_name=tag)](https://github.com/jabrailkhalil/xynapse/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows)](https://github.com/jabrailkhalil/xynapse/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Download](https://github.com/jabrailkhalil/xynapse/releases/latest) · [Website](https://xynapse.online) · [Русский](./README.ru.md)
</div>

Xynapse combines Code - OSS 1.108.0, terminal, Git, extensions, and a built-in
AI assistant in one desktop application. It can explain a repository, prepare a
read-only plan, make reviewable changes, call compatible tools, and complete
multi-step development tasks without a separate chat window.

![Xynapse Assistant](./Pics/Assistants.png)

## Why Xynapse

- **Four explicit autonomy levels.** Chat answers without workspace tools;
  Plan inspects read-only; Agent edits inside the workspace; Full is an
  explicitly selected unrestricted local mode.
- **Repository context.** Attach files, folders, diffs, diagnostics, selected
  code, terminal output, and indexed codebase context.
- **Reviewable implementation.** Inline Edit and agent actions result in real
  changes visible in the editor and Source Control diff.
- **Separate autocomplete role.** Use a fast model for inline completion and a
  stronger model for chat and editing.
- **Tools and MCP.** Compatible models can invoke workspace tools and configured
  MCP servers.
- **Council/BVC workflow.** Multiple roles analyze a task and critique a plan;
  the budget-aware stage is intended for tasks where verification before coding
  is worth its cost.
- **Local configuration.** Credentials stay in their local config files and are
  not duplicated in profile metadata. Password-protected backups use
  AES-256-GCM. Telemetry is disabled by default in this distribution.

## Yandex AI Studio catalog

The onboarding template contains ten current model identifiers:

| Role | Models |
|---|---|
| Chat / Edit | `yandexgpt-5-pro`, `yandexgpt-5.1`, `deepseek-v4-flash`, `qwen3.6-35b-a3b` |
| Chat | `aliceai-llm`, `aliceai-llm-flash`, `qwen3-235b-a22b-fp8`, `gpt-oss-120b` |
| Autocomplete | `yandexgpt-5-lite`, `gpt-oss-20b` |

All ten identifiers completed a live non-streaming compatibility request during
release validation. Tool calling and streaming were also exercised. Availability,
quota, and billing remain controlled by the user's Yandex Cloud account.

## Runtime permissions

| Mode | Intended use | Permission profile |
|---|---|---|
| Chat | Questions, explanations, review | No workspace tool execution |
| Plan | Inspect and prepare a plan | `read-only` |
| Agent | Ordinary repository implementation | `workspace-write` |
| Full | Explicitly authorized system-level work | `danger-full-access` |

This mapping is asserted by GUI regression tests. Use Full only when a task
genuinely needs elevated local access.

## Install

1. Open the [latest release](https://github.com/jabrailkhalil/xynapse/releases/latest).
2. Download the Windows x64 installer or portable ZIP.
3. Start Xynapse and open a project.
4. Enter a Yandex API key and folder ID during onboarding, then select a model.

Environment-based setup supports `YANDEX_API_KEY` and `YANDEX_FOLDER_ID`. The
bundled [`xynapse-config.yaml`](./vscode/extensions/xynapse-assistant/xynapse-config.yaml)
contains placeholders only.

## Verification and source builds

The release candidate is checked with assistant Vitest/Jest suites, GUI and
extension regression tests, configuration and transport packages, Code OSS
compile/type/layer/lint checks, Windows packaging, isolated-profile launch,
credential scanning, and checksum verification after downloading the published
assets again. Exact commands and observed counts are in
[`RELEASE-VERIFICATION.md`](./RELEASE-VERIFICATION.md).

Build requirements: Windows x64, Git LFS, Node.js 22.21.1, Python 3, and Visual
Studio 2022 Build Tools with the C++ workload. Regenerating the bundled CLI
runtime also requires Rust; the release was verified with Rust 1.95.0.

```powershell
git lfs pull
cd vscode
npm ci --legacy-peer-deps
npm run gulp compile-build-without-mangling
npm run gulp vscode-win32-x64
```

## Research

The repository includes a 60-task Council/BVC evaluation and three LaTeX
articles. Each article cites Dzhabrail Khalilov's diploma:

- [Adaptive budget allocation in BVC](./research/bvc-evaluation/main60/articles/latex/01_adaptive_budget_bvc.tex)
- [Reproducible evaluation of BVC](./research/bvc-evaluation/main60/articles/latex/02_reproducible_evaluation_bvc.tex)
- [Upfront BVC for programming and vibe coding](./research/bvc-evaluation/main60/articles/latex/03_upfront_bvc_vibecoding.tex)

The measured effects apply to the evaluated sample; they are not presented as a
universal guarantee for every task or model.

![Xynapse Council](./Pics/Council.png)

## Author and licenses

Xynapse is maintained by **Dzhabrail Khalilov**, HSE University, Moscow.
Reproducible bug reports are welcome in the
[issue tracker](https://github.com/jabrailkhalil/xynapse/issues).

Xynapse-specific code is MIT-licensed. The distribution contains modified
Code - OSS (MIT), a Continue-derived assistant (Apache-2.0), and a modified
Claw Code Rust runtime (MIT). See
[`NOTICE`](./NOTICE) and the component license files for full attribution.

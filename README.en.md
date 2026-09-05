<div align="center">

<img src="./Pics/logo.png" alt="Xynapse logo" width="120">

# Xynapse

**Your editor, terminal, Git, and AI assistant — in one workspace.**

A Windows IDE built on Code - OSS, with Xynapse Assistant and BVC planning included.

[![IDE 1.108.0](https://img.shields.io/badge/IDE-1.108.0-6366f1?style=flat-square)](https://github.com/jabrailkhalil/xynapse/releases/tag/v1.108.0)
[![Assistant 1.0.1](https://img.shields.io/badge/Assistant-1.0.1-8b5cf6?style=flat-square)](https://github.com/jabrailkhalil/xynapse/releases/tag/assistant-v1.0.1-bvc.0.1.1)
[![BVC 0.1.1](https://img.shields.io/badge/BVC-0.1.1-0891b2?style=flat-square)](./plugins/continue-main/packages/bvc/README.md)
[![Windows x64](https://img.shields.io/badge/Windows-x64-0078d4?style=flat-square)](#download)

[Download](#download) · [Quick start](#quick-start) · [BVC planning](#bvc-planning) · [Русский](./README.ru.md)

</div>

## Download

Two releases, one project. Choose the complete IDE or add the assistant to a compatible VS Code editor.

| Package | Includes | Download · Windows x64 |
| --- | --- | --- |
| **Xynapse IDE 1.108.0** | Editor + Assistant 1.0.0 + BVC 0.1.0 | [Installer](https://github.com/jabrailkhalil/xynapse/releases/download/v1.108.0/XynapseSetup-x64-1.108.0.exe) · [Portable ZIP](https://github.com/jabrailkhalil/xynapse/releases/download/v1.108.0/Xynapse-portable-win32-x64-1.108.0.zip) |
| **Xynapse Assistant 1.0.1** | Standalone extension + BVC 0.1.1 | [VSIX](https://github.com/jabrailkhalil/xynapse/releases/download/assistant-v1.0.1-bvc.0.1.1/xynapse-assistant-1.0.1-win32-x64.vsix) |

The IDE 1.108.0 installer still includes Assistant 1.0.0; install the new VSIX to update it to 1.0.1. See [release verification and known limits](./docs/ASSISTANT-1.0.1.md). Each release provides `SHA256SUMS.txt`; Windows executables are currently unsigned.

## Quick start

### Complete IDE

1. Run the installer, or extract the portable ZIP into a new folder and launch `Xynapse.exe`.
2. Open your project folder.
3. Configure a model in Assistant. For Yandex Cloud onboarding, enter your API key and folder ID, then select a model.
4. Attach a file or select code, choose a mode, and describe your task.

### Standalone extension

1. Download the VSIX from the table above.
2. In your editor, open **Extensions → Install from VSIX…**, select the file, and reload the window.
3. Open Xynapse Assistant and configure your model provider.

Yandex configuration also supports `YANDEX_API_KEY` and `YANDEX_FOLDER_ID`. See the bundled [configuration template](./vscode/extensions/xynapse-assistant/xynapse-config.yaml). Model usage is billed by your selected provider.

## Work with your code

- **Bring project context.** Attach files, folders, diffs, diagnostics, selected code, and terminal output; use indexed codebase search for wider context.
- **Review changes in the editor.** Ask for an inline edit or let the agent make changes you can inspect in Source Control.
- **Choose models by role.** Configure chat, editing, and autocomplete independently.
- **Connect tools.** Use workspace tools and configured MCP servers with compatible models.
- **Plan with several perspectives.** Council and BVC collect proposals and critiques before implementation.

| Mode | What it does | Workspace access |
| --- | --- | --- |
| **Chat** | Explain code, answer questions, review attached context | No workspace tools |
| **Plan** | Inspect the project and prepare a plan | Read only |
| **Agent** | Implement tasks within the project | Read and write |
| **Full** | Perform explicitly authorized system tasks | Unrestricted local access |

## BVC planning

BVC 0.1.0 coordinates independent proposals, targeted critique, and a final plan within a model-call budget. Attach relevant files or select code, then try:

```text
/bvc easy Fix the parser regression
/bvc medium Plan the authentication refactor
/bvc hard Compare migration approaches across services
```

The result is saved to `bvc-plan.md`. Optional discussion logging adds `bvc-discussion.md` with proposals, objections, and a call trace. You can also choose roles, models, and a budget through the BVC button.

The plan still needs implementation and tests. Read the [Assistant guide](./plugins/continue-main/extensions/vscode/README.md) or explore the [standalone BVC core](./plugins/continue-main/packages/bvc/README.md).

## Release checks

The September 5, 2026 build passed installation, isolated-profile startup, extension activation, and uninstall checks. All **405 extension files** match the pinned VSIX in the installed IDE and portable archive. TypeScript, targeted ESLint, and **131 build tests** passed; all **8 published assets** were downloaded again and their SHA-256 hashes matched.

See the [release verification report](https://github.com/jabrailkhalil/xynapse/releases/download/v1.108.0/RELEASE-VERIFICATION.md) for the full scope and limitations, including the separately dated browser-test results.

## Development and research

<details>
<summary><strong>Build the Windows IDE from source</strong></summary>

Requires Windows x64, Git with Git LFS, Node.js **22.21.1**, Python 3, and Visual Studio 2022 Build Tools with the C++ workload. Rebuilding the bundled CLI additionally requires Rust; the release used Rust 1.95.0.

Clone the repository and fetch its LFS files:

```powershell
git clone https://github.com/jabrailkhalil/xynapse.git
cd xynapse
git lfs pull
```

Download the release VSIX into the location pinned by the packager:

```powershell
$bundleDir = "artifacts/bvc-0.1.0-20260905"
New-Item -ItemType Directory -Force $bundleDir | Out-Null
$vsixName = "xynapse-assistant-bvc-0.1.0-win32-x64.vsix"
$releaseUrl = "https://github.com/jabrailkhalil/xynapse/releases/download/assistant-v1.0.0-bvc.0.1.0"
Invoke-WebRequest "$releaseUrl/$vsixName" -OutFile "$bundleDir/$vsixName"

cd vscode
npm ci
npm run gulp compile-build-without-mangling
npm run gulp vscode-win32-x64
```

The packager checks the VSIX against [`xynapse-assistant.json`](./vscode/build/xynapse-assistant.json) and copies its exact payload into `resources/app/extensions/xynapse-assistant`. A missing or changed VSIX fails the build. To use another local path, set `XYNAPSE_ASSISTANT_VSIX`; the required checksum remains the same.

</details>

<details>
<summary><strong>BVC evaluation and papers</strong></summary>

The repository includes a 60-task evaluation and three research articles:

- [Adaptive budget allocation in BVC](./research/bvc-evaluation/main60/articles/latex/01_adaptive_budget_bvc.tex)
- [Reproducible evaluation of BVC](./research/bvc-evaluation/main60/articles/latex/02_reproducible_evaluation_bvc.tex)
- [Upfront BVC for programming and vibe coding](./research/bvc-evaluation/main60/articles/latex/03_upfront_bvc_vibecoding.tex)

The measured results describe the evaluated sample. The BVC 0.1.0 release did not include a new benchmark run on paid models.

</details>

## Project

Maintained by **Dzhabrail Khalilov**. [Report an issue](https://github.com/jabrailkhalil/xynapse/issues) with steps to reproduce and the affected IDE or extension version.

Xynapse-specific code is [MIT-licensed](./LICENSE). The distribution includes Code - OSS (MIT), a Continue-derived assistant (Apache-2.0), and the Claw Code runtime (MIT). Component licenses and third-party notices are retained; see [NOTICE](./NOTICE).

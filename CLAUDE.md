# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Xynapse IDE is a desktop development environment (Electron/TypeScript) with an integrated AI assistant called **Xynapse Assistant**.

The repo structure:
- **`vscode/`** — The IDE core (Electron app)
- **`vscode/extensions/xynapse-assistant/`** — The built-in AI assistant extension (compiled artifacts)

## Architecture

### Data Flow: Config → Backend → Frontend

```
~/.xynapse/config.yaml
    → config/yaml/loadYaml.ts (unrollAssistant, configYamlToXynapseConfig)
    → config/yaml/models.ts (llmsFromModelConfig → creates BaseLLM instances)
    → config/load.ts (finalToBrowserConfig → serializes by role)
    → core.ts (getSerializedProfileInfo → postMessage to webview)
    → gui hooks/ParallelListeners.tsx (requests config)
    → Redux store → ModelSelect.tsx (renders model list)
```

### Key Architectural Detail

In `XynapseGUIWebviewViewProvider.ts` and `XynapseConsoleWebviewViewProvider.ts`, `inDevelopmentMode` is forced to `false`. This is required because Xynapse launches with `VSCODE_DEV=1` (development mode), which would otherwise make the GUI try to load from `http://localhost:5173` instead of the bundled assets. Without this, models won't appear in the GUI.

### Model Roles

Each model in config.yaml is assigned roles: `chat`, `edit`, `apply`, `autocomplete`, `summarize`, `embed`, `rerank`.

## Build & Run Commands

### Prerequisites
- Node.js 20.19.0+ (LTS)
- Python 3.10+ (for VS Code build scripts)

### VS Code Core (in `vscode/`)
```bash
npm install              # Install dependencies
npm run compile          # Full compilation (Gulp)
npm run watch            # Watch all (client + extensions)
npm run watch-client     # Watch client only
./scripts/code.bat       # Launch IDE (Windows)
./scripts/code.sh        # Launch IDE (macOS/Linux)
npm run gulp vscode-win32-x64  # Build Win64 release → .build/
```

### VS Code Tests (in `vscode/`)
```bash
npm run test-node        # Mocha CLI tests
npm run test-browser     # Playwright tests
npm run smoketest        # Smoke tests
```

## Council — Multi-Agent Discussion

The `/council` slash command launches a multi-agent planning session.

### Algorithm: 3-Phase Discussion

```
Phase 1: Independent Analysis
  Each agent analyzes the task independently (no visibility of others).
  Response format: ## Proposal → ## Risks → ## Key Decisions

Phase 2: Cross-Critique (0–2 rounds based on difficulty)
  Each agent sees ALL previous responses and must critically respond.
  Response format: ## Agree → ## Disagree → ## Suggest Changes

Phase 3: Plan Synthesis
  Planner receives full phased history, resolves all conflicts.
  Output format includes: ## Disputed Decisions (explicit conflict resolution)
```

### Difficulty → LLM Call Count

| Level | Phase 1 | Phase 2 (critique rounds) | Total calls |
|-------|---------|---------------------------|-------------|
| easy | N agents | 0 | N + 1 |
| medium | N agents | 1 round | 2N + 1 |
| hard | N agents | 2 rounds | 3N + 1 |

### Project Context

Before discussion, `gatherProjectContext(ide)` collects:
- File tree (depth 2, filtered by `.gitignore`)
- `README.md` (truncated to 2000 chars)
- Dependency files (`package.json`, `Cargo.toml`, etc., truncated to 3000 chars)

### Output Files

- `council-plan.md` — final implementation plan (auto-opened)
- `council-discussion.md` — full phased discussion log (optional, controlled by `saveDiscussion`)

## Key Files

| Purpose | Path |
|---------|------|
| Extension manifest | `vscode/extensions/xynapse-assistant/package.json` |
| Config template | `vscode/extensions/xynapse-assistant/xynapse-config.yaml` |
| User runtime config | `~/.xynapse/config.yaml` |

## Debugging

Backend logs use `[Xynapse]` prefix in Extension Host output. GUI logs use `[Xynapse GUI]` and `[Xynapse ModelSelect]` prefixes in DevTools console (F12).

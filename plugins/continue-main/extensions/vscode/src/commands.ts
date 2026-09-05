/* eslint-disable @typescript-eslint/naming-convention */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

import { ContextMenuConfig, ILLM, ModelInstaller } from "core";
import { CompletionProvider } from "core/autocomplete/CompletionProvider";
import { ConfigHandler } from "core/config/ConfigHandler";
import { EXTENSION_NAME } from "core/control-plane/env";
import { Core } from "core/core";
import { walkDirAsync } from "core/indexing/walkDir";
import { isModelInstaller } from "core/llm";
import { NextEditLoggingService } from "core/nextEdit/NextEditLoggingService";
import { startLocalLemonade } from "core/util/lemonadeHelper";
import { startLocalOllama } from "core/util/ollamaHelper";
import {
  getConfigJsonPath,
  getConfigYamlPath,
  getXynapseGlobalPath,
  setConfigFilePermissions,
} from "core/util/paths";
import { Telemetry } from "core/util/posthog";
import * as vscode from "vscode";
import * as YAML from "yaml";

import { convertJsonToYamlConfig } from "../../../packages/config-yaml/dist";

import {
  getAutocompleteStatusBarDescription,
  getAutocompleteStatusBarTitle,
  getNextEditMenuItems,
  getStatusBarStatus,
  getStatusBarStatusFromQuickPickItemLabel,
  handleNextEditToggle,
  isNextEditToggleLabel,
  quickPickStatusText,
  setupStatusBar,
  StatusBarStatus,
} from "./autocomplete/statusBar";
import { XynapseConsoleWebviewViewProvider } from "./XynapseConsoleWebviewViewProvider";
import { XynapseGUIWebviewViewProvider } from "./XynapseGUIWebviewViewProvider";
import { processDiff } from "./diff/processDiff";
import { VerticalDiffManager } from "./diff/vertical/manager";
import EditDecorationManager from "./quickEdit/EditDecorationManager";
import { QuickEdit, QuickEditShowParams } from "./quickEdit/QuickEditQuickPick";
import {
  addCodeToContextFromRange,
  addEntireFileToContext,
  addHighlightedCodeToContext,
} from "./util/addCode";
import { Battery } from "./util/battery";
import {
  planResolvedRuntimeModel,
  toYandexOpenAiModelUri,
} from "./runtimeModel";
import { PublicError } from "core/util/publicError";
import { getMetaKeyLabel } from "./util/util";
import { openEditorAndRevealRange } from "./util/vscode";
import { VsCodeIde } from "./VsCodeIde";

let fullScreenPanel: vscode.WebviewPanel | undefined;
let isMovingFullScreenPanelToNewWindow = false;
const labProcesses = new Map<string, ReturnType<typeof spawn>>();

type RuntimePromptRequest =
  | string
  | {
      prompt?: string;
      model?: string;
      modelTitle?: string;
      provider?: string;
      permissionMode?: RuntimePermissionMode;
      planMode?: boolean;
      runId?: string;
      surface?: "core" | "lab";
      workspaceDir?: string;
      sessionId?: string;
      previousDiscussion?: string;
      runtimeRules?: string;
      allowedTools?: string;
    };

type RuntimeDoctorRequest =
  | { runId?: string; workspaceDir?: string }
  | undefined;
type EnvironmentOpenRequest =
  | {
      action?:
        | "status"
        | "update"
        | "install"
        | "startServer"
        | "startClient"
        | "sendInput"
        | "stopServer"
        | "stop";
      runId?: string;
      workspaceDir?: string;
      input?: string;
      environmentProvider?: string;
      provider?: string;
      environmentModel?: string;
      environmentModelTitle?: string;
      environmentApiKey?: string;
      environmentBaseUrl?: string;
      environmentFolderId?: string;
      permissionMode?:
        | "default"
        | "plan"
        | "acceptEdits"
        | "dontAsk"
        | "bypassPermissions";
    }
  | undefined;
type EnvironmentOpenResponse = {
  ok: boolean;
  message?: string;
  cwd?: string;
  permissionMode?: string;
  runId?: string;
  upstreamRoot?: string;
  upstreamCommit?: string;
  upstreamDirty?: boolean;
  uvInstalled?: boolean;
  python314Installed?: boolean;
  fccInstalled?: boolean;
  clientInstalled?: boolean;
  serverRunning?: boolean;
  serverRunId?: string;
  clientRunning?: boolean;
  clientRunId?: string;
  supportedProviders?: string[];
  environmentHome?: string;
  environmentEnvPath?: string;
  projectStateRoot?: string;
  environmentProvider?: string;
  environmentProviderLabel?: string;
  environmentModel?: string;
  environmentSourceLabel?: string;
  environmentCredentialEnv?: string;
  environmentApiKeyConfigured?: boolean;
  environmentBaseUrl?: string;
};

type RuntimePermissionMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

type RuntimeRunPlan = {
  model: string;
  env: Record<string, string>;
  label: string;
};

type CoreConversationTurn = {
  timestamp: string;
  user: string;
  assistant: string;
  exitCode: number | null;
  model?: string;
  permissionMode?: RuntimePermissionMode;
  planMode?: boolean;
};

type RuntimeCheckpointRestoreRequest = {
  runId?: string;
  sessionId?: string;
  workspaceDir?: string;
};

type RuntimeCheckpointRestoreResult = {
  action: "restored" | "continue" | "cancel";
  message?: string;
};

type LabHistoryRequest = { workspaceDir?: string } | undefined;

type LabHistoryItem = {
  id: string;
  title: string;
  kind: string;
  task: string;
  model?: string;
  exitCode?: number | null;
  route?: string;
  createdAt?: string;
  updatedAt?: string;
  reportRelPath: string;
  planRelPath?: string;
  corePrompt?: string;
  summary?: string;
};

type LabHistoryResponse = {
  items: LabHistoryItem[];
  error?: string;
};

type LabArtifactRequest =
  | {
      workspaceDir?: string;
      relPath?: string;
    }
  | undefined;

const XYNAPSE_PROFILE_FILES = [
  "config.yaml",
  "config.yml",
  "config.json",
  "account.json",
  "profile.json",
  "environment.env",
] as const;

type XynapseProfileFileName = (typeof XYNAPSE_PROFILE_FILES)[number];

type XynapseProfileBackupPayload = {
  files?: Partial<Record<XynapseProfileFileName, string | object>>;
  configYaml?: string;
  configJson?: string | object;
  accountJson?: string | object;
  profileJson?: string | object;
};

function createProfileImportBackup(targetDir: string): string | undefined {
  if (!fs.existsSync(targetDir)) {
    return undefined;
  }

  const backupPath = path.join(
    path.dirname(targetDir),
    `${path.basename(targetDir)}.backup-before-import-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}`,
  );
  fs.cpSync(targetDir, backupPath, { recursive: true });
  return backupPath;
}

function writeImportedProfileFile(
  targetDir: string,
  fileName: XynapseProfileFileName,
  contents: string | object,
) {
  const outputName = fileName === "config.yml" ? "config.yaml" : fileName;
  const serialized =
    typeof contents === "string" ? contents : JSON.stringify(contents, null, 2);
  const outputPath = path.join(targetDir, outputName);

  fs.writeFileSync(outputPath, serialized);
  if (
    outputName === "config.yaml" ||
    outputName === "config.json" ||
    outputName === "environment.env"
  ) {
    setConfigFilePermissions(outputPath);
  }
}

function copyProfileFolder(sourceDir: string, targetDir: string): string[] {
  const copied: string[] = [];

  for (const fileName of XYNAPSE_PROFILE_FILES) {
    const sourcePath = path.join(sourceDir, fileName);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    const outputName = fileName === "config.yml" ? "config.yaml" : fileName;
    const targetPath = path.join(targetDir, outputName);
    fs.copyFileSync(sourcePath, targetPath);
    if (
      outputName === "config.yaml" ||
      outputName === "config.json" ||
      outputName === "environment.env"
    ) {
      setConfigFilePermissions(targetPath);
    }
    copied.push(outputName);
  }

  return [...new Set(copied)];
}

function parseProfileBackupPayload(raw: string): XynapseProfileBackupPayload {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Selected backup is empty.");
  }

  const parsed =
    trimmed.startsWith("{") || trimmed.startsWith("[")
      ? JSON.parse(trimmed)
      : YAML.parse(trimmed);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Selected backup does not contain a profile object.");
  }

  return parsed as XynapseProfileBackupPayload;
}

function applyProfileBackupPayload(
  payload: XynapseProfileBackupPayload,
  targetDir: string,
): string[] {
  const written: string[] = [];

  if (payload.files && typeof payload.files === "object") {
    for (const [fileName, contents] of Object.entries(payload.files)) {
      if (
        !XYNAPSE_PROFILE_FILES.includes(fileName as XynapseProfileFileName) ||
        contents === undefined
      ) {
        continue;
      }
      writeImportedProfileFile(
        targetDir,
        fileName as XynapseProfileFileName,
        contents,
      );
      written.push(fileName === "config.yml" ? "config.yaml" : fileName);
    }
  }

  if (payload.configYaml !== undefined) {
    writeImportedProfileFile(targetDir, "config.yaml", payload.configYaml);
    written.push("config.yaml");
  }
  if (payload.configJson !== undefined) {
    writeImportedProfileFile(targetDir, "config.json", payload.configJson);
    written.push("config.json");
  }
  if (payload.accountJson !== undefined) {
    writeImportedProfileFile(targetDir, "account.json", payload.accountJson);
    written.push("account.json");
  }
  if (payload.profileJson !== undefined) {
    writeImportedProfileFile(targetDir, "profile.json", payload.profileJson);
    written.push("profile.json");
  }

  return [...new Set(written)];
}

async function readProfileBackupFile(
  filePath: string,
  ide: VsCodeIde,
): Promise<string> {
  const raw = fs.readFileSync(filePath);
  const text = raw.toString("utf8");
  const ext = path.extname(filePath).toLowerCase();

  if (ext !== ".enc") {
    return text;
  }

  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("name:")) {
    return text;
  }

  try {
    return await ide.secretStorage.decrypt(filePath);
  } catch (error) {
    throw new Error(
      `Could not decode encrypted backup. The file may belong to another encryption format or machine. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function importXynapseProfileSource(
  sourcePath: string,
  targetDir: string,
  ide: VsCodeIde,
): Promise<string[]> {
  const sourceStat = fs.statSync(sourcePath);

  if (sourceStat.isDirectory()) {
    return copyProfileFolder(sourcePath, targetDir);
  }

  const ext = path.extname(sourcePath).toLowerCase();
  const baseName = path.basename(sourcePath).toLowerCase();

  if (baseName === "config.yaml" || baseName === "config.yml") {
    fs.copyFileSync(sourcePath, getConfigYamlPath("vscode"));
    setConfigFilePermissions(getConfigYamlPath("vscode"));
    return ["config.yaml"];
  }
  if (baseName === "config.json") {
    fs.copyFileSync(sourcePath, getConfigJsonPath());
    setConfigFilePermissions(getConfigJsonPath());
    return ["config.json"];
  }
  if (
    baseName === "account.json" ||
    baseName === "profile.json" ||
    baseName === "environment.env" ||
    ext === ".env"
  ) {
    const outputName = ext === ".env" ? "environment.env" : baseName;
    const targetPath = path.join(targetDir, outputName);
    fs.copyFileSync(sourcePath, targetPath);
    if (outputName === "environment.env") {
      setConfigFilePermissions(targetPath);
    }
    return [outputName];
  }

  const raw = await readProfileBackupFile(sourcePath, ide);

  if (ext === ".yaml" || ext === ".yml") {
    const parsed = YAML.parse(raw);
    if (parsed?.models || parsed?.version || parsed?.schema) {
      fs.writeFileSync(getConfigYamlPath("vscode"), raw);
      setConfigFilePermissions(getConfigYamlPath("vscode"));
      return ["config.yaml"];
    }
  }

  return applyProfileBackupPayload(parseProfileBackupPayload(raw), targetDir);
}

async function importXynapseProfileBackup(
  ide: VsCodeIde,
  configHandler: ConfigHandler,
) {
  const desktopPath = path.join(
    process.env.USERPROFILE ?? process.env.HOME ?? "",
    "Desktop",
  );
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    defaultUri: fs.existsSync(desktopPath)
      ? vscode.Uri.file(desktopPath)
      : undefined,
    openLabel: "Import Xynapse profile/config",
  });

  if (!selected?.length) {
    return;
  }

  const targetDir = getXynapseGlobalPath();
  fs.mkdirSync(targetDir, { recursive: true });
  const backupPath = createProfileImportBackup(targetDir);

  let importedFiles: string[] = [];
  for (const source of selected) {
    importedFiles.push(
      ...(await importXynapseProfileSource(source.fsPath, targetDir, ide)),
    );
  }
  importedFiles = [...new Set(importedFiles)];

  if (importedFiles.length === 0) {
    throw new Error(
      "No Xynapse profile/config files were found in the selected source.",
    );
  }

  await configHandler.reloadConfig("Imported Xynapse profile/config");

  const backupMessage = backupPath ? ` Backup: ${backupPath}` : "";
  void vscode.window.showInformationMessage(
    `Imported Xynapse profile/config: ${importedFiles.join(", ")}.${backupMessage}`,
  );
}

function getFullScreenTab() {
  const tabs = vscode.window.tabGroups.all.flatMap((tabGroup) => tabGroup.tabs);
  return tabs.find((tab) =>
    (tab.input as any)?.viewType?.endsWith("xynapse.xynapseGUIView"),
  );
}

type TelemetryCaptureParams = Parameters<typeof Telemetry.capture>;

/**
 * Helper method to add the `isCommandEvent` to all telemetry captures
 */
function captureCommandTelemetry(
  commandName: TelemetryCaptureParams[0],
  properties: TelemetryCaptureParams[1] = {},
) {
  Telemetry.capture(commandName, { isCommandEvent: true, ...properties });
}

function focusGUI() {
  const fullScreenTab = getFullScreenTab();
  if (fullScreenTab) {
    // focus fullscreen
    fullScreenPanel?.reveal();
  } else {
    // focus sidebar
    vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");
    // vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
  }
}

function hideGUI() {
  const fullScreenTab = getFullScreenTab();
  if (fullScreenTab) {
    // focus fullscreen
    fullScreenPanel?.dispose();
  } else {
    // focus sidebar
    vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    // vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar");
  }
}

function waitForSidebarReady(
  sidebar: XynapseGUIWebviewViewProvider,
  timeout: number,
  interval: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const checkReadyState = () => {
      if (sidebar.isReady) {
        resolve(true);
      } else if (Date.now() - startTime >= timeout) {
        resolve(false); // Timed out
      } else {
        setTimeout(checkReadyState, interval);
      }
    };

    checkReadyState();
  });
}

function isSameOrInsidePath(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative.length === 0 ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function getRequestedWorkspaceDir(
  request:
    | RuntimePromptRequest
    | RuntimeDoctorRequest
    | { workspaceDir?: string },
) {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const requested =
    request && typeof request === "object" && "workspaceDir" in request
      ? request.workspaceDir?.trim()
      : undefined;

  if (requested) {
    let requestedPath = requested;
    if (/^file:/i.test(requested)) {
      try {
        requestedPath = vscode.Uri.parse(requested).fsPath;
      } catch (_error) {
        requestedPath = requested;
      }
    }
    const resolved = path.resolve(requestedPath);
    const matchingFolder = workspaceFolders.find((folder) =>
      isSameOrInsidePath(folder.uri.fsPath, resolved),
    );
    if (matchingFolder) {
      return matchingFolder.uri.fsPath;
    }
  }

  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (activeEditorUri?.scheme === "file") {
    const activeWorkspace =
      vscode.workspace.getWorkspaceFolder(activeEditorUri);
    if (activeWorkspace) {
      return activeWorkspace.uri.fsPath;
    }
  }

  return workspaceFolders[0]?.uri.fsPath;
}

function getRuntimePermissionMode(
  request?: RuntimePromptRequest,
): RuntimePermissionMode {
  if (
    request &&
    typeof request === "object" &&
    request.permissionMode === "danger-full-access"
  ) {
    return "danger-full-access";
  }
  if (
    request &&
    typeof request === "object" &&
    request.permissionMode === "workspace-write"
  ) {
    return "workspace-write";
  }
  return "read-only";
}

function getLabAllowedTools(
  permissionMode: RuntimePermissionMode,
  requestedAllowedTools?: string,
) {
  if (requestedAllowedTools !== undefined) {
    return requestedAllowedTools;
  }

  if (permissionMode === "danger-full-access") {
    return undefined;
  }
  return permissionMode === "workspace-write"
    ? "read,glob,grep,edit,write"
    : "read,glob,grep";
}

function buildWorkspaceAwareLabPrompt(
  prompt: string,
  cwd: string,
  permissionMode: RuntimePermissionMode,
  planMode = false,
  previousTurns: CoreConversationTurn[] = [],
  previousDiscussion?: string,
  runtimeRules?: string,
) {
  const modeInstruction = planMode
    ? "Plan mode: inspect the workspace and produce a concrete implementation plan only. Do not edit files and do not run commands."
    : permissionMode === "danger-full-access"
      ? "Full access mode: you may inspect, edit files, and use runtime tools for this workspace task. Keep changes scoped and explain dangerous actions before using them."
      : permissionMode === "workspace-write"
        ? "You may inspect and edit files inside this workspace only. Before writing, identify the target files, keep changes minimal, and do not modify files outside the workspace."
        : "Read-only mode: inspect files and explain results, but do not edit files.";
  const actionInstruction =
    planMode || permissionMode === "read-only"
      ? ""
      : "When the user asks to create, fix, change, or improve files, use write_file/edit_file to complete the change before the final answer. If the user says a previous result is wrong, inspect the file and apply a concrete correction; do not merely defend the existing file unless there is a specific blocker.";
  const launchInstruction =
    planMode || permissionMode === "read-only"
      ? ""
      : "Do not open created files, browser windows, terminals, or external applications after writing files unless the user explicitly asks to run or open them.";
  const outputInstruction =
    "Do not echo full file contents, large tool outputs, prompt files, or raw logs in the final answer. Summarize paths, changes, and checks briefly.";

  return [
    `Workspace root: ${cwd}`,
    modeInstruction,
    permissionMode === "danger-full-access"
      ? "Use file/search tools first. Shell/runtime tools are available only in full access mode after the user explicitly selected and confirmed this mode."
      : "Use the workspace file tools first: glob_search/grep_search/read_file for inspection, and edit_file/write_file only when edit mode is enabled. Do not use shell/bash in this embedded panel unless full access mode is selected.",
    actionInstruction,
    launchInstruction,
    outputInstruction,
    runtimeRules?.trim() ? `Active Xynapse rules:\n${runtimeRules.trim()}` : "",
    formatCoreConversationContext(previousTurns),
    formatUiConversationContext(previousDiscussion),
    "User task:",
    prompt.trim(),
    "End of Xynapse internal prompt.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getRuntimeRequestRunId(
  request?: RuntimePromptRequest | RuntimeDoctorRequest,
) {
  if (request && typeof request === "object" && "runId" in request) {
    return request.runId;
  }
  return undefined;
}

function isCoreRuntimeRequest(request?: RuntimePromptRequest) {
  return !(request && typeof request === "object" && request.surface === "lab");
}

function createLabRunId() {
  return `lab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function timestampForArtifactName() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
}

function slugForArtifactName(value: string, fallback: string) {
  const asciiValue = value.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
  const slug = asciiValue
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const fallbackSlug = fallback
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallbackSlug || "lab-run";
}

function extractLabTaskTitle(prompt: string) {
  const jsonStart = prompt.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(prompt.slice(jsonStart));
      if (typeof parsed?.task === "string" && parsed.task.trim()) {
        return parsed.task.trim();
      }
    } catch {
      // The prompt may contain prose before/after JSON. Fall back to text rules.
    }
  }

  const taskLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^task\s*[:=]/i.test(line) || /^задача\s*[:=]/i.test(line));
  if (taskLine) {
    return taskLine.replace(/^[^:=]+[:=]\s*/, "").trim();
  }

  return (
    prompt
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? "lab-run"
  );
}

function relativizeWorkspacePath(cwd: string, absPath: string) {
  return path.relative(cwd, absPath).replace(/\\/g, "/");
}

function buildCorePlanPrompt(planRelPath: string, hasLabCoreHandoff = false) {
  return [
    `Read the Core improvement plan at \`${planRelPath}\` and implement only the concrete items listed there.`,
    ...(hasLabCoreHandoff
      ? [
          "If the plan contains a `Lab Core Handoff` section, use that as the primary task after inspecting the workspace.",
        ]
      : []),
    "Inspect the current workspace files first, then apply the smallest useful code/UI changes.",
    "Do not paste the Lab report into the answer, do not echo full files, and do not rewrite working code from scratch unless the plan explicitly requires it.",
    "After editing, briefly list changed files and the checks you ran.",
  ].join("\n");
}

function buildCoreRefinementPrompt(planRelPath: string) {
  return [
    `Read the rejected Lab verification plan at \`${planRelPath}\`.`,
    "Do not edit project source files yet.",
    "Convert the Lab findings into a concise implementation brief: a clarified goal, 2-3 concrete feature scopes, acceptance criteria, risks, and the exact next prompt to run once a scope is chosen.",
    "Keep the answer short and actionable. Do not paste the Lab report, raw logs, prompt files, or full source files.",
  ].join("\n");
}

function asciiSummary(value: string, fallback: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/\s+/g, " ");
}

function limitText(value: string, maxChars: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}\n\n[truncated: ${trimmed.length - maxChars} chars omitted]`;
}

function compactLabOutputForArtifact(output: string, maxChars: number) {
  const htmlOmitted =
    "[omitted HTML document dump; inspect the workspace file directly]";
  const cleaned = output
    .replace(/<!doctype html[\s\S]*?<\/html>/gi, htmlOmitted)
    .replace(
      /\u2026 output truncated for display; full result preserved in session\./g,
      "[tool output truncated]",
    )
    .replace(
      /\.{3} output truncated for display; full result preserved in session\./g,
      "[tool output truncated]",
    )
    .replace(/\n{3,}/g, "\n\n");
  return limitText(cleaned, maxChars);
}

function compactLabOutputForPlan(output: string) {
  const compact = compactLabOutputForArtifact(output, 12000);
  const finalMarkers = [
    "---BVC Verification Report",
    "BVC Verification Report",
    "BVC Verification",
    "Final Verdict",
    "Verdict",
    "Now I have the full workspace context",
  ];
  const markerIndexes = finalMarkers
    .map((marker) => {
      const index = compact.toLowerCase().indexOf(marker.toLowerCase());
      return index >= 0 ? index : undefined;
    })
    .filter((index): index is number => index !== undefined);
  const finalAnswer =
    markerIndexes.length > 0
      ? compact.slice(Math.min(...markerIndexes))
      : compact;

  const lines = finalAnswer
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return false;
      }
      if (
        /^(read_file|file_search|text_search|write_file|edit_file|bash)\b/i.test(
          trimmed,
        )
      ) {
        return false;
      }
      if (
        /^(xynapse activity:|runtime route:|runtime env:|runtime state:)/i.test(
          trimmed,
        )
      ) {
        return false;
      }
      if (
        /^(workspace root:|user task:|end of xynapse internal prompt)/i.test(
          trimmed,
        )
      ) {
        return false;
      }
      if (/^(in \.|[{}"\[\]],?)/i.test(trimmed)) {
        return false;
      }
      if (
        /[\\/]?\.xynapse[\\/]|xynapse-lab\.jsonl|lab-ui-\d+|last-run\.json/i.test(
          trimmed,
        )
      ) {
        return false;
      }
      if (/^(<!doctype|<html|<head|<body|<style|<script|<\/)/i.test(trimmed)) {
        return false;
      }
      if (/^[.#]?[a-z0-9_-]+\s*\{/i.test(trimmed)) {
        return false;
      }
      return true;
    });
  return limitText(lines.join("\n"), 6000);
}

function extractLabCoreHandoff(output: string) {
  const patterns = [
    /(?:^|\n)\s*#{1,3}\s*Core prompt\s*\n([\s\S]*?)(?=\n\s*#{1,3}\s+\S|\n\s*Saved readable Lab report:|\n\s*Process exited|\s*$)/i,
    /(?:^|\n)\s*Core Prompt\s*(?:\n|:)\s*([\s\S]*?)(?=\n\s*(?:Acceptance Criteria|Conflicts|Final Plan|Saved readable Lab report:|Process exited)|\s*$)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (!match?.[1]) {
      continue;
    }
    const cleaned = match[1]
      .replace(/^\s*code\s*/i, "")
      .replace(/^```(?:text)?\s*/i, "")
      .replace(/```$/i, "")
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(
        (line) =>
          !/^(Saved readable Lab report:|Saved Core|Paste this into Xynapse Core:|Process exited)/i.test(
            line.trim(),
          ),
      )
      .join("\n")
      .trim();
    if (cleaned.length >= 24) {
      return limitText(cleaned, 1800);
    }
  }

  return "";
}

function detectGenericBvcRubric(output: string) {
  const lower = output.toLowerCase();
  const rubricSignals = [
    /identify the task and roles/i,
    /verification criteria/i,
    /check for the presence/i,
    /verify the implementation/i,
    /ensure css is used/i,
    /high confidence if/i,
    /medium confidence if/i,
    /low confidence if/i,
    /pass if .*meets all criteria/i,
    /fail if .*significant issues/i,
  ];

  const signalCount = rubricSignals.filter((signal) =>
    signal.test(output),
  ).length;
  const hasBvcShape =
    /\bbvc verification\b/i.test(output) ||
    (lower.includes("criteria") &&
      lower.includes("checks") &&
      lower.includes("contradictions") &&
      lower.includes("confidence") &&
      lower.includes("final verdict"));

  return hasBvcShape && signalCount >= 4;
}

function detectCouncilConfigEcho(output: string) {
  const echoSignals = [
    /the task is to/i,
    /should be reviewed by a council/i,
    /difficulty level is set/i,
    /since the task is in plan mode/i,
    /i will proceed to summarize/i,
    /task:\s*.+roles:/is,
    /the council review will provide/i,
    /will provide opinions/i,
  ];
  const signalCount = echoSignals.filter((signal) =>
    signal.test(output),
  ).length;
  const hasCouncilDeliverable =
    /(^|\n)\s*#{1,3}\s*(Role opinions|Conflicts|Synthesis|Final decision|Final plan|Implementation plan|Acceptance criteria|Core prompt|План|Критерии|Итоговое решение)/im.test(
      output,
    ) || /(^|\n)\s*[-*]\s*(PM|Architect|Developer|Reviewer)\s*:/im.test(output);

  return signalCount >= 2 && !hasCouncilDeliverable;
}

function detectLabRejected(output: string) {
  return (
    /\bREJECTED\b|insufficient specification|not a verifiable requirement|cannot proceed as defined/i.test(
      output,
    ) ||
    detectGenericBvcRubric(output) ||
    detectCouncilConfigEcho(output)
  );
}

function buildRejectedFindingsSummary(output: string) {
  const reasons = new Set<string>();
  const lower = output.toLowerCase();

  if (
    /vague|ambig|undefined|not a verifiable requirement|more powerful/i.test(
      output,
    )
  ) {
    reasons.add(
      "The Lab run rejected the request because the task is too vague to implement safely.",
    );
  }
  if (
    /acceptance criteria|success metrics|testable|verifiability/i.test(output)
  ) {
    reasons.add(
      "Acceptance criteria and measurable success conditions are missing.",
    );
  }
  if (/same model|identical model|role diversity|uniform model/i.test(output)) {
    reasons.add(
      "The BVC role setup has weak diversity because multiple roles use the same model.",
    );
  }
  if (/no existing user stories|traceability|baseline spec/i.test(output)) {
    reasons.add(
      "There is no baseline specification or user story to trace the requested improvement against.",
    );
  }
  if (detectGenericBvcRubric(output)) {
    reasons.add(
      "BVC returned a generic verification rubric instead of concrete implementation findings.",
    );
    reasons.add(
      "BVC is for checking an existing candidate answer or claim; use Council or Compare when the user needs a plan generated from scratch.",
    );
  }
  if (detectCouncilConfigEcho(output)) {
    reasons.add(
      "Council returned a configuration summary instead of role opinions, tradeoffs, final plan, and acceptance criteria.",
    );
    reasons.add(
      "Run Council again with the updated prompt; it must produce the requested deliverable immediately, not describe what it will do.",
    );
  }

  if (reasons.size === 0) {
    reasons.add(
      "The Lab result did not contain concrete, implementable findings.",
    );
  }

  const examples: string[] = [];
  for (const match of output.matchAll(/"([^"]{12,160})"/g)) {
    const value = match[1].trim();
    if (
      /add|support|calculator|operation|history|theme|unit|matrix|graph|solver/i.test(
        value,
      ) &&
      !examples.includes(value)
    ) {
      examples.push(value);
    }
    if (examples.length >= 3) {
      break;
    }
  }

  const lines = [
    "Lab verdict: REJECTED - insufficient specification.",
    "",
    "High-signal findings:",
    ...Array.from(reasons).map((reason) => `- ${reason}`),
    "",
    "Core should not implement code from this plan yet. It should first produce a concrete implementation brief.",
  ];

  if (examples.length > 0) {
    lines.push("", "Possible concrete scopes mentioned by Lab:");
    lines.push(...examples.map((example) => `- ${example}`));
  }

  return lines.join("\n");
}

function persistLabArtifacts(options: {
  cwd: string;
  runId: string;
  title: string;
  model?: string;
  route?: string;
  prompt: string;
  output: string;
  exitCode?: number | null;
}) {
  const taskTitle = extractLabTaskTitle(options.prompt);
  const artifactBase = `${timestampForArtifactName()}-${slugForArtifactName(taskTitle, options.runId)}`;
  const labDir = path.join(options.cwd, ".xynapse", "lab");
  const reportsDir = path.join(labDir, "reports");
  const plansDir = path.join(labDir, "core-plans");
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(plansDir, { recursive: true });

  const reportPath = path.join(reportsDir, `${artifactBase}.md`);
  const planPath = path.join(plansDir, `${artifactBase}-core-plan.md`);
  const reportRelPath = relativizeWorkspacePath(options.cwd, reportPath);
  const planRelPath = relativizeWorkspacePath(options.cwd, planPath);
  const taskSummary = asciiSummary(
    taskTitle,
    "See the source Lab report for the original user task.",
  );
  const compactReportOutput = compactLabOutputForArtifact(
    options.output,
    30000,
  );
  const rejected = detectLabRejected(options.output);
  const labCoreHandoff = rejected ? "" : extractLabCoreHandoff(options.output);
  const corePrompt = rejected
    ? buildCoreRefinementPrompt(planRelPath)
    : buildCorePlanPrompt(planRelPath, !!labCoreHandoff);
  const planFindings = rejected
    ? buildRejectedFindingsSummary(options.output)
    : compactLabOutputForPlan(options.output);

  const reportLines = [
    `# ${options.title}`,
    "",
    `- Workspace: \`${options.cwd}\``,
    `- Task: ${taskTitle}`,
    `- Model: ${options.model ?? "unknown"}`,
    `- Exit code: ${options.exitCode ?? "unknown"}`,
    ...(options.route ? [`- Route: \`${options.route}\``] : []),
    `- Created: ${new Date().toISOString()}`,
    "",
    "## User Request",
    "",
    "```text",
    options.prompt.trim(),
    "```",
    "",
    "## Lab Output",
    "",
    compactReportOutput || "_No output captured._",
    "",
  ];
  const report = reportLines.join("\n");

  const plan = [
    rejected ? "# Core Refinement Plan" : "# Core Improvement Plan",
    "",
    `Source Lab report: \`${reportRelPath}\``,
    `Task: ${taskSummary}`,
    `Lab verdict: ${rejected ? "REJECTED - specification refinement required" : "Implementation candidate"}`,
    "",
    "## Prompt For Xynapse Core",
    "",
    "```text",
    corePrompt,
    "```",
    "",
    rejected ? "## Refinement Plan" : "## Implementation Plan",
    "",
    ...(rejected
      ? [
          "1. Do not edit project source files from this rejected BVC result.",
          "2. Turn the vague request into a concrete implementation brief.",
          "3. Propose 2-3 scoped options and acceptance criteria for each option.",
          "4. Recommend one next prompt that can be sent back to Lab/Core after the user chooses a scope.",
          "5. Keep the answer concise and avoid raw Lab logs or tool output.",
        ]
      : [
          "1. Read this plan first. Open the source Lab report only if a finding is unclear.",
          "2. Inspect the current workspace files mentioned by the findings before editing.",
          "3. Apply the smallest set of code/UI changes that addresses the high-signal findings.",
          "4. Preserve the user's existing project structure and do not replace working code without a reason.",
          "5. Do not echo the Lab report, prompt file, full source files, or raw tool output in the final answer.",
          "6. Verify the changed behavior with the available file/runtime tools and report what was checked.",
        ]),
    "",
    ...(labCoreHandoff
      ? ["## Lab Core Handoff", "", "```text", labCoreHandoff, "```", ""]
      : []),
    "## Findings Summary",
    "",
    "```text",
    planFindings ||
      "No concise Lab findings captured. Open the source Lab report if needed.",
    "```",
    "",
  ].join("\n");

  fs.writeFileSync(reportPath, report, "utf8");
  fs.writeFileSync(planPath, plan, "utf8");

  return { reportRelPath, planRelPath, corePrompt, rejected };
}

function stripInlineMarkdownCode(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length > 1) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseLabReportMetadata(raw: string) {
  const metadata: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^-\s+([^:]+):\s*(.*)$/.exec(line);
    if (match) {
      metadata[match[1].trim().toLowerCase()] = stripInlineMarkdownCode(
        match[2],
      );
    }
  }
  return metadata;
}

function extractMarkdownSection(raw: string, heading: string) {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) {
    return "";
  }

  const sectionLines: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line.trim())) {
      break;
    }
    sectionLines.push(line);
  }
  return sectionLines.join("\n").trim();
}

function extractCorePromptFromPlan(plan: string) {
  const section = extractMarkdownSection(plan, "Prompt For Xynapse Core");
  const fenced = /```(?:text)?\s*([\s\S]*?)```/i.exec(section);
  return (fenced?.[1] ?? section).trim();
}

function compactLabHistorySummary(raw: string) {
  const output = extractMarkdownSection(raw, "Lab Output");
  const fallback = raw.replace(/^#\s+.*$/m, "");
  const cleaned = (output || fallback)
    .replace(/```[\s\S]*?```/g, "[large block omitted]")
    .replace(/\[[^\]]*omitted[^\]]*\]/gi, "[omitted]")
    .replace(
      /^(read_file|file_search|text_search|write_file|edit_file|bash)\b.*$/gim,
      "",
    )
    .replace(
      /^(runtime route:|runtime env:|runtime state:|workspace root:).*$/gim,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return limitText(cleaned || "No concise Lab summary captured.", 900);
}

function inferLabHistoryKind(task: string, raw: string) {
  const text = `${task}\n${raw}`.toLowerCase();
  if (text.includes("bvc")) {
    return "bvc";
  }
  if (text.includes("council")) {
    return "council";
  }
  if (text.includes("audit")) {
    return "audit";
  }
  if (text.includes("compare")) {
    return "compare";
  }
  return "research";
}

function listXynapseLabHistory(cwd: string): LabHistoryItem[] {
  const reportsDir = path.join(cwd, ".xynapse", "lab", "reports");
  const plansDir = path.join(cwd, ".xynapse", "lab", "core-plans");
  if (!fs.existsSync(reportsDir)) {
    return [];
  }

  const reportEntries = fs
    .readdirSync(reportsDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
    );

  const items = reportEntries
    .map((entry): LabHistoryItem | undefined => {
      const reportPath = path.join(reportsDir, entry.name);
      try {
        const raw = fs.readFileSync(reportPath, "utf8");
        const stat = fs.statSync(reportPath);
        const metadata = parseLabReportMetadata(raw);
        const artifactBase = path.basename(entry.name, ".md");
        const planPath = path.join(plansDir, `${artifactBase}-core-plan.md`);
        const hasPlan = fs.existsSync(planPath);
        const plan = hasPlan ? fs.readFileSync(planPath, "utf8") : "";
        const title =
          /^#\s+(.+)$/m.exec(raw)?.[1]?.trim() || "Xynapse Lab research";
        const task = metadata.task || title;
        const exitCode =
          metadata["exit code"] &&
          Number.isFinite(Number(metadata["exit code"]))
            ? Number(metadata["exit code"])
            : null;

        return {
          id: artifactBase,
          title,
          kind: inferLabHistoryKind(task, raw),
          task,
          model: metadata.model,
          exitCode,
          route: metadata.route,
          createdAt: metadata.created || stat.birthtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          reportRelPath: relativizeWorkspacePath(cwd, reportPath),
          planRelPath: hasPlan
            ? relativizeWorkspacePath(cwd, planPath)
            : undefined,
          corePrompt: plan ? extractCorePromptFromPlan(plan) : undefined,
          summary: compactLabHistorySummary(raw),
        };
      } catch {
        return undefined;
      }
    })
    .filter((item): item is LabHistoryItem => item !== undefined);

  return items
    .sort((a, b) => {
      const bTime = new Date(b.createdAt ?? b.updatedAt ?? 0).getTime();
      const aTime = new Date(a.createdAt ?? a.updatedAt ?? 0).getTime();
      return bTime - aTime;
    })
    .slice(0, 100);
}

function resolveXynapseLabArtifactPath(cwd: string, relPath?: string) {
  if (!relPath || path.isAbsolute(relPath)) {
    return undefined;
  }

  const normalizedRelPath = relPath.replace(/[\\/]+/g, path.sep);
  const labRoot = path.join(cwd, ".xynapse", "lab");
  const resolved = path.resolve(cwd, normalizedRelPath);
  if (!isSameOrInsidePath(labRoot, resolved) || !fs.existsSync(resolved)) {
    return undefined;
  }
  return resolved;
}

function sendLabRunEvent(
  sidebar: XynapseGUIWebviewViewProvider,
  event: {
    runId: string;
    kind: "start" | "chunk" | "end" | "error";
    stream?: "stdout" | "stderr" | "system";
    text?: string;
    title?: string;
    cwd?: string;
    model?: string;
    command?: string;
    exitCode?: number | null;
  },
) {
  sidebar.webviewProtocol?.send("xynapse/labRunEvent", event);
}

function stripAnsiControlSequences(text: string) {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, "")
    .replace(/\x1b[0-9=>]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function sanitizeLabOutput(text: string) {
  return stripAnsiControlSequences(text)
    .replace(/\.claw\b/g, ".xynapse")
    .replace(/\bCLAW_CONFIG_HOME\b/g, "XYNAPSE_CONFIG_HOME")
    .replace(/\bglob_search\b/g, "file_search")
    .replace(/\bgrep_search\b/g, "text_search")
    .replace(/\bGlob\b/g, "File search")
    .replace(/\bGrep\b/g, "Text search")
    .replace(/🦀/g, "🧬")
    .replace(/^claw\s+v/gim, "Xynapse runtime v")
    .replace(/\bclaw-code\b/gi, "Xynapse runtime")
    .replace(/\bclaw\.exe\b/gi, "xynapse.exe")
    .replace(/\bclaw\b/gi, "Xynapse runtime")
    .replace(new RegExp(`\\b${["cla", "ude"].join("")}\\b`, "gi"), "Xynapse");
}

function stripRuntimePromptFileEcho(text: string) {
  return text
    .replace(
      /(?:^|\n)\s*read_file\s*\n\s*.*(?:Reading|Read)\s+.*\.xynapse[\\/]runtime[\\/]prompts[^\n]*(?:\n|$)/gim,
      "\n",
    )
    .replace(
      /^.*(?:Reading|Read)\s+.*\.xynapse[\\/]runtime[\\/]prompts[^\n]*(?:\n|$)/gim,
      "",
    )
    .replace(
      /(?:^|\n)Workspace root:[\s\S]*?\nEnd of Xynapse internal prompt\.\s*(?:\n|$)/g,
      "\n",
    )
    .replace(
      /(?:^|\n)Workspace root:[\s\S]*?\nUser task:\s*\n+[^\n]*(?:\n|$)/g,
      "\n",
    );
}

function cleanRuntimeOutputForChat(text: string) {
  return stripRuntimePromptFileEcho(text)
    .replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/gm, "")
    .replace(/^.*?\bXynapse thinking\.\.\.\s*/gm, "")
    .replace(/\s*╭─\s*([^─]+?)\s*─╮\s*/g, "\n$1\n")
    .replace(/^╭─\s*([^─]+?)\s*─╮\s*$/gm, "\n$1")
    .replace(/^╰[─╯]+$/gm, "")
    .replace(/^│\s?/gm, "")
    .replace(/^╰─$/gm, "")
    .replace(/\\\?\\([A-Za-z]:\\)/g, "$1")
    .replace(/\?\\([A-Za-z]:\\)/g, "$1")
    .replace(/^\s*Open Xynapse Lab help from the IDE for usage\.\s*$/gim, "")
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n");
}

function isNoContentAssistantStreamError(text: string) {
  return /assistant stream (produced|ended with).*no content/i.test(text);
}

function hasSuccessfulWorkspaceMutation(text: string) {
  return /\b(Edited|Wrote|Created|Updated|Deleted)\b/i.test(text);
}

function buildToolOnlyCompletionMessage(text: string) {
  const edited = /\bEdited\b/i.test(text);
  const wrote = /\bWrote\b/i.test(text);

  if (edited && wrote) {
    return "\nXynapse applied the requested file changes and wrote the needed files.\n";
  }
  if (edited) {
    return "\nXynapse applied the requested file changes.\n";
  }
  if (wrote) {
    return "\nXynapse wrote the requested files.\n";
  }
  return "\nXynapse completed the requested workspace changes.\n";
}

function stripNoContentAssistantError(text: string) {
  const markers = ["Xynapse request failed", "[error-kind:"];
  const cutAt = markers
    .map((marker) => text.lastIndexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (cutAt === undefined) {
    return text;
  }

  const suffix = text.slice(cutAt);
  if (!isNoContentAssistantStreamError(suffix)) {
    return text;
  }

  return text.slice(0, cutAt).trimEnd();
}

function recoverToolOnlyConversationTurn(
  turn: CoreConversationTurn,
): CoreConversationTurn {
  if (
    turn.exitCode === 0 ||
    !isNoContentAssistantStreamError(turn.assistant) ||
    !hasSuccessfulWorkspaceMutation(turn.assistant)
  ) {
    return turn;
  }

  const assistant = stripNoContentAssistantError(turn.assistant);
  return {
    ...turn,
    assistant: `${assistant}${buildToolOnlyCompletionMessage(turn.assistant)}`,
    exitCode: 0,
  };
}

function providerEnvSummary(env: Record<string, string>) {
  const merged = { ...process.env, ...env };
  const present = (key: string) => (merged[key]?.trim() ? "present" : "absent");
  const value = (key: string) => merged[key]?.trim() || "default";

  return [
    `yandex=${present("YANDEX_API_KEY")}`,
    `yandexBase=${value("YANDEX_BASE_URL")}`,
    `yandexFolder=${present("YANDEX_FOLDER_ID")}`,
    `openai=${present("OPENAI_API_KEY")}`,
    `openaiBase=${value("OPENAI_BASE_URL")}`,
    `dashscope=${present("DASHSCOPE_API_KEY")}`,
    `xai=${present("XAI_API_KEY")}`,
  ].join(" ");
}

function getRuntimePathKey(env: Record<string, string | undefined>) {
  if (process.platform !== "win32") {
    return "PATH";
  }
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
}

function getEnvironmentUvHome() {
  return path.join(getDefaultEnvironmentHome(), "uv");
}

function getEnvironmentUvToolDir() {
  return path.join(getEnvironmentUvHome(), "tools");
}

function getEnvironmentUvToolBinDir() {
  return path.join(getEnvironmentUvHome(), "bin");
}

function getEnvironmentUvPythonInstallDir() {
  return path.join(getEnvironmentUvHome(), "python");
}

function getEnvironmentUvCacheDir() {
  return path.join(getEnvironmentUvHome(), "cache");
}

function applyEnvironmentUvEnv(env: Record<string, string | undefined>) {
  env.UV_TOOL_DIR = getEnvironmentUvToolDir();
  env.UV_TOOL_BIN_DIR = getEnvironmentUvToolBinDir();
  env.UV_PYTHON_INSTALL_DIR = getEnvironmentUvPythonInstallDir();
  env.UV_CACHE_DIR = getEnvironmentUvCacheDir();
}

function getWindowsRuntimePathPrefixes() {
  if (process.platform !== "win32") {
    return [];
  }

  return [
    getEnvironmentUvToolBinDir(),
    path.join(
      getEnvironmentUvPythonInstallDir(),
      "cpython-3.14-windows-x86_64-none",
    ),
    path.join(process.env.USERPROFILE ?? "", ".local", "bin"),
    path.join(
      process.env.APPDATA ?? "",
      "uv",
      "python",
      "cpython-3.14-windows-x86_64-none",
    ),
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin"),
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Git",
      "usr",
      "bin",
    ),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Git",
      "bin",
    ),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Git",
      "usr",
      "bin",
    ),
  ].filter((candidate) => fs.existsSync(candidate));
}

function getWindowsCommandCandidatePaths(command: string) {
  if (process.platform !== "win32") {
    return [];
  }

  const executable = command.toLowerCase().endsWith(".exe")
    ? command
    : `${command}.exe`;

  return [
    path.join(getEnvironmentUvToolBinDir(), executable),
    path.join(process.env.USERPROFILE ?? "", ".local", "bin", executable),
    path.join(
      process.env.APPDATA ?? "",
      "Python",
      "Python314",
      "Scripts",
      executable,
    ),
  ].filter((candidate) => fs.existsSync(candidate));
}

function applyRuntimePathFixes(env: Record<string, string | undefined>) {
  applyEnvironmentUvEnv(env);
  const pathKey = getRuntimePathKey(env);
  const existingPath = env[pathKey] ?? env.PATH ?? process.env.PATH ?? "";
  const pathParts = existingPath
    .split(path.delimiter)
    .filter((part) => part.trim().length > 0);
  const normalizedExisting = new Set(
    pathParts.map((part) => path.resolve(part).toLowerCase()),
  );
  const prefixes = getWindowsRuntimePathPrefixes().filter(
    (prefix) => !normalizedExisting.has(path.resolve(prefix).toLowerCase()),
  );
  const fixedPath = [...prefixes, ...pathParts].join(path.delimiter);

  env[pathKey] = fixedPath;
  env.PATH = fixedPath;
}

function ensureXynapseRuntimeState(
  cwd: string,
  options: { title: string; model?: string; route?: string },
) {
  const stateDir = path.join(cwd, ".xynapse");
  const runtimeDir = path.join(stateDir, "runtime");
  const homeDir = path.join(stateDir, "home");
  const configDir = path.join(runtimeDir, "config");
  const cacheDir = path.join(runtimeDir, "cache");
  const xdgConfigDir = path.join(homeDir, ".config");

  for (const dir of [
    stateDir,
    runtimeDir,
    homeDir,
    configDir,
    cacheDir,
    xdgConfigDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(runtimeDir, "last-run.json"),
    JSON.stringify(
      {
        cwd,
        title: options.title,
        model: options.model,
        route: options.route,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  return { stateDir, runtimeDir, homeDir, configDir, cacheDir, xdgConfigDir };
}

function runtimePromptFileRelPath(runId: string) {
  return [
    ".xynapse",
    "runtime",
    "prompts",
    `${safeRuntimeSessionId(runId) ?? "prompt"}.md`,
  ].join("/");
}

function writeRuntimePromptFile(cwd: string, runId: string, prompt: string) {
  const relPath = runtimePromptFileRelPath(runId);
  const absPath = path.join(cwd, ...relPath.split("/"));
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, prompt, "utf8");
  return relPath;
}

function buildRuntimePromptFileBootstrap(promptRelPath: string) {
  return [
    "The full task prompt is stored as UTF-8 text in this workspace file:",
    promptRelPath,
    "",
    "First call read_file for that exact relative path.",
    "Then follow the file contents exactly as the user's task and conversation context.",
    "Do not answer this bootstrap text directly.",
  ].join("\n");
}

function safeRuntimeSessionId(sessionId?: string) {
  const safe = sessionId?.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
  return safe || undefined;
}

function coreConversationPath(cwd: string, sessionId?: string) {
  const safeSessionId = safeRuntimeSessionId(sessionId);
  if (!safeSessionId) {
    return undefined;
  }
  return path.join(
    cwd,
    ".xynapse",
    "sessions",
    safeSessionId,
    "core-conversation.json",
  );
}

function runtimeSessionsDir(cwd: string) {
  return path.join(cwd, ".xynapse", "sessions");
}

function runtimeCheckpointsDir(cwd: string) {
  return path.join(cwd, ".xynapse", "checkpoints");
}

function removeEmptyDirsUpTo(dir: string, stopDir: string) {
  let current = path.resolve(dir);
  const stop = path.resolve(stopDir);

  while (isSameOrInsidePath(stop, current) && current !== stop) {
    try {
      if (fs.existsSync(current) && fs.readdirSync(current).length === 0) {
        fs.rmdirSync(current);
        current = path.dirname(current);
        continue;
      }
    } catch {
      // Cleanup is best-effort only.
    }
    break;
  }
}

function deleteXynapseRuntimeSession(cwd: string, sessionId?: string) {
  const safeSessionId = safeRuntimeSessionId(sessionId);
  if (!safeSessionId) {
    return;
  }

  try {
    const sessionsDir = runtimeSessionsDir(cwd);
    fs.rmSync(path.join(sessionsDir, safeSessionId), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(runtimeCheckpointsDir(cwd), safeSessionId), {
      recursive: true,
      force: true,
    });

    if (fs.existsSync(sessionsDir)) {
      const removeRuntimeTranscripts = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          if (!isSameOrInsidePath(sessionsDir, abs)) {
            continue;
          }
          if (entry.isDirectory()) {
            removeRuntimeTranscripts(abs);
            removeEmptyDirsUpTo(abs, sessionsDir);
            continue;
          }
          if (entry.isFile() && entry.name === `${safeSessionId}.jsonl`) {
            fs.rmSync(abs, { force: true });
            removeEmptyDirsUpTo(path.dirname(abs), sessionsDir);
          }
        }
      };
      removeRuntimeTranscripts(sessionsDir);
    }
  } catch {
    // Runtime memory cleanup should never break chat deletion.
  }
}

function clearXynapseRuntimeSessions(cwd: string) {
  try {
    fs.rmSync(runtimeSessionsDir(cwd), { recursive: true, force: true });
    fs.rmSync(runtimeCheckpointsDir(cwd), { recursive: true, force: true });
    fs.rmSync(path.join(cwd, ".xynapse", "runtime", "core-conversation.json"), {
      force: true,
    });
  } catch {
    // Runtime memory cleanup should never break chat deletion.
  }
}

const RUNTIME_CHECKPOINT_EXCLUDED_DIRS = new Set([
  ".git",
  ".xynapse",
  "node_modules",
  ".venv",
  "venv",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
  "coverage",
  "target",
]);
const RUNTIME_CHECKPOINT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const RUNTIME_CHECKPOINT_MAX_FILES = 1500;

type RuntimeCheckpointFile = {
  rel: string;
  size: number;
};

type RuntimeCheckpointManifest = {
  version: 1;
  cwd: string;
  sessionId: string;
  runId: string;
  createdAt: string;
  files: RuntimeCheckpointFile[];
  skipped: string[];
};

function runtimeCheckpointDir(cwd: string, sessionId?: string, runId?: string) {
  const safeSessionId = safeRuntimeSessionId(sessionId);
  const safeRunId = safeRuntimeSessionId(runId);
  if (!safeSessionId || !safeRunId) {
    return undefined;
  }
  return path.join(cwd, ".xynapse", "checkpoints", safeSessionId, safeRunId);
}

function shouldSkipCheckpointDir(dirname: string) {
  return RUNTIME_CHECKPOINT_EXCLUDED_DIRS.has(dirname);
}

function normalizeCheckpointRelPath(absPath: string, cwd: string) {
  return path.relative(cwd, absPath).replace(/\\/g, "/");
}

function collectCheckpointFiles(cwd: string) {
  const files: RuntimeCheckpointFile[] = [];
  const skipped: string[] = [];

  const visit = (dir: string) => {
    if (files.length >= RUNTIME_CHECKPOINT_MAX_FILES) {
      return;
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = normalizeCheckpointRelPath(abs, cwd);

      if (entry.isDirectory()) {
        if (!shouldSkipCheckpointDir(entry.name)) {
          visit(abs);
        }
        continue;
      }

      if (!entry.isFile()) {
        skipped.push(rel);
        continue;
      }

      const stat = fs.statSync(abs);
      if (stat.size > RUNTIME_CHECKPOINT_MAX_FILE_BYTES) {
        skipped.push(rel);
        continue;
      }

      files.push({ rel, size: stat.size });
      if (files.length >= RUNTIME_CHECKPOINT_MAX_FILES) {
        skipped.push("[file limit reached]");
        return;
      }
    }
  };

  visit(cwd);
  return { files, skipped };
}

function checkpointFilePath(checkpointDir: string, rel: string) {
  return path.join(checkpointDir, "files", ...rel.split("/"));
}

function createXynapseRuntimeCheckpoint(
  cwd: string,
  sessionId: string | undefined,
  runId: string,
) {
  const checkpointDir = runtimeCheckpointDir(cwd, sessionId, runId);
  if (!checkpointDir) {
    return;
  }

  const manifestPath = path.join(checkpointDir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    return;
  }

  const { files, skipped } = collectCheckpointFiles(cwd);
  fs.rmSync(checkpointDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(checkpointDir, "files"), { recursive: true });

  for (const file of files) {
    const source = path.resolve(cwd, file.rel);
    const target = checkpointFilePath(checkpointDir, file.rel);
    if (!isSameOrInsidePath(cwd, source)) {
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }

  const manifest: RuntimeCheckpointManifest = {
    version: 1,
    cwd,
    sessionId: safeRuntimeSessionId(sessionId) ?? "",
    runId,
    createdAt: new Date().toISOString(),
    files,
    skipped,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

function removeEmptyCheckpointDirs(dir: string, cwd: string) {
  const isRoot = path.resolve(dir) === path.resolve(cwd);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory() && !shouldSkipCheckpointDir(entry.name)) {
      removeEmptyCheckpointDirs(abs, cwd);
    }
  }

  if (
    !isRoot &&
    fs.readdirSync(dir).length === 0 &&
    isSameOrInsidePath(cwd, dir)
  ) {
    fs.rmdirSync(dir);
  }
}

function restoreXynapseRuntimeCheckpoint(
  cwd: string,
  sessionId: string | undefined,
  runId: string | undefined,
) {
  const checkpointDir = runtimeCheckpointDir(cwd, sessionId, runId);
  if (!checkpointDir) {
    throw new Error("Missing checkpoint id.");
  }

  const manifestPath = path.join(checkpointDir, "manifest.json");
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8"),
  ) as RuntimeCheckpointManifest;
  const snapshotFiles = new Set(manifest.files.map((file) => file.rel));
  const currentFiles = collectCheckpointFiles(cwd).files;

  for (const current of currentFiles) {
    if (!snapshotFiles.has(current.rel)) {
      const abs = path.resolve(cwd, current.rel);
      if (isSameOrInsidePath(cwd, abs)) {
        fs.rmSync(abs, { force: true });
      }
    }
  }

  for (const file of manifest.files) {
    const source = checkpointFilePath(checkpointDir, file.rel);
    const target = path.resolve(cwd, file.rel);
    if (!fs.existsSync(source) || !isSameOrInsidePath(cwd, target)) {
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }

  removeEmptyCheckpointDirs(cwd, cwd);
}

async function confirmAndRestoreRuntimeCheckpoint(
  cwd: string,
  request?: RuntimeCheckpointRestoreRequest,
): Promise<RuntimeCheckpointRestoreResult> {
  const checkpointDir = runtimeCheckpointDir(
    cwd,
    request?.sessionId,
    request?.runId,
  );
  const manifestPath = checkpointDir
    ? path.join(checkpointDir, "manifest.json")
    : undefined;

  if (!manifestPath || !fs.existsSync(manifestPath)) {
    const selection = await vscode.window.showWarningMessage(
      "No code checkpoint was found for that earlier message. Continue the chat branch without rolling files back?",
      { modal: true },
      "Continue chat only",
      "Cancel",
    );
    return selection === "Continue chat only"
      ? { action: "continue", message: "No checkpoint found." }
      : { action: "cancel", message: "User cancelled checkpoint restore." };
  }

  const selection = await vscode.window.showWarningMessage(
    "Roll workspace files back to the state before that earlier message, then continue the chat from there?",
    { modal: true },
    "Rollback code and continue",
    "Continue chat only",
    "Cancel",
  );

  if (selection === "Cancel" || !selection) {
    return { action: "cancel", message: "User cancelled checkpoint restore." };
  }

  if (selection === "Continue chat only") {
    return { action: "continue" };
  }

  restoreXynapseRuntimeCheckpoint(cwd, request?.sessionId, request?.runId);
  void vscode.window.showInformationMessage(
    "Workspace rolled back to the selected chat point.",
  );
  return { action: "restored" };
}

function trimConversationText(text: string, limit = 12_000) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, 2_000)}\n\n[...trimmed...]\n\n${text.slice(-limit + 2_000)}`;
}

function readXynapseCoreConversation(
  cwd: string,
  sessionId?: string,
): CoreConversationTurn[] {
  const conversationPath = coreConversationPath(cwd, sessionId);
  if (!conversationPath) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(conversationPath, "utf8"));
    const turns = Array.isArray(parsed) ? parsed : parsed?.turns;
    if (!Array.isArray(turns)) {
      return [];
    }
    return turns
      .filter(
        (turn): turn is CoreConversationTurn =>
          typeof turn?.user === "string" &&
          typeof turn?.assistant === "string" &&
          typeof turn?.timestamp === "string",
      )
      .map(recoverToolOnlyConversationTurn)
      .slice(-8);
  } catch {
    return [];
  }
}

function appendXynapseCoreConversationTurn(
  cwd: string,
  sessionId: string | undefined,
  turn: Omit<CoreConversationTurn, "timestamp">,
) {
  const conversationPath = coreConversationPath(cwd, sessionId);
  if (!conversationPath) {
    return;
  }

  try {
    const runtimeDir = path.dirname(conversationPath);
    fs.mkdirSync(runtimeDir, { recursive: true });
    const turns = readXynapseCoreConversation(cwd, sessionId);
    turns.push({
      ...turn,
      user: trimConversationText(turn.user, 4_000),
      assistant: trimConversationText(
        cleanRuntimeOutputForChat(turn.assistant),
      ),
      timestamp: new Date().toISOString(),
    });
    fs.writeFileSync(
      conversationPath,
      JSON.stringify({ version: 1, turns: turns.slice(-8) }, null, 2),
      "utf8",
    );
  } catch {
    // Conversation persistence is a UX feature; never fail the user task on it.
  }
}

function formatCoreConversationContext(turns: CoreConversationTurn[]) {
  const recent = turns.slice(-5);
  if (recent.length === 0) {
    return "";
  }

  const transcript = recent
    .map((turn, index) =>
      [
        `Turn ${index + 1}:`,
        `User: ${trimConversationText(turn.user, 2_000)}`,
        `Xynapse: ${trimConversationText(turn.assistant, 3_000)}`,
      ].join("\n"),
    )
    .join("\n\n");

  return [
    "Previous Xynapse Core conversation context follows. Treat the current task as a continuation of this same workspace conversation when it refers to previous files, errors, fixes, or runs.",
    transcript,
  ].join("\n\n");
}

function formatUiConversationContext(previousDiscussion?: string) {
  const trimmed = previousDiscussion?.trim();
  if (!trimmed) {
    return "";
  }

  return [
    "Recent Xynapse chat discussion follows. Use it as additional context for references to what was discussed in the IDE chat.",
    trimConversationText(trimmed, 8_000),
  ].join("\n\n");
}

function runRuntimeInWebview(
  sidebar: XynapseGUIWebviewViewProvider,
  executable: string,
  args: string[],
  options: {
    runId: string;
    cwd: string;
    env?: Record<string, string>;
    title: string;
    model?: string;
    route?: string;
    prompt: string;
    saveArtifacts?: boolean;
    conversation?: {
      userPrompt: string;
      permissionMode: RuntimePermissionMode;
      planMode?: boolean;
    };
    sessionId?: string;
  },
) {
  const xynapseRuntime = ensureXynapseRuntimeState(options.cwd, options);
  const env = {
    ...process.env,
    HOME: xynapseRuntime.homeDir,
    USERPROFILE: xynapseRuntime.homeDir,
    XDG_CONFIG_HOME: xynapseRuntime.xdgConfigDir,
    XYNAPSE_HOME: xynapseRuntime.stateDir,
    XYNAPSE_RUNTIME_HOME: xynapseRuntime.runtimeDir,
    XYNAPSE_CONFIG_HOME: xynapseRuntime.configDir,
    XYNAPSE_CACHE_HOME: xynapseRuntime.cacheDir,
    ...(options.sessionId
      ? { XYNAPSE_RUNTIME_SESSION_ID: options.sessionId }
      : {}),
    CLAW_CONFIG_HOME: xynapseRuntime.configDir,
    [["CLAU", "DE_CONFIG_HOME"].join("")]: xynapseRuntime.cacheDir,
    CLAW_SKIP_GIT_DIFF: "1",
    ...options.env,
  };
  applyRuntimePathFixes(env);
  sendLabRunEvent(sidebar, {
    runId: options.runId,
    kind: "start",
    stream: "system",
    title: options.title,
    cwd: options.cwd,
    model: options.model,
    command: `xynapse ${args.join(" ")}`,
    text:
      [
        `Starting ${options.title} in ${options.cwd}`,
        options.route ? `Runtime route: ${options.route}` : undefined,
        `Runtime env: ${providerEnvSummary(options.env ?? {})}`,
        "Runtime state: .xynapse",
        "",
      ]
        .filter(Boolean)
        .join("\n") + "\n",
  });

  const child = spawn(executable, args, {
    cwd: options.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  labProcesses.set(options.runId, child);
  const outputChunks: string[] = [];
  const deferredNoContentErrors: string[] = [];

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = cleanRuntimeOutputForChat(
      sanitizeLabOutput(chunk.toString("utf8")),
    );
    outputChunks.push(text);
    sendLabRunEvent(sidebar, {
      runId: options.runId,
      kind: "chunk",
      stream: "stdout",
      text,
    });
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = cleanRuntimeOutputForChat(
      sanitizeLabOutput(chunk.toString("utf8")),
    );
    if (isNoContentAssistantStreamError(text)) {
      deferredNoContentErrors.push(text);
      return;
    }

    outputChunks.push(text);
    sendLabRunEvent(sidebar, {
      runId: options.runId,
      kind: "chunk",
      stream: "stderr",
      text,
    });
  });

  child.on("error", (error) => {
    labProcesses.delete(options.runId);
    sendLabRunEvent(sidebar, {
      runId: options.runId,
      kind: "error",
      stream: "system",
      text: `${error.message}\n`,
    });
  });

  child.on("close", (exitCode) => {
    labProcesses.delete(options.runId);
    const outputText = outputChunks.join("");
    const recoveredToolOnlyTurn =
      exitCode !== 0 &&
      deferredNoContentErrors.length > 0 &&
      hasSuccessfulWorkspaceMutation(outputText);
    const finalExitCode = recoveredToolOnlyTurn ? 0 : exitCode;

    if (recoveredToolOnlyTurn) {
      const completionMessage = buildToolOnlyCompletionMessage(outputText);
      outputChunks.push(completionMessage);
      sendLabRunEvent(sidebar, {
        runId: options.runId,
        kind: "chunk",
        stream: "stdout",
        text: completionMessage,
      });
    } else {
      for (const text of deferredNoContentErrors) {
        outputChunks.push(text);
        sendLabRunEvent(sidebar, {
          runId: options.runId,
          kind: "chunk",
          stream: "stderr",
          text,
        });
      }
    }

    if (options.conversation) {
      appendXynapseCoreConversationTurn(options.cwd, options.sessionId, {
        user: options.conversation.userPrompt,
        assistant: outputChunks.join(""),
        exitCode: finalExitCode,
        model: options.model,
        permissionMode: options.conversation.permissionMode,
        planMode: options.conversation.planMode,
      });
    } else if (options.saveArtifacts !== false) {
      try {
        const artifacts = persistLabArtifacts({
          cwd: options.cwd,
          runId: options.runId,
          title: options.title,
          model: options.model,
          route: options.route,
          prompt: options.prompt,
          output: outputChunks.join(""),
          exitCode: finalExitCode,
        });
        const artifactMessage = [
          "",
          "Saved readable Lab report:",
          artifacts.reportRelPath,
          "",
          artifacts.rejected
            ? "Saved Core refinement plan (Lab rejected implementation):"
            : "Saved Core improvement plan:",
          artifacts.planRelPath,
          "",
          "Paste this into Xynapse Core:",
          artifacts.corePrompt,
          "",
        ].join("\n");
        outputChunks.push(artifactMessage);
        sendLabRunEvent(sidebar, {
          runId: options.runId,
          kind: "chunk",
          stream: "system",
          text: artifactMessage,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendLabRunEvent(sidebar, {
          runId: options.runId,
          kind: "chunk",
          stream: "stderr",
          text: `\nCould not save Lab artifacts: ${message}\n`,
        });
      }
    }
    sendLabRunEvent(sidebar, {
      runId: options.runId,
      kind: "end",
      stream: "system",
      exitCode: finalExitCode,
      text: `\nProcess exited with code ${finalExitCode ?? "unknown"}\n`,
    });
  });
}

function stopRuntimeInWebview(
  sidebar: XynapseGUIWebviewViewProvider,
  request?: { runId?: string },
) {
  const runningIds = Array.from(labProcesses.keys());
  const runId = request?.runId ?? runningIds[runningIds.length - 1];
  const child = runId ? labProcesses.get(runId) : undefined;

  if (!runId || !child) {
    sendLabRunEvent(sidebar, {
      runId: runId ?? createLabRunId(),
      kind: "error",
      stream: "system",
      text: "No running Xynapse runtime process was found.\n",
    });
    return;
  }

  sendLabRunEvent(sidebar, {
    runId,
    kind: "chunk",
    stream: "system",
    text: "\nStop requested by user.\n",
  });

  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => child.kill());
  } else {
    child.kill("SIGTERM");
  }
}

function isUsableSecret(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.includes("YOUR_") &&
    !trimmed.startsWith("${{") &&
    !trimmed.toLowerCase().includes("placeholder")
  );
}

function setRuntimeEnv(
  env: Record<string, string>,
  key: string,
  value: unknown,
) {
  if (process.env[key] || env[key] || !isUsableSecret(value)) {
    return;
  }
  env[key] = value.trim();
}

const YANDEX_OPENAI_BASE_URL = "https://ai.api.cloud.yandex.net/v1";

function collectRuntimeEnvFromObject(
  value: unknown,
  env: Record<string, string>,
) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectRuntimeEnvFromObject(item, env));
    return;
  }

  const record = value as Record<string, unknown>;
  const provider = normalizeXynapseEnvironmentProviderName(
    record.providerName ?? record.provider ?? record.name ?? record.uses,
  );
  const model = String(record.model ?? record.title ?? "").toLowerCase();
  const withEnv = record.with;

  if (withEnv && typeof withEnv === "object" && !Array.isArray(withEnv)) {
    const vars = withEnv as Record<string, unknown>;
    for (const key of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "XAI_API_KEY",
      "XAI_BASE_URL",
      "DASHSCOPE_API_KEY",
      "DASHSCOPE_BASE_URL",
    ]) {
      setRuntimeEnv(env, key, vars[key]);
    }
  }

  const providerUnset = provider.length === 0;
  const isYandex = provider.includes("yandex");
  const isAnthropic = provider.includes("anthropic");
  const isOpenAi =
    isYandex ||
    provider.includes("openai") ||
    provider.includes("openai-compatible") ||
    provider.includes("deepseek") ||
    model.includes("deepseek") ||
    (providerUnset &&
      (model.startsWith("gpt-") ||
        model.startsWith("o1") ||
        model.startsWith("o3") ||
        model.startsWith("o4")));
  const isXai =
    provider.includes("xai") ||
    provider.includes("grok") ||
    (providerUnset && model.includes("grok"));
  const isDashscope =
    provider.includes("dashscope") ||
    provider === "qwen" ||
    provider === "kimi" ||
    (providerUnset && (model.startsWith("qwen") || model.startsWith("kimi")));

  if (isAnthropic) {
    setRuntimeEnv(env, "ANTHROPIC_API_KEY", record.apiKey);
    setRuntimeEnv(env, "ANTHROPIC_BASE_URL", record.apiBase ?? record.baseUrl);
  } else if (isOpenAi) {
    if (isYandex) {
      setRuntimeEnv(env, "YANDEX_API_KEY", record.apiKey);
      setRuntimeEnv(
        env,
        "YANDEX_BASE_URL",
        record.apiBase ?? record.baseUrl ?? YANDEX_OPENAI_BASE_URL,
      );
      setRuntimeEnv(env, "YANDEX_FOLDER_ID", record.folderId);
      setRuntimeEnv(
        env,
        "YANDEX_FOLDER_ID",
        (record.requestOptions as any)?.extraBodyProperties?.folderId,
      );
    } else {
      setRuntimeEnv(env, "OPENAI_API_KEY", record.apiKey);
      setRuntimeEnv(
        env,
        "OPENAI_BASE_URL",
        provider.includes("deepseek") || model.includes("deepseek")
          ? (record.apiBase ?? record.baseUrl ?? "https://api.deepseek.com/v1")
          : (record.apiBase ?? record.baseUrl),
      );
    }
  } else if (isXai) {
    setRuntimeEnv(env, "XAI_API_KEY", record.apiKey);
    setRuntimeEnv(env, "XAI_BASE_URL", record.apiBase ?? record.baseUrl);
  } else if (isDashscope) {
    setRuntimeEnv(env, "DASHSCOPE_API_KEY", record.apiKey);
    setRuntimeEnv(env, "DASHSCOPE_BASE_URL", record.apiBase ?? record.baseUrl);
  }

  Object.values(record).forEach((item) =>
    collectRuntimeEnvFromObject(item, env),
  );
}

function getConfiguredRuntimeModelOverride() {
  const configured = vscode.workspace
    .getConfiguration("xynapse")
    .get<string>("runtimeModel")
    ?.trim();

  if (!configured || configured.toLowerCase() === "auto") {
    return undefined;
  }

  return configured;
}

async function collectRuntimeEnv(configHandler: ConfigHandler) {
  await configHandler.isInitialized;
  const { config } = await configHandler.loadConfig();
  return config ? (planResolvedRuntimeModel(config)?.env ?? {}) : {};
}

function collectRuntimeEnvFromLocalFiles(preferredModel?: ILLM) {
  const env: Record<string, string> = {};

  collectRuntimeEnvFromObject(preferredModel, env);

  for (const configPath of [getConfigYamlPath("vscode"), getConfigJsonPath()]) {
    try {
      if (!fs.existsSync(configPath)) {
        continue;
      }
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = configPath.endsWith(".json")
        ? JSON.parse(raw)
        : YAML.parse(raw);
      collectRuntimeEnvFromObject(parsed, env);
    } catch (error) {
      console.warn(
        "Could not read local model configuration for the environment bridge.",
      );
    }
  }

  return env;
}

async function getRuntimeRunPlan(
  configHandler: ConfigHandler,
  request?: RuntimePromptRequest,
): Promise<RuntimeRunPlan | undefined> {
  await configHandler.isInitialized;
  let config: any;
  try {
    ({ config } = await configHandler.loadConfig());
  } catch {
    throw new PublicError(
      "Could not load the active model configuration. Fix its configuration errors before starting the runtime.",
    );
  }
  if (!config)
    throw new PublicError(
      "The active model configuration is not ready. Check its errors and try again.",
    );
  return planResolvedRuntimeModel(
    config,
    typeof request === "object" ? request : {},
    getConfiguredRuntimeModelOverride(),
  );
}

function quotePowerShellArg(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function quotePosixShellArg(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function quoteTerminalArg(value: string) {
  return process.platform === "win32"
    ? quotePowerShellArg(value)
    : quotePosixShellArg(value);
}

const ENVIRONMENT_REPO_URL =
  "https://github.com/Alishahryar1/free-claude-code.git";
const ENVIRONMENT_DIR_NAME = "environment";
const ENVIRONMENT_UPSTREAM_DIR_NAME = "upstream";
const ENVIRONMENT_SUPPORTED_PROVIDERS = [
  "nvidia_nim",
  "open_router",
  "deepseek",
  "lmstudio",
  "llamacpp",
  "ollama",
  "kimi",
  "wafer",
  "opencode",
  "zai",
  "fireworks",
];

type EnvironmentProviderDescriptor = {
  id: string;
  label: string;
  credentialEnv?: string;
  baseUrlEnv?: string;
  defaultModel: string;
  defaultBaseUrl?: string;
};

const ENVIRONMENT_PROVIDER_DESCRIPTORS: EnvironmentProviderDescriptor[] = [
  {
    id: "nvidia_nim",
    label: "NVIDIA NIM",
    credentialEnv: "NVIDIA_NIM_API_KEY",
    defaultModel: "nvidia_nim/z-ai/glm4.7",
  },
  {
    id: "open_router",
    label: "OpenRouter",
    credentialEnv: "OPENROUTER_API_KEY",
    defaultModel: "open_router/anthropic/claude-sonnet-4.5",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    credentialEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek/deepseek-chat",
  },
  {
    id: "kimi",
    label: "Kimi",
    credentialEnv: "KIMI_API_KEY",
    defaultModel: "kimi/moonshot-v1-128k",
  },
  {
    id: "wafer",
    label: "Wafer",
    credentialEnv: "WAFER_API_KEY",
    defaultModel: "wafer/DeepSeek-V4-Pro",
  },
  {
    id: "opencode",
    label: "OpenCode Zen",
    credentialEnv: "OPENCODE_API_KEY",
    defaultModel: "opencode/gpt-5.3-codex",
  },
  {
    id: "zai",
    label: "Z.ai",
    credentialEnv: "ZAI_API_KEY",
    defaultModel: "zai/glm-5.1",
  },
  {
    id: "fireworks",
    label: "Fireworks",
    credentialEnv: "FIREWORKS_API_KEY",
    defaultModel: "fireworks/accounts/fireworks/models/kimi-k2p6",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    baseUrlEnv: "LM_STUDIO_BASE_URL",
    defaultBaseUrl: "http://localhost:1234/v1",
    defaultModel: "lmstudio/local-model",
  },
  {
    id: "llamacpp",
    label: "llama.cpp",
    baseUrlEnv: "LLAMACPP_BASE_URL",
    defaultBaseUrl: "http://localhost:8080/v1",
    defaultModel: "llamacpp/local-model",
  },
  {
    id: "ollama",
    label: "Ollama",
    baseUrlEnv: "OLLAMA_BASE_URL",
    defaultBaseUrl: "http://localhost:11434",
    defaultModel: "ollama/llama3.1",
  },
];

type ExternalEnvironmentRootResolution = {
  root?: string;
  parent?: string;
  home?: string;
  layout?: "portable" | "global" | "dev-external";
  error?: string;
};

type EnvironmentPtySession = {
  cwd: string;
  process: any;
  role: "client" | "server" | "task";
  runId: string;
};

const environmentPtySessions = new Map<string, EnvironmentPtySession>();
const environmentIntegratedTerminalSessions = new Map<
  string,
  vscode.Terminal
>();
let environmentTerminalCloseListenerRegistered = false;

type XynapseEnvironmentBridgeConfig = {
  apiKey: string;
  baseUrl: string;
  folderId: string;
  model: string;
  modelUri: string;
  sourceLabel: string;
};

let xynapseEnvironmentBridgeServer: http.Server | undefined;
let xynapseEnvironmentBridgeBaseUrl: string | undefined;
let xynapseEnvironmentBridgeConfig: XynapseEnvironmentBridgeConfig | undefined;

function ensureEnvironmentTerminalCloseListener(
  extensionContext: vscode.ExtensionContext,
) {
  if (environmentTerminalCloseListenerRegistered) {
    return;
  }

  environmentTerminalCloseListenerRegistered = true;
  extensionContext.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      for (const [runId, candidate] of environmentIntegratedTerminalSessions) {
        if (candidate === terminal) {
          environmentIntegratedTerminalSessions.delete(runId);
        }
      }
    }),
  );
}

function loadEnvironmentNativeModule<T>(id: string): T | null {
  try {
    return require(`${vscode.env.appRoot}/node_modules.asar/${id}`);
  } catch (_error) {
    // The Windows build keeps native modules unpacked under node_modules.
  }

  try {
    return require(`${vscode.env.appRoot}/node_modules/${id}`);
  } catch (_error) {
    return null;
  }
}

function isDirectory(pathValue: string | undefined) {
  if (!pathValue) {
    return false;
  }
  try {
    return fs.statSync(pathValue).isDirectory();
  } catch (_error) {
    return false;
  }
}

function getXynapsePortableDataPath() {
  const candidates = [
    process.env.VSCODE_PORTABLE,
    process.env.VSCODE_PORTABLE_DATA_PATH,
    process.execPath
      ? path.join(path.dirname(process.execPath), "data")
      : undefined,
  ];

  return candidates.find(isDirectory);
}

function getDefaultEnvironmentHome() {
  const portableDataPath = getXynapsePortableDataPath();
  if (portableDataPath) {
    return path.join(portableDataPath, ".xynapse", ENVIRONMENT_DIR_NAME);
  }

  return path.join(getXynapseGlobalPath(), ENVIRONMENT_DIR_NAME);
}

function getPortableOrGlobalEnvironmentRoot() {
  return path.join(getDefaultEnvironmentHome(), ENVIRONMENT_UPSTREAM_DIR_NAME);
}

function findDevExternalEnvironmentParent(
  extensionContext: vscode.ExtensionContext,
) {
  const startPoints = [
    extensionContext.extensionPath,
    process.cwd(),
    ...(vscode.workspace.workspaceFolders ?? []).map(
      (folder) => folder.uri.fsPath,
    ),
  ].filter((value): value is string => Boolean(value));
  const visited = new Set<string>();

  for (const start of startPoints) {
    let current = path.resolve(start);
    while (!visited.has(current)) {
      visited.add(current);
      const externalDir = path.join(current, ".external");
      if (isDirectory(externalDir)) {
        return externalDir;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
}

function resolveExternalEnvironmentRoot(
  extensionContext: vscode.ExtensionContext,
): ExternalEnvironmentRootResolution {
  const portableDataPath = getXynapsePortableDataPath();
  const devExternalParent = portableDataPath
    ? undefined
    : findDevExternalEnvironmentParent(extensionContext);
  const home = devExternalParent ?? getDefaultEnvironmentHome();
  const root = devExternalParent
    ? path.join(devExternalParent, ENVIRONMENT_DIR_NAME)
    : getPortableOrGlobalEnvironmentRoot();
  const parent = path.dirname(root);
  const layout = devExternalParent
    ? "dev-external"
    : portableDataPath
      ? "portable"
      : "global";

  if (!fs.existsSync(root)) {
    return {
      home,
      parent,
      root,
      layout,
      error: "The upstream Environment checkout is not installed yet.",
    };
  }

  if (!fs.existsSync(path.join(root, "pyproject.toml"))) {
    return {
      home,
      parent,
      root,
      layout,
      error:
        "The Environment directory exists, but it is not the upstream free-claude-code project.",
    };
  }

  return { home, parent, root, layout };
}

function normalizeEnvironmentClientPermissionMode(
  request?: EnvironmentOpenRequest,
): "default" | "plan" | "acceptEdits" | "dontAsk" | "bypassPermissions" {
  const requested = request?.permissionMode;
  if (
    requested === "default" ||
    requested === "plan" ||
    requested === "acceptEdits" ||
    requested === "dontAsk" ||
    requested === "bypassPermissions"
  ) {
    return requested;
  }

  return "default";
}

function commandExists(command: string) {
  if (getWindowsCommandCandidatePaths(command).length > 0) {
    return true;
  }

  const checker = process.platform === "win32" ? "where.exe" : "which";
  const env = { ...process.env };
  applyRuntimePathFixes(env);
  const result = spawnSync(checker, [command], {
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  return result.status === 0;
}

function getUvPython314Path() {
  if (!commandExists("uv")) {
    return undefined;
  }

  const env = { ...process.env };
  applyRuntimePathFixes(env);
  const result = spawnSync("uv", ["python", "find", "3.14"], {
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  if (result.status !== 0) {
    return undefined;
  }

  const pythonPath = String(result.stdout ?? "").trim();
  return pythonPath && fs.existsSync(pythonPath) ? pythonPath : undefined;
}

function executableReportsPython314(pythonPath: string) {
  const result = spawnSync(pythonPath, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return false;
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.includes("3.14");
}

function getEnvironmentToolPythonPath() {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(
            getEnvironmentUvToolDir(),
            "free-claude-code",
            "Scripts",
            "python.exe",
          ),
          path.join(
            process.env.APPDATA ?? "",
            "uv",
            "tools",
            "free-claude-code",
            "Scripts",
            "python.exe",
          ),
        ]
      : [
          path.join(
            getEnvironmentUvToolDir(),
            "free-claude-code",
            "bin",
            "python",
          ),
          path.join(
            process.env.HOME ?? "",
            ".local",
            "share",
            "uv",
            "tools",
            "free-claude-code",
            "bin",
            "python",
          ),
        ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function isFreeClaudeCodePackageImportable() {
  const pythonPath = getEnvironmentToolPythonPath();
  if (!pythonPath) {
    return false;
  }

  const result = spawnSync(pythonPath, ["-c", "import cli.entrypoints"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0;
}

function isEnvironmentClientInstalled() {
  return commandExists("fcc-claude") && isFreeClaudeCodePackageImportable();
}

function isEnvironmentRuntimeInstalled() {
  return (
    commandExists("fcc-server") &&
    commandExists("fcc-claude") &&
    isFreeClaudeCodePackageImportable()
  );
}

function runEnvironmentSync(
  command: string,
  args: string[],
  cwd?: string,
): string | undefined {
  const env = { ...process.env };
  applyRuntimePathFixes(env);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  if (result.status !== 0) {
    return undefined;
  }
  return String(result.stdout ?? "").trim();
}

function getEnvironmentGitCommit(root: string) {
  return runEnvironmentSync("git", [
    "-C",
    root,
    "rev-parse",
    "--short",
    "HEAD",
  ]);
}

function isEnvironmentGitDirty(root: string) {
  const status = runEnvironmentSync("git", ["-C", root, "status", "--short"]);
  return Boolean(status);
}

function hasPython314() {
  const env = { ...process.env };
  applyRuntimePathFixes(env);
  const uvPython = getUvPython314Path();
  if (uvPython && executableReportsPython314(uvPython)) {
    return true;
  }

  if (
    spawnSync("py", ["-3.14", "--version"], {
      encoding: "utf8",
      env,
      windowsHide: true,
    }).status === 0
  ) {
    return true;
  }

  return commandExists(
    process.platform === "win32" ? "python3.14.exe" : "python3.14",
  );
}

function setEnvironmentProviderEnv(
  env: Record<string, string>,
  key: string,
  value: unknown,
) {
  if (process.env[key] || env[key] || !isUsableSecret(value)) {
    return;
  }
  env[key] = value.trim();
}

function collectEnvironmentProviderEnvFromObject(
  value: unknown,
  env: Record<string, string>,
) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectEnvironmentProviderEnvFromObject(item, env));
    return;
  }

  const record = value as Record<string, unknown>;
  const provider = normalizeXynapseEnvironmentProviderName(
    record.providerName ?? record.provider ?? record.name ?? record.uses,
  );
  const model = String(record.model ?? record.title ?? "").toLowerCase();
  const withEnv = record.with;

  if (withEnv && typeof withEnv === "object" && !Array.isArray(withEnv)) {
    const vars = withEnv as Record<string, unknown>;
    for (const key of [
      "NVIDIA_NIM_API_KEY",
      "OPENROUTER_API_KEY",
      "DEEPSEEK_API_KEY",
      "KIMI_API_KEY",
      "WAFER_API_KEY",
      "OPENCODE_API_KEY",
      "ZAI_API_KEY",
      "FIREWORKS_API_KEY",
      "LM_STUDIO_BASE_URL",
      "LLAMACPP_BASE_URL",
      "OLLAMA_BASE_URL",
    ]) {
      setEnvironmentProviderEnv(env, key, vars[key]);
    }
  }

  if (provider.includes("openrouter") || provider.includes("open-router")) {
    setEnvironmentProviderEnv(env, "OPENROUTER_API_KEY", record.apiKey);
  } else if (provider.includes("deepseek") || model.includes("deepseek")) {
    setEnvironmentProviderEnv(env, "DEEPSEEK_API_KEY", record.apiKey);
  } else if (provider.includes("kimi") || provider.includes("moonshot")) {
    setEnvironmentProviderEnv(env, "KIMI_API_KEY", record.apiKey);
  } else if (provider.includes("fireworks")) {
    setEnvironmentProviderEnv(env, "FIREWORKS_API_KEY", record.apiKey);
  } else if (provider === "zai" || provider.includes("z.ai")) {
    setEnvironmentProviderEnv(env, "ZAI_API_KEY", record.apiKey);
  } else if (provider.includes("nvidia")) {
    setEnvironmentProviderEnv(env, "NVIDIA_NIM_API_KEY", record.apiKey);
  } else if (provider.includes("wafer")) {
    setEnvironmentProviderEnv(env, "WAFER_API_KEY", record.apiKey);
  } else if (provider.includes("opencode")) {
    setEnvironmentProviderEnv(env, "OPENCODE_API_KEY", record.apiKey);
  }

  Object.values(record).forEach((item) =>
    collectEnvironmentProviderEnvFromObject(item, env),
  );
}

function collectEnvironmentProviderEnvFromLocalFiles() {
  const env: Record<string, string> = {};

  for (const configPath of [getConfigYamlPath("vscode"), getConfigJsonPath()]) {
    try {
      if (!fs.existsSync(configPath)) {
        continue;
      }
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = configPath.endsWith(".json")
        ? JSON.parse(raw)
        : YAML.parse(raw);
      collectEnvironmentProviderEnvFromObject(parsed, env);
    } catch (error) {
      console.warn(
        `Failed to scan ${configPath} for Environment provider env`,
        error,
      );
    }
  }

  return env;
}

function getEnvironmentManagedEnvPath() {
  return path.join(getDefaultEnvironmentHome(), "environment.env");
}

function getLegacyEnvironmentManagedEnvPath() {
  return path.join(getXynapseGlobalPath(), "environment.env");
}

function parseDotEnvText(raw: string) {
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readEnvironmentManagedEnv() {
  const envPath = fs.existsSync(getEnvironmentManagedEnvPath())
    ? getEnvironmentManagedEnvPath()
    : getLegacyEnvironmentManagedEnvPath();
  if (!fs.existsSync(envPath)) {
    return {};
  }
  try {
    return parseDotEnvText(fs.readFileSync(envPath, "utf8"));
  } catch (_error) {
    return {};
  }
}

function quoteDotEnvValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function getEnvironmentProviderDescriptor(providerId?: string) {
  return (
    ENVIRONMENT_PROVIDER_DESCRIPTORS.find(
      (provider) => provider.id === providerId,
    ) ?? ENVIRONMENT_PROVIDER_DESCRIPTORS[0]
  );
}

function getSavedEnvironmentProviderId(values = readEnvironmentManagedEnv()) {
  const savedProvider = values.FCC_PROVIDER?.trim();
  if (
    savedProvider &&
    ENVIRONMENT_PROVIDER_DESCRIPTORS.some(
      (provider) => provider.id === savedProvider,
    )
  ) {
    return savedProvider;
  }

  const modelProvider = values.MODEL?.split("/", 1)[0]?.trim();
  if (
    modelProvider &&
    ENVIRONMENT_PROVIDER_DESCRIPTORS.some(
      (provider) => provider.id === modelProvider,
    )
  ) {
    return modelProvider;
  }

  return ENVIRONMENT_PROVIDER_DESCRIPTORS[0].id;
}

function getEnvironmentConfigStatus(values = readEnvironmentManagedEnv()) {
  const discovered = collectEnvironmentProviderEnvFromLocalFiles();
  const provider = getEnvironmentProviderDescriptor(
    getSavedEnvironmentProviderId(values),
  );
  const model = values.MODEL?.trim() || provider.defaultModel;
  const configuredCredential = provider.credentialEnv
    ? Boolean(
        values[provider.credentialEnv]?.trim() ||
          discovered[provider.credentialEnv]?.trim() ||
          process.env[provider.credentialEnv]?.trim(),
      )
    : true;
  const baseUrl = provider.baseUrlEnv
    ? values[provider.baseUrlEnv]?.trim() ||
      discovered[provider.baseUrlEnv]?.trim() ||
      provider.defaultBaseUrl
    : undefined;

  return {
    environmentProvider: provider.id,
    environmentProviderLabel: provider.label,
    environmentModel: model,
    environmentSourceLabel: values.XYNAPSE_SOURCE_MODEL?.trim() || undefined,
    environmentCredentialEnv: provider.credentialEnv,
    environmentApiKeyConfigured: configuredCredential,
    environmentBaseUrl: baseUrl,
  };
}

function writeEnvironmentManagedEnv(
  provider: EnvironmentProviderDescriptor,
  values: {
    model: string;
    apiKey?: string;
    baseUrl?: string;
    sourceLabel?: string;
  },
) {
  const existing = readEnvironmentManagedEnv();
  const next: Record<string, string> = {
    ...existing,
    FCC_PROVIDER: provider.id,
    MODEL: values.model,
    MODEL_OPUS: values.model,
    MODEL_SONNET: values.model,
    MODEL_HAIKU: values.model,
    XYNAPSE_SOURCE_MODEL: values.sourceLabel || values.model,
    FCC_OPEN_BROWSER: "false",
    MESSAGING_PLATFORM: "none",
    VOICE_NOTE_ENABLED: "false",
    WHISPER_DEVICE: "cpu",
    ENABLE_WEB_SERVER_TOOLS: "false",
    ENABLE_MODEL_THINKING: "false",
    ENABLE_OPUS_THINKING: "false",
    ENABLE_SONNET_THINKING: "false",
    ENABLE_HAIKU_THINKING: "false",
    HTTP_READ_TIMEOUT: "600",
    HTTP_WRITE_TIMEOUT: "120",
    HTTP_CONNECT_TIMEOUT: "60",
    ANTHROPIC_AUTH_TOKEN: existing.ANTHROPIC_AUTH_TOKEN || "freecc",
  };

  if (provider.credentialEnv && values.apiKey?.trim()) {
    next[provider.credentialEnv] = values.apiKey.trim();
  }
  if (provider.baseUrlEnv) {
    next[provider.baseUrlEnv] =
      values.baseUrl?.trim() || provider.defaultBaseUrl || "";
  }

  const preferredOrder = [
    "FCC_PROVIDER",
    "MODEL",
    "MODEL_OPUS",
    "MODEL_SONNET",
    "MODEL_HAIKU",
    "XYNAPSE_SOURCE_MODEL",
    "NVIDIA_NIM_API_KEY",
    "OPENROUTER_API_KEY",
    "DEEPSEEK_API_KEY",
    "KIMI_API_KEY",
    "WAFER_API_KEY",
    "OPENCODE_API_KEY",
    "ZAI_API_KEY",
    "FIREWORKS_API_KEY",
    "LM_STUDIO_BASE_URL",
    "LLAMACPP_BASE_URL",
    "OLLAMA_BASE_URL",
    "FCC_OPEN_BROWSER",
    "MESSAGING_PLATFORM",
    "VOICE_NOTE_ENABLED",
    "WHISPER_DEVICE",
    "ENABLE_WEB_SERVER_TOOLS",
    "ENABLE_MODEL_THINKING",
    "ENABLE_OPUS_THINKING",
    "ENABLE_SONNET_THINKING",
    "ENABLE_HAIKU_THINKING",
    "HTTP_READ_TIMEOUT",
    "HTTP_WRITE_TIMEOUT",
    "HTTP_CONNECT_TIMEOUT",
    "ANTHROPIC_AUTH_TOKEN",
  ];
  const keys = [
    ...preferredOrder.filter((key) => key in next),
    ...Object.keys(next)
      .filter((key) => !preferredOrder.includes(key))
      .sort(),
  ];
  const lines = [
    "# Managed by Xynapse Environment. This file belongs to the current Xynapse data profile.",
    ...keys.map((key) => `${key}=${quoteDotEnvValue(next[key] ?? "")}`),
    "",
  ];
  fs.mkdirSync(path.dirname(getEnvironmentManagedEnvPath()), {
    recursive: true,
  });
  fs.writeFileSync(getEnvironmentManagedEnvPath(), lines.join("\n"), "utf8");
  setConfigFilePermissions(getEnvironmentManagedEnvPath());
}

function applyEnvironmentManagedEnv(env: Record<string, string | undefined>) {
  const managedEnvPath = getEnvironmentManagedEnvPath();
  const managed = readEnvironmentManagedEnv();
  for (const [key, value] of Object.entries(managed)) {
    env[key] = value;
  }
  env.FCC_ENV_FILE = managedEnvPath;
  env.FCC_OPEN_BROWSER = "false";
  env.MESSAGING_PLATFORM = env.MESSAGING_PLATFORM || "none";
  env.VOICE_NOTE_ENABLED = env.VOICE_NOTE_ENABLED || "false";
  env.WHISPER_DEVICE = env.WHISPER_DEVICE || "cpu";
  return env;
}

function getEnvironmentProjectStateRoot(cwd?: string) {
  return cwd ? path.join(cwd, ".xynapse", ENVIRONMENT_DIR_NAME) : undefined;
}

function ensureEnvironmentProjectStateRoot(cwd?: string) {
  const projectStateRoot = getEnvironmentProjectStateRoot(cwd);
  if (projectStateRoot) {
    fs.mkdirSync(projectStateRoot, { recursive: true });
  }
  return projectStateRoot;
}

function buildExternalEnvironmentEnv(
  projectStateRoot?: string,
  upstreamRoot?: string,
) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    FCC_OPEN_BROWSER: "false",
    ...collectEnvironmentProviderEnvFromLocalFiles(),
  };
  env.XYNAPSE_ENVIRONMENT_HOME = getDefaultEnvironmentHome();
  env.XYNAPSE_ENVIRONMENT_UPSTREAM =
    upstreamRoot ?? getPortableOrGlobalEnvironmentRoot();
  if (projectStateRoot) {
    env.XYNAPSE_ENVIRONMENT_PROJECT_STATE = projectStateRoot;
  }
  applyEnvironmentManagedEnv(env);
  applyRuntimePathFixes(env);
  return env;
}

function stripAnsiForEnvironment(text: string) {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function sendEnvironmentEvent(
  sidebar: XynapseGUIWebviewViewProvider,
  event: {
    runId: string;
    kind: "start" | "chunk" | "end" | "error";
    stream?: "stdout" | "stderr" | "system";
    text?: string;
    title?: string;
    cwd?: string;
    command?: string;
    exitCode?: number | null;
  },
) {
  sidebar.webviewProtocol?.send("xynapse/environmentEvent", event);
}

function buildEnvironmentUvShellSetup() {
  if (process.platform === "win32") {
    return [
      `$env:UV_TOOL_DIR = ${quotePowerShellArg(getEnvironmentUvToolDir())}`,
      `$env:UV_TOOL_BIN_DIR = ${quotePowerShellArg(getEnvironmentUvToolBinDir())}`,
      `$env:UV_PYTHON_INSTALL_DIR = ${quotePowerShellArg(getEnvironmentUvPythonInstallDir())}`,
      `$env:UV_CACHE_DIR = ${quotePowerShellArg(getEnvironmentUvCacheDir())}`,
      "New-Item -ItemType Directory -Force -Path $env:UV_TOOL_DIR,$env:UV_TOOL_BIN_DIR,$env:UV_PYTHON_INSTALL_DIR,$env:UV_CACHE_DIR | Out-Null",
      `$env:Path = ${quotePowerShellArg(getEnvironmentUvToolBinDir())} + ';' + "$env:USERPROFILE\\.local\\bin;$env:USERPROFILE\\AppData\\Roaming\\Python\\Python314\\Scripts;" + $env:Path`,
    ].join("; ");
  }

  return [
    `export UV_TOOL_DIR=${quotePosixShellArg(getEnvironmentUvToolDir())}`,
    `export UV_TOOL_BIN_DIR=${quotePosixShellArg(getEnvironmentUvToolBinDir())}`,
    `export UV_PYTHON_INSTALL_DIR=${quotePosixShellArg(getEnvironmentUvPythonInstallDir())}`,
    `export UV_CACHE_DIR=${quotePosixShellArg(getEnvironmentUvCacheDir())}`,
    'mkdir -p "$UV_TOOL_DIR" "$UV_TOOL_BIN_DIR" "$UV_PYTHON_INSTALL_DIR" "$UV_CACHE_DIR"',
    `export PATH=${quotePosixShellArg(getEnvironmentUvToolBinDir())}:$HOME/.local/bin:$PATH`,
  ].join("; ");
}

function buildEnvironmentInstallCommand() {
  if (process.platform === "win32") {
    return [
      "$ErrorActionPreference = 'Stop'",
      buildEnvironmentUvShellSetup(),
      "if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { irm https://astral.sh/uv/install.ps1 | iex }",
      buildEnvironmentUvShellSetup(),
      "uv python install 3.14",
      "$toolPython = Join-Path $env:UV_TOOL_DIR 'free-claude-code\\Scripts\\python.exe'",
      "$hasCommands = (Get-Command fcc-server -ErrorAction SilentlyContinue) -and (Get-Command fcc-claude -ErrorAction SilentlyContinue)",
      "$hasPackage = $false",
      "if (Test-Path $toolPython) { & $toolPython -c 'import cli.entrypoints' 2>$null; $hasPackage = ($LASTEXITCODE -eq 0) }",
      `if ($hasCommands -and $hasPackage) { Write-Output 'Environment runtime already installed.' } else { uv tool install --force git+${ENVIRONMENT_REPO_URL} }`,
    ].join("; ");
  }

  return [
    "set -e",
    buildEnvironmentUvShellSetup(),
    "command -v uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh",
    buildEnvironmentUvShellSetup(),
    "uv python install 3.14",
    `if command -v fcc-server >/dev/null 2>&1 && command -v fcc-claude >/dev/null 2>&1 && "$UV_TOOL_DIR/free-claude-code/bin/python" -c 'import cli.entrypoints' >/dev/null 2>&1; then echo 'Environment runtime already installed.'; else uv tool install --force git+${ENVIRONMENT_REPO_URL}; fi`,
  ].join("; ");
}

function buildEnvironmentUpdateCommand(root: string) {
  const pull = `git -C ${quoteTerminalArg(root)} pull --ff-only`;
  const reinstall =
    process.platform === "win32"
      ? `if (Get-Command uv -ErrorAction SilentlyContinue) { uv tool install --force git+${ENVIRONMENT_REPO_URL} }`
      : `command -v uv >/dev/null 2>&1 && uv tool install --force git+${ENVIRONMENT_REPO_URL}`;
  return `${buildEnvironmentUvShellSetup()}; ${pull}; ${reinstall}`;
}

function buildEnvironmentServerCommand(root: string) {
  if (process.platform === "win32") {
    return [
      `$env:FCC_OPEN_BROWSER = 'false'`,
      `Set-Location ${quoteTerminalArg(root)}`,
      "fcc-server",
    ].join("; ");
  }
  return `export FCC_OPEN_BROWSER=false; cd ${quoteTerminalArg(root)}; fcc-server`;
}

function buildEnvironmentClientCommand(request?: EnvironmentOpenRequest) {
  const permissionMode = normalizeEnvironmentClientPermissionMode(request);
  return `fcc-claude --permission-mode ${quoteTerminalArg(permissionMode)}`;
}

function startEnvironmentPty(
  sidebar: XynapseGUIWebviewViewProvider,
  options: {
    command: string;
    cwd: string;
    role?: "client" | "server" | "task";
    runId: string;
    title: string;
    projectStateRoot?: string;
    upstreamRoot?: string;
    visible?: boolean;
  },
): EnvironmentOpenResponse {
  const pty = loadEnvironmentNativeModule<any>("node-pty");
  if (!pty?.spawn) {
    return {
      ok: false,
      message: "Embedded terminal support is not available in this IDE build.",
      cwd: options.cwd,
      runId: options.runId,
    };
  }

  const existing = environmentPtySessions.get(options.runId);
  if (existing) {
    return {
      ok: true,
      message: "Environment session is already running.",
      cwd: existing.cwd,
      runId: existing.runId,
    };
  }

  const shellPath =
    process.platform === "win32"
      ? "powershell.exe"
      : process.env.SHELL || "/bin/bash";
  const shellArgs = process.platform === "win32" ? ["-NoLogo"] : ["-l"];

  let ptyProcess: any;
  try {
    ptyProcess = pty.spawn(shellPath, shellArgs, {
      name: "xterm-256color",
      cols: 140,
      rows: 32,
      cwd: options.cwd,
      env: buildExternalEnvironmentEnv(
        options.projectStateRoot,
        options.upstreamRoot,
      ),
      useConpty: process.platform === "win32",
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Could not start embedded Environment terminal.",
      cwd: options.cwd,
      runId: options.runId,
    };
  }

  environmentPtySessions.set(options.runId, {
    cwd: options.cwd,
    process: ptyProcess,
    role: options.role ?? "task",
    runId: options.runId,
  });

  const visible = options.visible ?? true;

  if (visible) {
    sendEnvironmentEvent(sidebar, {
      runId: options.runId,
      kind: "start",
      stream: "system",
      title: options.title,
      cwd: options.cwd,
      command: options.command,
      text: `${options.title}\n> ${options.command}\n`,
    });
  }

  ptyProcess.onData((data: string) => {
    if (visible) {
      sendEnvironmentEvent(sidebar, {
        runId: options.runId,
        kind: "chunk",
        stream: "stdout",
        text: stripAnsiForEnvironment(data),
      });
    }
  });

  ptyProcess.onExit((event: { exitCode?: number }) => {
    environmentPtySessions.delete(options.runId);
    if (visible) {
      sendEnvironmentEvent(sidebar, {
        runId: options.runId,
        kind: "end",
        stream: "system",
        exitCode: event.exitCode ?? null,
        text: `\nEnvironment process exited with code ${event.exitCode ?? "unknown"}\n`,
      });
    }
  });

  ptyProcess.write(`${options.command}\r`);

  return {
    ok: true,
    message: visible
      ? "Environment coding session started in this tab."
      : "Environment proxy server started in the background.",
    cwd: options.cwd,
    runId: options.runId,
  };
}

function getEnvironmentServerSession(root?: string) {
  if (!root) {
    return undefined;
  }
  return Array.from(environmentPtySessions.values()).find(
    (session) => session.role === "server" && session.cwd === root,
  );
}

function getLatestEnvironmentClientSession() {
  const entries = Array.from(environmentIntegratedTerminalSessions.entries());
  return entries[entries.length - 1];
}

function getEnvironmentSessionStatus(root?: string) {
  const server = getEnvironmentServerSession(root);
  const client = getLatestEnvironmentClientSession();
  return {
    serverRunning: Boolean(server),
    serverRunId: server?.runId,
    clientRunning: Boolean(client),
    clientRunId: client?.[0],
  };
}

function startEnvironmentServerIfNeeded(
  sidebar: XynapseGUIWebviewViewProvider,
  root: string,
  runId: string,
  projectStateRoot?: string,
) {
  const existing = getEnvironmentServerSession(root);
  if (existing) {
    return {
      ok: true,
      message: "Environment proxy server is already running in the background.",
      cwd: existing.cwd,
      runId: existing.runId,
      serverRunning: true,
      serverRunId: existing.runId,
    };
  }

  const started = startEnvironmentPty(sidebar, {
    runId,
    cwd: root,
    role: "server",
    visible: false,
    title: "Start upstream proxy server",
    command: buildEnvironmentServerCommand(root),
    projectStateRoot,
    upstreamRoot: root,
  });

  return {
    ...started,
    serverRunning: started.ok,
    serverRunId: started.ok ? started.runId : undefined,
  };
}

function startEnvironmentIntegratedTerminal(
  request: EnvironmentOpenRequest,
  options: {
    cwd: string;
    projectStateRoot?: string;
    runId: string;
    upstreamRoot?: string;
  },
): EnvironmentOpenResponse {
  const existing = environmentIntegratedTerminalSessions.get(options.runId);
  if (existing) {
    existing.show(false);
    return {
      ok: true,
      message: "Environment coding terminal is already open.",
      cwd: options.cwd,
      runId: options.runId,
      clientRunning: true,
      clientRunId: options.runId,
    };
  }

  const command = buildEnvironmentClientCommand(request);
  const terminal = vscode.window.createTerminal({
    name: "Environment",
    cwd: options.cwd,
    env: buildExternalEnvironmentEnv(
      options.projectStateRoot,
      options.upstreamRoot,
    ),
    iconPath: new vscode.ThemeIcon("terminal"),
  });

  environmentIntegratedTerminalSessions.set(options.runId, terminal);
  terminal.show(false);
  terminal.sendText(command, true);

  return {
    ok: true,
    message:
      "Environment coding session opened in the IDE Terminal. Use the terminal panel for prompts and interactive confirmations.",
    cwd: options.cwd,
    runId: options.runId,
    clientRunning: true,
    clientRunId: options.runId,
  };
}

function mapXynapseModelToEnvironmentProvider(
  request?: EnvironmentOpenRequest,
) {
  const provider = normalizeXynapseEnvironmentProviderName(
    request?.environmentProvider,
  );
  const model = String(request?.environmentModel ?? "")
    .toLowerCase()
    .trim();
  const prefix = model.split("/", 1)[0];

  if (
    provider.includes("yandex") ||
    provider.includes("gigachat") ||
    provider.includes("sber")
  ) {
    return undefined;
  }

  if (
    provider.includes("openrouter") ||
    provider.includes("open-router") ||
    prefix === "openrouter" ||
    prefix === "open_router"
  ) {
    return "open_router";
  }
  if (provider.includes("deepseek") || prefix === "deepseek") {
    return "deepseek";
  }
  if (
    provider.includes("kimi") ||
    provider.includes("moonshot") ||
    prefix === "kimi"
  ) {
    return "kimi";
  }
  if (provider.includes("fireworks") || prefix === "fireworks") {
    return "fireworks";
  }
  if (provider === "zai" || provider.includes("z.ai") || prefix === "zai") {
    return "zai";
  }
  if (
    provider.includes("nvidia") ||
    prefix === "nvidia_nim" ||
    prefix === "nvidia"
  ) {
    return "nvidia_nim";
  }
  if (provider.includes("wafer") || prefix === "wafer") {
    return "wafer";
  }
  if (provider.includes("opencode") || prefix === "opencode") {
    return "opencode";
  }
  if (
    provider.includes("lmstudio") ||
    provider.includes("lm-studio") ||
    prefix === "lmstudio"
  ) {
    return "lmstudio";
  }
  if (
    provider.includes("llamacpp") ||
    provider.includes("llama.cpp") ||
    prefix === "llamacpp"
  ) {
    return "llamacpp";
  }
  if (provider.includes("ollama") || prefix === "ollama") {
    return "ollama";
  }

  return undefined;
}

function formatEnvironmentModelRef(providerId: string, model: string) {
  const trimmed = model.trim();
  if (!trimmed) {
    return getEnvironmentProviderDescriptor(providerId).defaultModel;
  }

  const aliases: Record<string, string[]> = {
    open_router: ["openrouter", "open-router", "open_router"],
    nvidia_nim: ["nvidia", "nvidia-nim", "nvidia_nim"],
  };
  const providerAliases = aliases[providerId] ?? [providerId];

  for (const alias of providerAliases) {
    if (trimmed.toLowerCase().startsWith(`${alias.toLowerCase()}/`)) {
      return `${providerId}/${trimmed.slice(alias.length + 1)}`;
    }
  }

  if (trimmed.toLowerCase().startsWith(`${providerId.toLowerCase()}/`)) {
    return trimmed;
  }

  return `${providerId}/${trimmed.replace(/^\/+/, "")}`;
}

function getEnvironmentValueForKey(
  key: string | undefined,
  requestValue: unknown,
  scannedEnv: Record<string, string>,
  savedEnv: Record<string, string>,
) {
  if (!key) {
    return undefined;
  }

  for (const value of [
    requestValue,
    scannedEnv[key],
    savedEnv[key],
    process.env[key],
  ]) {
    const resolved = resolveEnvironmentValue(value);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function resolveEnvironmentValue(value: unknown) {
  if (!isUsableSecret(value)) {
    return undefined;
  }

  const trimmed = value.trim();
  const envMatch =
    /^\$([A-Z_][A-Z0-9_]*)$/i.exec(trimmed) ||
    /^\$\{([A-Z_][A-Z0-9_]*)\}$/i.exec(trimmed);

  if (envMatch) {
    const fromProcess = process.env[envMatch[1]];
    return isUsableSecret(fromProcess) ? fromProcess.trim() : undefined;
  }

  return trimmed;
}

function getEnvironmentSourceLabel(request?: EnvironmentOpenRequest) {
  return (
    request?.environmentModelTitle?.trim() ||
    request?.environmentModel?.trim() ||
    request?.environmentProvider?.trim() ||
    "Xynapse model"
  );
}

function isYandexEnvironmentRequest(request?: EnvironmentOpenRequest) {
  const provider = normalizeXynapseEnvironmentProviderName(
    request?.environmentProvider ?? request?.provider,
  );
  const model = `${request?.environmentModel ?? ""}`.trim().toLowerCase();

  return (
    provider.includes("yandex") ||
    model.startsWith("gpt://") ||
    Boolean(`${request?.environmentFolderId ?? ""}`.trim())
  );
}

function normalizeXynapseEnvironmentProviderName(value: unknown): string {
  return `${value ?? ""}`
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeYandexOpenAiBaseUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed || /foundationmodels/i.test(trimmed)) {
    return YANDEX_OPENAI_BASE_URL;
  }
  return trimmed.replace(/\/chat\/completions\/?$/i, "").replace(/\/+$/, "");
}

function extractAnthropicText(content: any): string {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") {
          return block;
        }
        if (block?.type === "text") {
          return String(block.text ?? "");
        }
        if (block?.type === "tool_result") {
          return extractAnthropicText(block.content);
        }
        if (block?.type === "image" || block?.type === "image_url") {
          return "[image]";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content?.text === "string") {
    return content.text;
  }
  try {
    return JSON.stringify(content);
  } catch (_error) {
    return String(content);
  }
}

function toOpenAiMessagesFromAnthropic(body: any) {
  const messages: any[] = [];
  const systemText = extractAnthropicText(body?.system);
  if (systemText) {
    messages.push({ role: "system", content: systemText });
  }

  for (const raw of Array.isArray(body?.messages) ? body.messages : []) {
    const role = raw?.role === "assistant" ? "assistant" : "user";
    const blocks = Array.isArray(raw?.content) ? raw.content : undefined;

    if (role === "assistant" && blocks) {
      const toolCalls = blocks
        .filter((block: any) => block?.type === "tool_use")
        .map((block: any) => ({
          id: block.id || `toolu_${Date.now()}`,
          type: "function",
          function: {
            name: block.name || "tool",
            arguments:
              typeof block.input === "string"
                ? block.input
                : JSON.stringify(block.input ?? {}),
          },
        }));
      const text = extractAnthropicText(
        blocks.filter((block: any) => block?.type !== "tool_use"),
      );
      messages.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    if (
      role === "user" &&
      blocks?.some((block: any) => block?.type === "tool_result")
    ) {
      const userText = extractAnthropicText(
        blocks.filter((block: any) => block?.type !== "tool_result"),
      );
      if (userText) {
        messages.push({ role: "user", content: userText });
      }
      for (const block of blocks.filter(
        (item: any) => item?.type === "tool_result",
      )) {
        messages.push({
          role: "tool",
          tool_call_id: block.tool_use_id || block.id || "toolu_unknown",
          content: extractAnthropicText(block.content),
        });
      }
      continue;
    }

    messages.push({
      role,
      content: extractAnthropicText(raw?.content),
    });
  }

  return messages;
}

function toOpenAiToolsFromAnthropic(tools: any) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.input_schema ?? {
        type: "object",
        properties: {},
      },
    },
  }));
}

function toOpenAiToolChoiceFromAnthropic(toolChoice: any) {
  if (!toolChoice || toolChoice.type === "auto" || toolChoice.type === "any") {
    return undefined;
  }
  if (toolChoice.type === "none") {
    return "none";
  }
  if (toolChoice.type === "tool" && toolChoice.name) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }
  return undefined;
}

async function readBridgeJsonBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function sendBridgeJson(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}

function writeBridgeSse(
  res: http.ServerResponse,
  event: string,
  data: Record<string, unknown>,
) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function callYandexOpenAiBridge(
  config: XynapseEnvironmentBridgeConfig,
  body: any,
) {
  const tools = toOpenAiToolsFromAnthropic(body?.tools);
  const toolChoice = toOpenAiToolChoiceFromAnthropic(body?.tool_choice);
  const requestedMaxTokens = Number(body?.max_tokens);
  const maxTokens = Number.isFinite(requestedMaxTokens)
    ? Math.max(1, Math.min(requestedMaxTokens, 8192))
    : 8192;
  const requestBody: Record<string, unknown> = {
    model: config.modelUri,
    messages: toOpenAiMessagesFromAnthropic(body),
    max_tokens: maxTokens,
    temperature: Number.isFinite(Number(body?.temperature))
      ? Number(body.temperature)
      : 0.3,
    stream: false,
  };

  if (tools) {
    requestBody.tools = tools;
  }
  if (toolChoice) {
    requestBody.tool_choice = toolChoice;
  }
  if (Number.isFinite(Number(body?.top_p))) {
    requestBody.top_p = Number(body.top_p);
  }
  if (Array.isArray(body?.stop_sequences) && body.stop_sequences.length > 0) {
    requestBody.stop = body.stop_sequences;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Api-Key ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new PublicError(
      `Yandex Cloud API request failed (HTTP ${response.status}). Check provider access and try again.`,
    );
  }

  return response.json();
}

function sendAnthropicBridgeSse(
  res: http.ServerResponse,
  model: string,
  response: any,
) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  writeAnthropicBridgeSseBody(res, model, response);
  res.end();
}

function writeAnthropicBridgeSseBody(
  res: http.ServerResponse,
  model: string,
  response: any,
) {
  const choice = response?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const primaryContent =
    typeof message.content === "string"
      ? message.content
      : extractAnthropicText(message.content);
  const reasoningContent =
    typeof message.reasoning_content === "string"
      ? message.reasoning_content
      : "";
  const content = primaryContent || reasoningContent;
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const usage = response?.usage ?? {};
  const messageId = response?.id || `msg_${Date.now()}`;
  let blockIndex = 0;

  writeBridgeSse(res, "message_start", {
    type: "message_start",
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: usage.prompt_tokens ?? 0,
        output_tokens: 0,
      },
    },
  });

  if (content) {
    writeBridgeSse(res, "content_block_start", {
      type: "content_block_start",
      index: blockIndex,
      content_block: { type: "text", text: "" },
    });
    writeBridgeSse(res, "content_block_delta", {
      type: "content_block_delta",
      index: blockIndex,
      delta: { type: "text_delta", text: content },
    });
    writeBridgeSse(res, "content_block_stop", {
      type: "content_block_stop",
      index: blockIndex,
    });
    blockIndex += 1;
  }

  for (const toolCall of toolCalls) {
    writeBridgeSse(res, "content_block_start", {
      type: "content_block_start",
      index: blockIndex,
      content_block: {
        type: "tool_use",
        id: toolCall.id || `toolu_${Date.now()}_${blockIndex}`,
        name: toolCall.function?.name || "tool",
        input: {},
      },
    });
    writeBridgeSse(res, "content_block_delta", {
      type: "content_block_delta",
      index: blockIndex,
      delta: {
        type: "input_json_delta",
        partial_json: toolCall.function?.arguments || "{}",
      },
    });
    writeBridgeSse(res, "content_block_stop", {
      type: "content_block_stop",
      index: blockIndex,
    });
    blockIndex += 1;
  }

  writeBridgeSse(res, "message_delta", {
    type: "message_delta",
    delta: {
      stop_reason:
        toolCalls.length > 0
          ? "tool_use"
          : !content && choice.finish_reason === "length"
            ? "max_tokens"
            : "end_turn",
      stop_sequence: null,
    },
    usage: {
      output_tokens: usage.completion_tokens ?? 0,
    },
  });
  writeBridgeSse(res, "message_stop", { type: "message_stop" });
}

function writeAnthropicBridgeErrorSseBody(
  res: http.ServerResponse,
  model: string,
  error: unknown,
) {
  const messageId = `msg_${Date.now()}`;
  const text = `Xynapse Environment provider error: ${
    error instanceof Error ? error.message : String(error)
  }`;

  writeBridgeSse(res, "message_start", {
    type: "message_start",
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
  writeBridgeSse(res, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  writeBridgeSse(res, "content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  });
  writeBridgeSse(res, "content_block_stop", {
    type: "content_block_stop",
    index: 0,
  });
  writeBridgeSse(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: Math.max(1, Math.ceil(text.length / 4)) },
  });
  writeBridgeSse(res, "message_stop", { type: "message_stop" });
}

async function sendAnthropicBridgeSseWithKeepalive(
  res: http.ServerResponse,
  model: string,
  completion: Promise<any>,
) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(": xynapse-bridge-start\n\n");
  const keepAlive = setInterval(() => {
    if (!res.destroyed) {
      res.write(": xynapse-bridge-keepalive\n\n");
    }
  }, 15_000);
  try {
    writeAnthropicBridgeSseBody(res, model, await completion);
  } catch (error) {
    writeAnthropicBridgeErrorSseBody(res, model, error);
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
}

async function handleXynapseEnvironmentBridgeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const config = xynapseEnvironmentBridgeConfig;
  if (!config) {
    sendBridgeJson(res, 503, {
      error: "Xynapse Environment bridge is not configured.",
    });
    return;
  }

  const url = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = url.pathname.replace(/\/+$/, "");

  try {
    if (
      req.method === "GET" &&
      (pathname === "/health" || pathname === "/v1/health")
    ) {
      sendBridgeJson(res, 200, { ok: true });
      return;
    }

    if (
      req.method === "GET" &&
      (pathname === "/models" || pathname === "/v1/models")
    ) {
      sendBridgeJson(res, 200, {
        object: "list",
        data: [
          {
            id: config.model,
            object: "model",
            owned_by: "xynapse",
          },
        ],
      });
      return;
    }

    if (
      req.method === "POST" &&
      (pathname === "/v1/messages/count_tokens" ||
        pathname === "/messages/count_tokens" ||
        pathname === "/v1/count_tokens" ||
        pathname === "/count_tokens")
    ) {
      const body = await readBridgeJsonBody(req);
      const roughText = JSON.stringify(body?.messages ?? body ?? "");
      sendBridgeJson(res, 200, {
        input_tokens: Math.max(1, Math.ceil(roughText.length / 4)),
      });
      return;
    }

    if (
      req.method === "POST" &&
      (pathname === "/v1/messages" || pathname === "/messages")
    ) {
      const body = await readBridgeJsonBody(req);
      if (body?.stream !== false) {
        await sendAnthropicBridgeSseWithKeepalive(
          res,
          config.model,
          callYandexOpenAiBridge(config, body),
        );
        return;
      }
      const completion = await callYandexOpenAiBridge(config, body);
      sendAnthropicBridgeSse(res, config.model, completion);
      return;
    }

    sendBridgeJson(res, 404, {
      error: `Unsupported bridge route: ${req.method} ${pathname}`,
    });
  } catch (error) {
    sendBridgeJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function ensureXynapseEnvironmentBridge(
  config: XynapseEnvironmentBridgeConfig,
) {
  xynapseEnvironmentBridgeConfig = config;
  if (xynapseEnvironmentBridgeServer && xynapseEnvironmentBridgeBaseUrl) {
    return xynapseEnvironmentBridgeBaseUrl;
  }

  const preferredPort =
    Number(process.env.XYNAPSE_ENVIRONMENT_BRIDGE_PORT) || 53518;
  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void handleXynapseEnvironmentBridgeRequest(req, res);
      });
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(
            new Error("Could not allocate Xynapse Environment bridge port."),
          );
          return;
        }
        xynapseEnvironmentBridgeServer = server;
        xynapseEnvironmentBridgeBaseUrl = `http://127.0.0.1:${address.port}/v1`;
        resolve();
      });
    });

  try {
    await listen(preferredPort);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EADDRINUSE") {
      throw error;
    }
    await listen(0);
  }

  return xynapseEnvironmentBridgeBaseUrl!;
}

async function configureYandexEnvironmentBridge(
  request?: EnvironmentOpenRequest,
): Promise<
  | { ok: true; provider: EnvironmentProviderDescriptor }
  | { ok: false; message: string }
> {
  const sourceLabel = getEnvironmentSourceLabel(request);
  const scannedEnv = {
    ...collectRuntimeEnvFromLocalFiles(),
    ...collectEnvironmentProviderEnvFromLocalFiles(),
  };
  const savedEnv = readEnvironmentManagedEnv();
  const apiKey = getEnvironmentValueForKey(
    "YANDEX_API_KEY",
    request?.environmentApiKey,
    scannedEnv,
    savedEnv,
  );
  const folderId = getEnvironmentValueForKey(
    "YANDEX_FOLDER_ID",
    request?.environmentFolderId,
    scannedEnv,
    savedEnv,
  );
  const model = request?.environmentModel?.trim();

  if (!apiKey) {
    return {
      ok: false,
      message: `The selected Xynapse model "${sourceLabel}" uses Yandex, but YANDEX_API_KEY is not configured in Xynapse settings.`,
    };
  }
  if (!folderId) {
    return {
      ok: false,
      message: `The selected Xynapse model "${sourceLabel}" uses Yandex, but YANDEX_FOLDER_ID is not configured in Xynapse settings.`,
    };
  }
  if (!model) {
    return {
      ok: false,
      message: `The selected Xynapse model "${sourceLabel}" does not expose a Yandex model id.`,
    };
  }

  const modelUri = toYandexOpenAiModelUri(model, folderId);
  if (!modelUri) {
    return {
      ok: false,
      message: `Could not build a Yandex model URI for "${sourceLabel}".`,
    };
  }

  const provider = getEnvironmentProviderDescriptor("lmstudio");
  const bridgeBaseUrl = await ensureXynapseEnvironmentBridge({
    apiKey,
    baseUrl: normalizeYandexOpenAiBaseUrl(request?.environmentBaseUrl),
    folderId,
    model,
    modelUri,
    sourceLabel,
  });

  writeEnvironmentManagedEnv(provider, {
    model: formatEnvironmentModelRef(provider.id, model),
    baseUrl: bridgeBaseUrl,
    sourceLabel: `${sourceLabel} via Xynapse Bridge`,
  });

  return { ok: true, provider };
}

async function configureEnvironmentFromXynapseRequest(
  request?: EnvironmentOpenRequest,
): Promise<
  | { ok: true; provider: EnvironmentProviderDescriptor }
  | { ok: false; message: string }
> {
  if (isYandexEnvironmentRequest(request)) {
    return configureYandexEnvironmentBridge(request);
  }

  const providerId = mapXynapseModelToEnvironmentProvider(request);
  const sourceLabel = getEnvironmentSourceLabel(request);

  if (!providerId) {
    return {
      ok: false,
      message: `Environment uses upstream free-claude-code providers. The selected Xynapse model "${sourceLabel}" is not supported by that upstream runtime. Choose a Xynapse model backed by OpenRouter, DeepSeek, Kimi, Fireworks, Z.ai, NVIDIA NIM, Wafer, OpenCode, LM Studio, llama.cpp, or Ollama.`,
    };
  }

  const provider = getEnvironmentProviderDescriptor(providerId);
  const scannedEnv = collectEnvironmentProviderEnvFromLocalFiles();
  const savedEnv = readEnvironmentManagedEnv();
  const apiKey = getEnvironmentValueForKey(
    provider.credentialEnv,
    request?.environmentApiKey,
    scannedEnv,
    savedEnv,
  );

  if (provider.credentialEnv && !apiKey) {
    return {
      ok: false,
      message: `The selected Xynapse model "${sourceLabel}" maps to ${provider.label}, but ${provider.credentialEnv} is not configured in Xynapse settings.`,
    };
  }

  const baseUrl =
    getEnvironmentValueForKey(
      provider.baseUrlEnv,
      request?.environmentBaseUrl,
      scannedEnv,
      savedEnv,
    ) ||
    request?.environmentBaseUrl?.trim() ||
    provider.defaultBaseUrl;

  writeEnvironmentManagedEnv(provider, {
    model: formatEnvironmentModelRef(
      provider.id,
      request?.environmentModel ?? provider.defaultModel,
    ),
    apiKey,
    baseUrl,
    sourceLabel,
  });

  return { ok: true, provider };
}

async function ensureSavedXynapseEnvironmentBridge() {
  const savedEnv = readEnvironmentManagedEnv();
  const modelRef = savedEnv.MODEL?.trim() ?? "";
  const sourceLabel = savedEnv.XYNAPSE_SOURCE_MODEL?.trim() ?? "";

  if (
    savedEnv.FCC_PROVIDER !== "lmstudio" ||
    !modelRef.startsWith("lmstudio/") ||
    !sourceLabel.includes("Xynapse Bridge")
  ) {
    return;
  }

  const model = modelRef.replace(/^lmstudio\//, "").trim();
  if (!model) {
    return;
  }

  const scannedEnv = {
    ...collectRuntimeEnvFromLocalFiles(),
    ...collectEnvironmentProviderEnvFromLocalFiles(),
  };
  const apiKey = getEnvironmentValueForKey(
    "YANDEX_API_KEY",
    undefined,
    scannedEnv,
    savedEnv,
  );
  const folderId = getEnvironmentValueForKey(
    "YANDEX_FOLDER_ID",
    undefined,
    scannedEnv,
    savedEnv,
  );
  if (!apiKey || !folderId) {
    return;
  }

  const modelUri = toYandexOpenAiModelUri(model, folderId);
  if (!modelUri) {
    return;
  }

  const bridgeBaseUrl = await ensureXynapseEnvironmentBridge({
    apiKey,
    baseUrl: normalizeYandexOpenAiBaseUrl(
      getEnvironmentValueForKey(
        "YANDEX_BASE_URL",
        undefined,
        scannedEnv,
        savedEnv,
      ),
    ),
    folderId,
    model,
    modelUri,
    sourceLabel,
  });

  writeEnvironmentManagedEnv(getEnvironmentProviderDescriptor("lmstudio"), {
    model: modelRef,
    baseUrl: bridgeBaseUrl,
    sourceLabel,
  });
}

function stopEnvironmentServer(root?: string) {
  const session = getEnvironmentServerSession(root);
  if (!session) {
    return false;
  }
  session.process.kill();
  environmentPtySessions.delete(session.runId);
  return true;
}

async function openExternalEnvironmentTerminal(
  extensionContext: vscode.ExtensionContext,
  sidebar: XynapseGUIWebviewViewProvider,
  request?: EnvironmentOpenRequest,
): Promise<EnvironmentOpenResponse> {
  ensureEnvironmentTerminalCloseListener(extensionContext);

  const cwd = getRequestedWorkspaceDir(request);
  const action = request?.action ?? "status";
  const runId = request?.runId ?? createLabRunId();
  const rootResolution = resolveExternalEnvironmentRoot(extensionContext);
  const root = rootResolution.root;
  const projectStateRoot =
    action === "startServer" || action === "startClient"
      ? ensureEnvironmentProjectStateRoot(cwd)
      : getEnvironmentProjectStateRoot(cwd);
  const environmentPaths = {
    environmentHome: rootResolution.home ?? getDefaultEnvironmentHome(),
    environmentEnvPath: getEnvironmentManagedEnvPath(),
    projectStateRoot,
  };

  if (action === "sendInput") {
    const session = request?.runId
      ? environmentPtySessions.get(request.runId)
      : undefined;
    if (!session) {
      return {
        ok: false,
        message: "No active Environment session was found.",
        runId: request?.runId,
        ...environmentPaths,
      };
    }
    session.process.write(request?.input ?? "");
    return {
      ok: true,
      message: "Input sent.",
      cwd: session.cwd,
      runId: session.runId,
      ...environmentPaths,
    };
  }

  if (action === "stop") {
    const integratedTerminal = request?.runId
      ? environmentIntegratedTerminalSessions.get(request.runId)
      : Array.from(environmentIntegratedTerminalSessions.values()).slice(-1)[0];
    if (integratedTerminal) {
      const integratedRunId =
        request?.runId ??
        Array.from(environmentIntegratedTerminalSessions.entries()).find(
          ([, terminal]) => terminal === integratedTerminal,
        )?.[0];
      integratedTerminal.dispose();
      if (integratedRunId) {
        environmentIntegratedTerminalSessions.delete(integratedRunId);
      }
      return {
        ok: true,
        message: "Environment coding terminal closed.",
        cwd,
        runId: integratedRunId,
        ...environmentPaths,
        ...getEnvironmentSessionStatus(root),
        ...getEnvironmentConfigStatus(),
      };
    }

    const sessions = Array.from(environmentPtySessions.values()).filter(
      (candidate) => candidate.role !== "server",
    );
    const session = request?.runId
      ? environmentPtySessions.get(request.runId)
      : sessions[sessions.length - 1];
    if (!session) {
      return {
        ok: false,
        message: "No active Environment session was found.",
        runId: request?.runId,
        ...environmentPaths,
      };
    }
    session.process.kill();
    environmentPtySessions.delete(session.runId);
    return {
      ok: true,
      message: "Environment session stopped.",
      cwd: session.cwd,
      runId: session.runId,
      ...environmentPaths,
      ...getEnvironmentSessionStatus(root),
      ...getEnvironmentConfigStatus(),
    };
  }

  if (action === "stopServer") {
    const session = getEnvironmentServerSession(root);
    if (!session) {
      return {
        ok: true,
        message: "Environment proxy server is not running.",
        cwd: root,
        runId,
        ...environmentPaths,
        ...getEnvironmentSessionStatus(root),
        ...getEnvironmentConfigStatus(),
      };
    }
    session.process.kill();
    environmentPtySessions.delete(session.runId);
    return {
      ok: true,
      message: "Environment proxy server stopped.",
      cwd: session.cwd,
      runId: session.runId,
      ...environmentPaths,
      ...getEnvironmentSessionStatus(root),
      ...getEnvironmentConfigStatus(),
    };
  }

  if (action === "update" && rootResolution.parent && root) {
    if (!fs.existsSync(root)) {
      fs.mkdirSync(rootResolution.parent, { recursive: true });
      return {
        ...startEnvironmentPty(sidebar, {
          runId,
          cwd: rootResolution.parent,
          role: "task",
          title: "Install upstream Environment checkout",
          command: `git clone ${ENVIRONMENT_REPO_URL} ${quoteTerminalArg(root)}`,
          projectStateRoot,
          upstreamRoot: root,
        }),
        upstreamRoot: root,
        ...environmentPaths,
        ...getEnvironmentSessionStatus(root),
      };
    }
    if (rootResolution.error) {
      return {
        ok: false,
        message: rootResolution.error,
        upstreamRoot: root,
        runId,
        ...environmentPaths,
      };
    }
    stopEnvironmentServer(root);
    return {
      ...startEnvironmentPty(sidebar, {
        runId,
        cwd: root,
        role: "task",
        title: "Update upstream Environment checkout",
        command: buildEnvironmentUpdateCommand(root),
        projectStateRoot,
        upstreamRoot: root,
      }),
      upstreamRoot: root,
      ...environmentPaths,
      ...getEnvironmentSessionStatus(root),
    };
  }

  if (action === "install") {
    const installCwd = root && fs.existsSync(root) ? root : process.cwd();
    if (root) {
      stopEnvironmentServer(root);
    }
    return {
      ...startEnvironmentPty(sidebar, {
        runId,
        cwd: installCwd,
        role: "task",
        title: "Install or update upstream Environment runtime",
        command: buildEnvironmentInstallCommand(),
        projectStateRoot,
        upstreamRoot: root,
      }),
      upstreamRoot: root,
      ...environmentPaths,
      ...getEnvironmentSessionStatus(root),
    };
  }

  if (rootResolution.error) {
    return {
      ok: false,
      message: rootResolution.error,
      cwd,
      upstreamRoot: root,
      runId,
      supportedProviders: ENVIRONMENT_SUPPORTED_PROVIDERS,
      ...environmentPaths,
      ...getEnvironmentConfigStatus(),
    };
  }

  if (!root) {
    return {
      ok: false,
      message: "Environment root was not resolved.",
      runId,
      ...environmentPaths,
    };
  }

  if (action === "startServer") {
    const configuredProvider =
      await configureEnvironmentFromXynapseRequest(request);
    if (!configuredProvider.ok) {
      return {
        ok: false,
        message: configuredProvider.message,
        cwd: root,
        upstreamRoot: root,
        runId,
        ...environmentPaths,
        ...getEnvironmentConfigStatus(),
      };
    }
    stopEnvironmentServer(root);
    if (!isEnvironmentRuntimeInstalled()) {
      return {
        ok: false,
        message:
          "Environment runtime is not installed or is incomplete. Run Install runtime first, then start the server.",
        cwd: root,
        upstreamRoot: root,
        runId,
        ...environmentPaths,
        ...getEnvironmentConfigStatus(),
      };
    }
    return {
      ...startEnvironmentServerIfNeeded(sidebar, root, runId, projectStateRoot),
      upstreamRoot: root,
      ...environmentPaths,
      ...getEnvironmentConfigStatus(),
      ...getEnvironmentSessionStatus(root),
    };
  }

  if (action === "startClient") {
    if (!cwd) {
      return {
        ok: false,
        message: "Open a project folder first.",
        upstreamRoot: root,
        runId,
        ...environmentPaths,
        ...getEnvironmentConfigStatus(),
      };
    }
    if (!isEnvironmentClientInstalled()) {
      return {
        ok: false,
        message:
          "Environment client is not installed or is incomplete. Run Install runtime first, then start a session.",
        cwd,
        upstreamRoot: root,
        runId,
        ...environmentPaths,
        ...getEnvironmentConfigStatus(),
      };
    }
    if (!isEnvironmentRuntimeInstalled()) {
      return {
        ok: false,
        message:
          "Environment runtime is not installed or is incomplete. Run Install runtime first, then start a session.",
        cwd,
        upstreamRoot: root,
        runId,
        ...environmentPaths,
        ...getEnvironmentConfigStatus(),
      };
    }
    const configuredProvider =
      await configureEnvironmentFromXynapseRequest(request);
    if (!configuredProvider.ok) {
      return {
        ok: false,
        message: configuredProvider.message,
        cwd,
        upstreamRoot: root,
        runId,
        ...environmentPaths,
        ...getEnvironmentConfigStatus(),
      };
    }
    stopEnvironmentServer(root);
    const server = startEnvironmentServerIfNeeded(
      sidebar,
      root,
      `${runId}-server`,
      projectStateRoot,
    );
    if (!server.ok) {
      return {
        ...server,
        upstreamRoot: root,
        ...environmentPaths,
        ...getEnvironmentConfigStatus(),
      };
    }
    return {
      ...startEnvironmentIntegratedTerminal(request, {
        runId,
        cwd,
        projectStateRoot,
        upstreamRoot: root,
      }),
      upstreamRoot: root,
      ...environmentPaths,
      ...getEnvironmentConfigStatus(),
      ...getEnvironmentSessionStatus(root),
    };
  }

  let statusMessage =
    "Environment is linked to the clean upstream checkout. Use Install runtime, then Start coding session.";
  const configStatus = getEnvironmentConfigStatus();
  if (configStatus.environmentSourceLabel?.includes("Xynapse Bridge")) {
    statusMessage =
      "Environment is linked to the clean upstream checkout. Xynapse Bridge is configured and will start with the next proxy or coding session.";
  }

  return {
    ok: true,
    message: statusMessage,
    cwd,
    permissionMode: normalizeEnvironmentClientPermissionMode(request),
    runId,
    upstreamRoot: root,
    upstreamCommit: getEnvironmentGitCommit(root),
    upstreamDirty: isEnvironmentGitDirty(root),
    uvInstalled: commandExists("uv"),
    python314Installed: hasPython314(),
    fccInstalled: isEnvironmentRuntimeInstalled(),
    clientInstalled: isEnvironmentClientInstalled(),
    supportedProviders: ENVIRONMENT_SUPPORTED_PROVIDERS,
    ...environmentPaths,
    ...configStatus,
    ...getEnvironmentSessionStatus(root),
  };
}

async function showRuntimeNotFoundMessage() {
  const action = await vscode.window.showErrorMessage(
    "Xynapse runtime was not found. Build or bundle the runtime, or set Xynapse: Runtime Path if needed.",
    "Open Settings",
  );

  if (action === "Open Settings") {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "xynapse.runtimePath",
    );
  }
}

async function resolveRuntimeExecutable(
  ide: VsCodeIde,
  extensionContext: vscode.ExtensionContext,
  cwd: string,
) {
  const configured =
    vscode.workspace
      .getConfiguration("xynapse")
      .get<string>("runtimePath")
      ?.trim() ?? process.env.XYNAPSE_RUNTIME_PATH?.trim();
  if (configured) {
    const isPathLike =
      path.isAbsolute(configured) ||
      configured.includes("/") ||
      configured.includes("\\");
    const resolvedConfigured = path.isAbsolute(configured)
      ? configured
      : path.resolve(cwd, configured);

    if (!isPathLike || fs.existsSync(resolvedConfigured)) {
      return isPathLike ? resolvedConfigured : configured;
    }

    const action = await vscode.window.showErrorMessage(
      `Configured Xynapse runtime was not found: ${configured}`,
      "Open Settings",
    );
    if (action === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "xynapse.runtimePath",
      );
    }
    return undefined;
  }

  const binaryName = process.platform === "win32" ? "xynapse.exe" : "xynapse";
  const bundledCandidate = path.join(
    extensionContext.extensionPath,
    "bin",
    binaryName,
  );
  if (fs.existsSync(bundledCandidate)) {
    return bundledCandidate;
  }

  const workspaceCandidate = path.join(
    cwd,
    ".external",
    "xynapse-runtime",
    "rust",
    "target",
    "debug",
    binaryName,
  );
  if (fs.existsSync(workspaceCandidate)) {
    return workspaceCandidate;
  }

  const devCandidate = path.resolve(
    extensionContext.extensionPath,
    "..",
    "..",
    "..",
    ".external",
    "xynapse-runtime",
    "rust",
    "target",
    "debug",
    binaryName,
  );
  if (fs.existsSync(devCandidate)) {
    return devCandidate;
  }

  try {
    await ide.subprocess(
      process.platform === "win32" ? "where xynapse" : "command -v xynapse",
      cwd,
    );
    return "xynapse";
  } catch {
    await showRuntimeNotFoundMessage();
    return undefined;
  }
}

// Copy everything over from extension.ts
const getCommandsMap: (
  ide: VsCodeIde,
  extensionContext: vscode.ExtensionContext,
  sidebar: XynapseGUIWebviewViewProvider,
  consoleView: XynapseConsoleWebviewViewProvider,
  configHandler: ConfigHandler,
  verticalDiffManager: VerticalDiffManager,
  battery: Battery,
  quickEdit: QuickEdit,
  core: Core,
  editDecorationManager: EditDecorationManager,
) => { [command: string]: (...args: any) => any } = (
  ide,
  extensionContext,
  sidebar,
  consoleView,
  configHandler,
  verticalDiffManager,
  battery,
  quickEdit,
  core,
  editDecorationManager,
) => {
  /**
   * Streams an inline edit to the vertical diff manager.
   *
   * This function retrieves the configuration, determines the appropriate model title,
   * increments the FTC count, and then streams an edit to the
   * vertical diff manager.
   *
   * @param  promptName - The key for the prompt in the context menu configuration.
   * @param  fallbackPrompt - The prompt to use if the configured prompt is not available.
   * @param  [range] - Optional. The range to edit if provided.
   * @returns
   */
  async function streamInlineEdit(
    promptName: keyof ContextMenuConfig,
    fallbackPrompt: string,
    range?: vscode.Range,
  ) {
    const { config } = await configHandler.loadConfig();
    if (!config) {
      throw new Error("Config not loaded");
    }

    const llm =
      config.selectedModelByRole.edit ?? config.selectedModelByRole.chat;

    if (!llm) {
      throw new Error("No edit or chat model selected");
    }

    void sidebar.webviewProtocol.request("incrementFtc", undefined);

    await verticalDiffManager.streamEdit({
      input:
        config.experimental?.contextMenuPrompts?.[promptName] ?? fallbackPrompt,
      llm,
      range,
      rulesToInclude: config.rules,
      isApply: false,
    });
  }

  return {
    "xynapse.acceptDiff": async (newFileUri?: string, streamId?: string) => {
      captureCommandTelemetry("acceptDiff");
      void processDiff(
        "accept",
        sidebar,
        ide,
        core,
        verticalDiffManager,
        newFileUri,
        streamId,
      );
    },

    "xynapse.rejectDiff": async (newFileUri?: string, streamId?: string) => {
      captureCommandTelemetry("rejectDiff");
      void processDiff(
        "reject",
        sidebar,
        ide,
        core,
        verticalDiffManager,
        newFileUri,
        streamId,
      );
    },
    "xynapse.acceptVerticalDiffBlock": (fileUri?: string, index?: number) => {
      captureCommandTelemetry("acceptVerticalDiffBlock");
      verticalDiffManager.acceptRejectVerticalDiffBlock(true, fileUri, index);
    },
    "xynapse.rejectVerticalDiffBlock": (fileUri?: string, index?: number) => {
      captureCommandTelemetry("rejectVerticalDiffBlock");
      verticalDiffManager.acceptRejectVerticalDiffBlock(false, fileUri, index);
    },
    "xynapse.quickFix": async (
      range: vscode.Range,
      diagnosticMessage: string,
    ) => {
      captureCommandTelemetry("quickFix");

      const prompt = `Please explain the cause of this error and how to solve it: ${diagnosticMessage}`;

      addCodeToContextFromRange(range, sidebar.webviewProtocol, prompt);

      vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");
    },
    // Passthrough for telemetry purposes
    "xynapse.defaultQuickAction": async (args: QuickEditShowParams) => {
      captureCommandTelemetry("defaultQuickAction");
      vscode.commands.executeCommand("xynapse.focusEdit", args);
    },
    "xynapse.customQuickActionSendToChat": async (
      prompt: string,
      range: vscode.Range,
    ) => {
      captureCommandTelemetry("customQuickActionSendToChat");

      addCodeToContextFromRange(range, sidebar.webviewProtocol, prompt);

      vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");
    },
    "xynapse.customQuickActionStreamInlineEdit": async (
      prompt: string,
      range: vscode.Range,
    ) => {
      captureCommandTelemetry("customQuickActionStreamInlineEdit");

      streamInlineEdit("docstring", prompt, range);
    },
    "xynapse.codebaseForceReIndex": async () => {
      core.invoke("index/forceReIndex", undefined);
    },
    "xynapse.rebuildCodebaseIndex": async () => {
      core.invoke("index/forceReIndex", { shouldClearIndexes: true });
    },
    "xynapse.docsIndex": async () => {
      core.invoke("context/indexDocs", { reIndex: false });
    },
    "xynapse.docsReIndex": async () => {
      core.invoke("context/indexDocs", { reIndex: true });
    },
    "xynapse.focusInput": async () => {
      const isXynapseInputFocused = await sidebar.webviewProtocol.request(
        "isXynapseInputFocused",
        undefined,
        false,
      );

      // This is a temporary fix—sidebar.webviewProtocol.request is blocking
      // when the GUI hasn't yet been setup and we should instead be
      // immediately throwing an error, or returning a Result object
      focusGUI();
      if (!sidebar.isReady) {
        const isReady = await waitForSidebarReady(sidebar, 5000, 100);
        if (!isReady) {
          return;
        }
      }

      const historyLength = await sidebar.webviewProtocol.request(
        "getWebviewHistoryLength",
        undefined,
        false,
      );

      if (isXynapseInputFocused) {
        if (historyLength === 0) {
          hideGUI();
        } else {
          void sidebar.webviewProtocol?.request(
            "focusXynapseInputWithNewSession",
            undefined,
            false,
          );
        }
      } else {
        focusGUI();
        sidebar.webviewProtocol?.request(
          "focusXynapseInputWithNewSession",
          undefined,
          false,
        );
        void addHighlightedCodeToContext(sidebar.webviewProtocol);
      }
    },
    "xynapse.focusInputWithoutClear": async () => {
      const isXynapseInputFocused = await sidebar.webviewProtocol.request(
        "isXynapseInputFocused",
        undefined,
        false,
      );

      // This is a temporary fix—sidebar.webviewProtocol.request is blocking
      // when the GUI hasn't yet been setup and we should instead be
      // immediately throwing an error, or returning a Result object
      focusGUI();
      if (!sidebar.isReady) {
        const isReady = await waitForSidebarReady(sidebar, 5000, 100);
        if (!isReady) {
          return;
        }
      }

      if (isXynapseInputFocused) {
        hideGUI();
      } else {
        focusGUI();

        sidebar.webviewProtocol?.request(
          "focusXynapseInputWithoutClear",
          undefined,
        );

        void addHighlightedCodeToContext(sidebar.webviewProtocol);
      }
    },
    // QuickEditShowParams are passed from CodeLens, temp fix
    // until we update to new params specific to Edit
    "xynapse.focusEdit": async (args?: QuickEditShowParams) => {
      captureCommandTelemetry("focusEdit");
      focusGUI();
      sidebar.webviewProtocol?.request("focusEdit", undefined);
    },
    "xynapse.exitEditMode": async () => {
      captureCommandTelemetry("exitEditMode");
      editDecorationManager.clear();
      void sidebar.webviewProtocol?.request("exitEditMode", undefined);
    },
    "xynapse.generateRule": async () => {
      captureCommandTelemetry("generateRule");
      focusGUI();
      void sidebar.webviewProtocol?.request("generateRule", undefined);
    },
    "xynapse.writeCommentsForCode": async () => {
      captureCommandTelemetry("writeCommentsForCode");

      streamInlineEdit(
        "comment",
        "Write comments for this code. Do not change anything about the code itself.",
      );
    },
    "xynapse.writeDocstringForCode": async () => {
      captureCommandTelemetry("writeDocstringForCode");

      void streamInlineEdit(
        "docstring",
        "Write a docstring for this code. Do not change anything about the code itself.",
      );
    },
    "xynapse.fixCode": async () => {
      captureCommandTelemetry("fixCode");

      streamInlineEdit(
        "fix",
        "Fix this code. If it is already 100% correct, simply rewrite the code.",
      );
    },
    "xynapse.optimizeCode": async () => {
      captureCommandTelemetry("optimizeCode");
      streamInlineEdit("optimize", "Optimize this code");
    },
    "xynapse.fixGrammar": async () => {
      captureCommandTelemetry("fixGrammar");
      streamInlineEdit(
        "fixGrammar",
        "If there are any grammar or spelling mistakes in this writing, fix them. Do not make other large changes to the writing.",
      );
    },
    "xynapse.clearConsole": async () => {
      consoleView.clearLog();
    },
    "xynapse.viewLogs": async () => {
      captureCommandTelemetry("viewLogs");
      vscode.commands.executeCommand("workbench.action.toggleDevTools");
    },
    "xynapse.debugTerminal": async () => {
      captureCommandTelemetry("debugTerminal");

      const terminalContents = await ide.getTerminalContents();

      vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");

      sidebar.webviewProtocol?.request("userInput", {
        input: `I got the following error, can you please help explain how to fix it?\n\n${terminalContents.trim()}`,
      });
    },
    "xynapse.hideInlineTip": () => {
      vscode.workspace
        .getConfiguration(EXTENSION_NAME)
        .update("showInlineTip", false, vscode.ConfigurationTarget.Global);
    },

    // Commands without keyboard shortcuts
    "xynapse.addModel": () => {
      captureCommandTelemetry("addModel");

      vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");
      sidebar.webviewProtocol?.request("addModel", undefined);
    },
    "xynapse.newSession": async () => {
      await vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");
      sidebar.webviewProtocol?.request("newSession", undefined);
    },

    "xynapse.shareSession": async (sessionId: string | undefined) => {
      if (!sessionId) {
        sessionId = await sidebar.webviewProtocol?.request(
          "getCurrentSessionId",
          undefined,
        );
      }
      if (!sessionId) {
        void vscode.window.showErrorMessage(
          "No session ID found. Please start a new session first.",
        );
        return;
      }
      //let user select the destination folder
      const destinationFolder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Select Destination Folder",
      });
      if (!destinationFolder || destinationFolder.length === 0) {
        return;
      }

      try {
        // despite core.invoke not being async, we still need to await it, because the 'history/share' command is async
        // if not awaited, then errors will not be caught.
        await core.invoke("history/share", {
          id: sessionId,
          outputDir: destinationFolder[0].fsPath,
        });
      } catch (error) {
        const errorMessage = `Failed to save session: ${error instanceof Error ? error.message : String(error)}`;
        void vscode.window.showErrorMessage(errorMessage);
      }
    },
    "xynapse.viewHistory": () => {
      vscode.commands.executeCommand("xynapse.navigateTo", "/history", true);
    },
    "xynapse.viewLabHistory": async () => {
      await vscode.commands.executeCommand("xynapse.xynapseLabView.focus");
      sidebar.webviewProtocol?.request("navigateTo", {
        path: "/history",
        toggle: true,
      });
    },
    "xynapse.focusXynapseSessionId": async (sessionId: string | undefined) => {
      if (!sessionId) {
        sessionId = await vscode.window.showInputBox({
          prompt: "Enter the Session ID",
        });
      }
      void sidebar.webviewProtocol?.request("focusXynapseSessionId", {
        sessionId,
      });
    },
    "xynapse.applyCodeFromChat": () => {
      void sidebar.webviewProtocol.request("applyCodeFromChat", undefined);
    },
    "xynapse.connectYandexCloud": async () => {
      await vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");
      await vscode.commands.executeCommand(
        "xynapse.navigateTo",
        "/config?tab=yandex-cloud",
        false,
      );
    },
    "xynapse.openConfigPage": () => {
      vscode.commands.executeCommand(
        "xynapse.navigateTo",
        "/config?tab=overview",
        false,
      );
    },
    "xynapse.openConfigFile": async () => {
      const configYamlPath = getConfigYamlPath("vscode");
      await openEditorAndRevealRange(
        vscode.Uri.file(configYamlPath),
        undefined,
        undefined,
        false,
      );
    },
    "xynapse.profile.import": async () => {
      await importXynapseProfileBackup(ide, configHandler);
    },
    "xynapse.openEnvironment": async (
      request?: EnvironmentOpenRequest,
    ): Promise<EnvironmentOpenResponse> => {
      return await openExternalEnvironmentTerminal(
        extensionContext,
        sidebar,
        request,
      );
    },
    "xynapse.runtimeDoctor": async (request?: RuntimeDoctorRequest) => {
      const runId = getRuntimeRequestRunId(request) ?? createLabRunId();
      const cwd = getRequestedWorkspaceDir(request);
      if (!cwd) {
        sendLabRunEvent(sidebar, {
          runId,
          kind: "error",
          stream: "system",
          title: "Xynapse runtime diagnostics",
          text: "Open a project folder first. Xynapse runtime needs a workspace root for diagnostics.\n",
        });
        return;
      }

      const executable = await resolveRuntimeExecutable(
        ide,
        extensionContext,
        cwd,
      );
      if (!executable) {
        sendLabRunEvent(sidebar, {
          runId,
          kind: "error",
          stream: "system",
          title: "Xynapse runtime diagnostics",
          cwd,
          text: "Xynapse runtime was not found.\n",
        });
        return;
      }

      runRuntimeInWebview(sidebar, executable, ["doctor"], {
        runId,
        cwd,
        env: await collectRuntimeEnv(configHandler),
        title: "Xynapse runtime diagnostics",
        route: "doctor runtime=embedded",
        prompt: "Run Xynapse runtime diagnostics.",
        saveArtifacts: false,
      });
    },
    "xynapse.runtimeStop": async (request?: { runId?: string }) => {
      stopRuntimeInWebview(sidebar, request);
    },
    "xynapse.listLabHistory": async (
      request?: LabHistoryRequest,
    ): Promise<LabHistoryResponse> => {
      const cwd = getRequestedWorkspaceDir(request);
      if (!cwd) {
        return {
          items: [],
          error:
            "Open a project folder first. Lab history is stored per workspace.",
        };
      }

      try {
        return { items: listXynapseLabHistory(cwd) };
      } catch (error) {
        return {
          items: [],
          error:
            error instanceof Error
              ? error.message
              : "Could not read Xynapse Lab history.",
        };
      }
    },
    "xynapse.openLabArtifact": async (
      request?: LabArtifactRequest,
    ): Promise<{ ok: boolean; error?: string }> => {
      const cwd = getRequestedWorkspaceDir(request);
      if (!cwd) {
        return { ok: false, error: "No workspace folder is open." };
      }

      const artifactPath = resolveXynapseLabArtifactPath(cwd, request?.relPath);
      if (!artifactPath) {
        return { ok: false, error: "Lab artifact was not found." };
      }

      await vscode.window.showTextDocument(vscode.Uri.file(artifactPath), {
        preview: true,
      });
      return { ok: true };
    },
    "xynapse.deleteRuntimeSession": async (request?: {
      sessionId?: string;
      workspaceDir?: string;
    }) => {
      const cwd = getRequestedWorkspaceDir(request);
      if (cwd) {
        deleteXynapseRuntimeSession(cwd, request?.sessionId);
      }
    },
    "xynapse.clearRuntimeSessions": async (request?: {
      workspaceDir?: string;
    }) => {
      const cwd = getRequestedWorkspaceDir(request);
      if (cwd) {
        clearXynapseRuntimeSessions(cwd);
      }
    },
    "xynapse.confirmAndRestoreRuntimeCheckpoint": async (
      request?: RuntimeCheckpointRestoreRequest,
    ) => {
      const cwd = getRequestedWorkspaceDir(request);
      if (!cwd) {
        return { action: "cancel", message: "No workspace folder is open." };
      }
      return await confirmAndRestoreRuntimeCheckpoint(cwd, request);
    },
    "xynapse.runtimePrompt": async (request?: RuntimePromptRequest) => {
      const runId = getRuntimeRequestRunId(request) ?? createLabRunId();
      const isCoreRequest = isCoreRuntimeRequest(request);
      const title = isCoreRequest
        ? "Xynapse Core task"
        : "Xynapse Lab algorithm";
      const cwd = getRequestedWorkspaceDir(request);
      if (!cwd) {
        sendLabRunEvent(sidebar, {
          runId,
          kind: "error",
          stream: "system",
          title,
          text: "Open a project folder first. Xynapse will not run from a guessed folder because workspace context must be bound to a real project.\n",
        });
        return;
      }

      const promptFromUi =
        typeof request === "string" ? request : request?.prompt;
      const prompt =
        promptFromUi ??
        (await vscode.window.showInputBox({
          prompt: isCoreRequest
            ? "Prompt for Xynapse Core runtime (continues the workspace session)"
            : "Prompt for Xynapse Lab algorithm (read-only analysis)",
          placeHolder: isCoreRequest
            ? "fix and run this project"
            : "audit this solution",
        }));
      if (!prompt?.trim()) {
        return;
      }

      const permissionMode = getRuntimePermissionMode(request);
      const executable = await resolveRuntimeExecutable(
        ide,
        extensionContext,
        cwd,
      );
      if (!executable) {
        sendLabRunEvent(sidebar, {
          runId,
          kind: "error",
          stream: "system",
          title,
          cwd,
          text: "Xynapse runtime was not found.\n",
        });
        return;
      }

      const plan = await getRuntimeRunPlan(configHandler, request);
      if (!plan) {
        sendLabRunEvent(sidebar, {
          runId,
          kind: "error",
          stream: "system",
          title,
          cwd,
          text: "Selected model is not compatible with Xynapse runtime yet.\n",
        });
        return;
      }

      const requestSessionId =
        typeof request === "object" ? request?.sessionId : undefined;
      const runtimeSessionId = isCoreRequest ? requestSessionId : "xynapse-lab";
      const planMode = typeof request === "object" && !!request?.planMode;
      const previousDiscussion =
        typeof request === "object" ? request?.previousDiscussion : undefined;
      const runtimeRules =
        typeof request === "object" ? request?.runtimeRules : undefined;
      const allowedTools =
        typeof request === "object" ? request?.allowedTools : undefined;
      const previousTurns =
        isCoreRequest && runtimeSessionId && !previousDiscussion?.trim()
          ? readXynapseCoreConversation(cwd, runtimeSessionId)
          : [];
      const resolvedAllowedTools = getLabAllowedTools(
        permissionMode,
        allowedTools,
      );
      if (isCoreRequest && runtimeSessionId && permissionMode !== "read-only") {
        createXynapseRuntimeCheckpoint(cwd, runtimeSessionId, runId);
      }

      const runtimePrompt = buildWorkspaceAwareLabPrompt(
        prompt,
        cwd,
        permissionMode,
        planMode,
        previousTurns,
        previousDiscussion,
        runtimeRules,
      );
      const runtimePromptRelPath = writeRuntimePromptFile(
        cwd,
        runId,
        runtimePrompt,
      );

      runRuntimeInWebview(
        sidebar,
        executable,
        [
          "--model",
          plan.model,
          "--permission-mode",
          permissionMode,
          ...(resolvedAllowedTools !== undefined
            ? ["--allowedTools", resolvedAllowedTools]
            : []),
          "prompt",
          buildRuntimePromptFileBootstrap(runtimePromptRelPath),
        ],
        {
          runId,
          cwd,
          env: plan.env,
          title,
          model: plan.label,
          route: `model=${plan.model} label=${plan.label} permission=${permissionMode} runtime=embedded`,
          prompt,
          sessionId: runtimeSessionId,
          ...(isCoreRequest
            ? {
                conversation: {
                  userPrompt: prompt,
                  permissionMode,
                  planMode,
                },
              }
            : {}),
        },
      );
    },
    "xynapse.selectFilesAsContext": async (
      firstUri: vscode.Uri,
      uris: vscode.Uri[],
    ) => {
      if (uris === undefined) {
        throw new Error("No files were selected");
      }

      vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");

      for (const uri of uris) {
        // If it's a folder, add the entire folder contents recursively by using walkDir (to ignore ignored files)
        const isDirectory = await vscode.workspace.fs
          .stat(uri)
          ?.then((stat) => stat.type === vscode.FileType.Directory);
        if (isDirectory) {
          for await (const fileUri of walkDirAsync(uri.toString(), ide, {
            source: "vscode continue.selectFilesAsContext command",
          })) {
            await addEntireFileToContext(
              vscode.Uri.parse(fileUri),
              sidebar.webviewProtocol,
              ide.ideUtils,
            );
          }
        } else {
          await addEntireFileToContext(
            uri,
            sidebar.webviewProtocol,
            ide.ideUtils,
          );
        }
      }
    },
    "xynapse.logAutocompleteOutcome": (
      completionId: string,
      completionProvider: CompletionProvider,
    ) => {
      completionProvider.accept(completionId);
    },
    "xynapse.logNextEditOutcomeAccept": (
      completionId: string,
      nextEditLoggingService: NextEditLoggingService,
    ) => {
      nextEditLoggingService.accept(completionId);
    },
    "xynapse.logNextEditOutcomeReject": (
      completionId: string,
      nextEditLoggingService: NextEditLoggingService,
    ) => {
      nextEditLoggingService.reject(completionId);
    },
    "xynapse.toggleTabAutocompleteEnabled": () => {
      captureCommandTelemetry("toggleTabAutocompleteEnabled");

      const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
      const enabled = config.get("enableTabAutocomplete");
      const pauseOnBattery = config.get<boolean>(
        "pauseTabAutocompleteOnBattery",
      );
      if (!pauseOnBattery || battery.isACConnected()) {
        config.update(
          "enableTabAutocomplete",
          !enabled,
          vscode.ConfigurationTarget.Global,
        );
      } else {
        if (enabled) {
          const paused = getStatusBarStatus() === StatusBarStatus.Paused;
          if (paused) {
            setupStatusBar(StatusBarStatus.Enabled);
          } else {
            config.update(
              "enableTabAutocomplete",
              false,
              vscode.ConfigurationTarget.Global,
            );
          }
        } else {
          setupStatusBar(StatusBarStatus.Paused);
          config.update(
            "enableTabAutocomplete",
            true,
            vscode.ConfigurationTarget.Global,
          );
        }
      }
    },
    "xynapse.forceAutocomplete": async () => {
      captureCommandTelemetry("forceAutocomplete");

      // 1. Explicitly hide any existing suggestion. This clears VS Code's cache for the current position.
      await vscode.commands.executeCommand("editor.action.inlineSuggest.hide");

      // 2. Now trigger a new one. VS Code has no cached suggestion, so it's forced to call our provider.
      await vscode.commands.executeCommand(
        "editor.action.inlineSuggest.trigger",
      );
    },

    "xynapse.openTabAutocompleteConfigMenu": async () => {
      captureCommandTelemetry("openTabAutocompleteConfigMenu");

      const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
      const quickPick = vscode.window.createQuickPick();

      const { config: xynapseConfig } = await configHandler.loadConfig();
      const autocompleteModels = xynapseConfig?.modelsByRole.autocomplete ?? [];
      const selected =
        xynapseConfig?.selectedModelByRole?.autocomplete?.title ?? undefined;

      // Toggle between Disabled, Paused, and Enabled
      const pauseOnBattery =
        config.get<boolean>("pauseTabAutocompleteOnBattery") &&
        !battery.isACConnected();
      const currentStatus = getStatusBarStatus();

      let targetStatus: StatusBarStatus | undefined;
      if (pauseOnBattery) {
        // Cycle from Disabled -> Paused -> Enabled
        targetStatus =
          currentStatus === StatusBarStatus.Paused
            ? StatusBarStatus.Enabled
            : currentStatus === StatusBarStatus.Disabled
              ? StatusBarStatus.Paused
              : StatusBarStatus.Disabled;
      } else {
        // Toggle between Disabled and Enabled
        targetStatus =
          currentStatus === StatusBarStatus.Disabled
            ? StatusBarStatus.Enabled
            : StatusBarStatus.Disabled;
      }

      const nextEditEnabled = config.get<boolean>("enableNextEdit") ?? false;

      quickPick.items = [
        {
          label: "$(gear) Open settings",
        },
        {
          label: "$(comment) Open chat",
          description: getMetaKeyLabel() + " + L",
        },
        {
          label: "$(screen-full) Open full screen chat",
          description:
            getMetaKeyLabel() + " + K, " + getMetaKeyLabel() + " + M",
        },
        {
          label: quickPickStatusText(targetStatus),
          description:
            getMetaKeyLabel() + " + K, " + getMetaKeyLabel() + " + A",
        },
        ...getNextEditMenuItems(currentStatus, nextEditEnabled),
        {
          kind: vscode.QuickPickItemKind.Separator,
          label: "Switch model",
        },
        ...autocompleteModels.map((model) => ({
          label: getAutocompleteStatusBarTitle(selected, model),
          description: getAutocompleteStatusBarDescription(selected, model),
        })),
      ];
      quickPick.onDidAccept(() => {
        const selectedOption = quickPick.selectedItems[0].label;
        const targetStatus =
          getStatusBarStatusFromQuickPickItemLabel(selectedOption);

        if (targetStatus !== undefined) {
          setupStatusBar(targetStatus);
          config.update(
            "enableTabAutocomplete",
            targetStatus === StatusBarStatus.Enabled,
            vscode.ConfigurationTarget.Global,
          );
        } else if (isNextEditToggleLabel(selectedOption)) {
          handleNextEditToggle(selectedOption, config);
        } else if (
          autocompleteModels.some((model) => model.title === selectedOption)
        ) {
          if (core.configHandler.currentProfile?.profileDescription.id) {
            core.invoke("config/updateSelectedModel", {
              profileId:
                core.configHandler.currentProfile?.profileDescription.id,
              role: "autocomplete",
              title: selectedOption,
            });
          }
        } else if (selectedOption === "$(comment) Open chat") {
          vscode.commands.executeCommand("xynapse.focusInput");
        } else if (selectedOption === "$(screen-full) Open full screen chat") {
          vscode.commands.executeCommand("xynapse.openInNewWindow");
        } else if (selectedOption === "$(gear) Open settings") {
          vscode.commands.executeCommand(
            "xynapse.navigateTo",
            "/config?tab=overview",
          );
        }

        quickPick.dispose();
      });
      quickPick.show();
    },
    "xynapse.navigateTo": (path: string, toggle: boolean) => {
      sidebar.webviewProtocol?.request("navigateTo", { path, toggle });
      focusGUI();
    },
    "xynapse.startLocalOllama": () => {
      startLocalOllama(ide);
    },
    "xynapse.startLocalLemonade": () => {
      startLocalLemonade(ide);
    },
    "xynapse.installModel": async (
      modelName: string,
      llmProvider: ILLM | undefined,
    ) => {
      try {
        if (!isModelInstaller(llmProvider)) {
          const msg = llmProvider
            ? `LLM provider '${llmProvider.providerName}' does not support installing models`
            : "Missing LLM Provider";
          throw new Error(msg);
        }
        await installModelWithProgress(modelName, llmProvider);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(
          `Failed to install '${modelName}': ${message}`,
        );
      }
    },
    "xynapse.convertConfigJsonToConfigYaml": async () => {
      const configJson = fs.readFileSync(getConfigJsonPath(), "utf-8");
      const parsed = JSON.parse(configJson);
      const configYaml = convertJsonToYamlConfig(parsed);

      const configYamlPath = getConfigYamlPath();
      fs.writeFileSync(configYamlPath, YAML.stringify(configYaml));
      setConfigFilePermissions(configYamlPath);

      // Open config.yaml
      await openEditorAndRevealRange(
        vscode.Uri.file(configYamlPath),
        undefined,
        undefined,
        false,
      );

      void vscode.window
        .showInformationMessage(
          "Your config.json has been converted to the new config.yaml format. If you need to switch back to config.json, you can delete or rename config.yaml.",
          "Read the docs",
        )
        .then(async (selection) => {
          if (selection === "Read the docs") {
            await vscode.env.openExternal(
              vscode.Uri.parse("https://docs.continue.dev/yaml-migration"),
            );
          }
        });
    },
    "xynapse.enterEnterpriseLicenseKey": async () => {
      captureCommandTelemetry("enterEnterpriseLicenseKey");

      const licenseKey = await vscode.window.showInputBox({
        prompt: "Enter your enterprise license key",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "License key",
      });

      if (!licenseKey) {
        return;
      }

      try {
        const isValid = core.invoke("mdm/setLicenseKey", {
          licenseKey,
        });

        if (isValid) {
          void vscode.window.showInformationMessage(
            "Enterprise license key successfully validated and saved. Reloading window.",
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
        } else {
          void vscode.window.showErrorMessage(
            "Invalid license key. Please check your license key and try again.",
          );
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Failed to set enterprise license key: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    "xynapse.toggleNextEditEnabled": async () => {
      captureCommandTelemetry("toggleNextEditEnabled");

      const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
      const tabAutocompleteEnabled = config.get<boolean>(
        "enableTabAutocomplete",
      );

      if (!tabAutocompleteEnabled) {
        vscode.window.showInformationMessage(
          "Please enable tab autocomplete first to use Next Edit",
        );
        return;
      }

      const nextEditEnabled = config.get<boolean>("enableNextEdit") ?? false;

      // updateNextEditState in VsCodeExtension.ts will handle the validation.
      config.update(
        "enableNextEdit",
        !nextEditEnabled,
        vscode.ConfigurationTarget.Global,
      );
    },
    "xynapse.openInNewWindow": async () => {
      focusGUI();

      const sessionId = await sidebar.webviewProtocol.request(
        "getCurrentSessionId",
        undefined,
      );
      // Check if full screen is already open by checking open tabs
      const fullScreenTab = getFullScreenTab();

      if (fullScreenTab && fullScreenPanel) {
        // Full screen open, but not focused - focus it
        fullScreenPanel.reveal();
        return;
      }

      // Clear the sidebar to prevent overwriting changes made in fullscreen
      vscode.commands.executeCommand("xynapse.newSession");

      // Full screen not open - open it
      captureCommandTelemetry("openInNewWindow");

      // Create the full screen panel
      let panel = vscode.window.createWebviewPanel(
        "xynapse.xynapseGUIView",
        "Xynapse",
        vscode.ViewColumn.One,
        {
          retainContextWhenHidden: true,
          enableScripts: true,
        },
      );
      fullScreenPanel = panel;

      // Add content to the panel
      panel.webview.html = sidebar.getSidebarContent(
        extensionContext,
        panel,
        undefined,
        undefined,
        true,
      );

      const sessionLoader = panel.onDidChangeViewState(() => {
        vscode.commands.executeCommand("xynapse.newSession");
        if (sessionId) {
          vscode.commands.executeCommand(
            "xynapse.focusXynapseSessionId",
            sessionId,
          );
        }
        panel.reveal();
        sessionLoader.dispose();
      });

      // When panel closes, reset the webview and focus
      panel.onDidDispose(
        () => {
          if (fullScreenPanel === panel) {
            fullScreenPanel = undefined;
          }
          if (!isMovingFullScreenPanelToNewWindow) {
            sidebar.resetWebviewProtocolWebview();
            vscode.commands.executeCommand("xynapse.focusInput");
          }
        },
        null,
        extensionContext.subscriptions,
      );

      isMovingFullScreenPanelToNewWindow = true;
      try {
        await vscode.commands.executeCommand(
          "workbench.action.moveEditorToNewWindow",
        );
      } catch (error) {
        console.warn("Failed to move Xynapse panel into a new window", error);
        void vscode.window.showWarningMessage(
          "Could not move Xynapse into a separate window. Keeping it open in this window.",
        );
        panel.reveal();
      } finally {
        setTimeout(() => {
          isMovingFullScreenPanelToNewWindow = false;
        }, 1500);
      }
    },
    "xynapse.forceNextEdit": async () => {
      captureCommandTelemetry("forceNextEdit");

      // This is basically the same logic as forceAutocomplete.
      // I'm writing a new command KV pair here in case we diverge in features.

      await vscode.commands.executeCommand("editor.action.inlineSuggest.hide");

      await vscode.commands.executeCommand(
        "editor.action.inlineSuggest.trigger",
      );
    },
  };
};

async function installModelWithProgress(
  modelName: string,
  modelInstaller: ModelInstaller,
) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Installing model '${modelName}'`,
      cancellable: true,
    },
    async (windowProgress, token) => {
      let currentProgress: number = 0;
      const progressWrapper = (
        details: string,
        worked?: number,
        total?: number,
      ) => {
        let increment = 0;
        if (worked && total) {
          const progressValue = Math.round((worked / total) * 100);
          increment = progressValue - currentProgress;
          currentProgress = progressValue;
        }
        windowProgress.report({ message: details, increment });
      };
      const abortController = new AbortController();
      token.onCancellationRequested(() => {
        console.log(`Pulling ${modelName} model was cancelled`);
        abortController.abort();
      });
      await modelInstaller.installModel(
        modelName,
        abortController.signal,
        progressWrapper,
      );
    },
  );
}

export async function registerAllCommands(
  context: vscode.ExtensionContext,
  ide: VsCodeIde,
  extensionContext: vscode.ExtensionContext,
  sidebar: XynapseGUIWebviewViewProvider,
  consoleView: XynapseConsoleWebviewViewProvider,
  configHandler: ConfigHandler,
  verticalDiffManager: VerticalDiffManager,
  battery: Battery,
  quickEdit: QuickEdit,
  core: Core,
  editDecorationManager: EditDecorationManager,
) {
  const existingCommands = new Set(await vscode.commands.getCommands(true));

  for (const [command, callback] of Object.entries(
    getCommandsMap(
      ide,
      extensionContext,
      sidebar,
      consoleView,
      configHandler,
      verticalDiffManager,
      battery,
      quickEdit,
      core,
      editDecorationManager,
    ),
  )) {
    if (existingCommands.has(command)) {
      continue;
    }

    context.subscriptions.push(
      vscode.commands.registerCommand(command, callback),
    );
    existingCommands.add(command);
  }

  void ensureSavedXynapseEnvironmentBridge().catch((error) => {
    console.warn("Failed to restore Xynapse Environment bridge", error);
  });
}

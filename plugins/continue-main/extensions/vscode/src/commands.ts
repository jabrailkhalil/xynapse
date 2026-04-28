/* eslint-disable @typescript-eslint/naming-convention */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
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
import { getMetaKeyLabel } from "./util/util";
import { openEditorAndRevealRange } from "./util/vscode";
import { VsCodeIde } from "./VsCodeIde";

let fullScreenPanel: vscode.WebviewPanel | undefined;
let isMovingFullScreenPanelToNewWindow = false;
const labProcesses = new Map<string, ReturnType<typeof spawn>>();

type ClawPromptRequest =
  | string
  | {
      prompt?: string;
      model?: string;
      modelTitle?: string;
      provider?: string;
      permissionMode?: ClawPermissionMode;
      planMode?: boolean;
      runId?: string;
      surface?: "core" | "lab";
      workspaceDir?: string;
    };

type ClawDoctorRequest = { runId?: string; workspaceDir?: string } | undefined;

type ClawPermissionMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

type ClawRunPlan = {
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
  permissionMode?: ClawPermissionMode;
  planMode?: boolean;
};

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
  request: ClawPromptRequest | ClawDoctorRequest,
) {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const requested =
    request && typeof request === "object" && "workspaceDir" in request
      ? request.workspaceDir?.trim()
      : undefined;

  if (requested) {
    const resolved = path.resolve(requested);
    const matchingFolder = workspaceFolders.find((folder) =>
      isSameOrInsidePath(folder.uri.fsPath, resolved),
    );
    if (matchingFolder) {
      return matchingFolder.uri.fsPath;
    }
  }

  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (activeEditorUri?.scheme === "file") {
    const activeWorkspace = vscode.workspace.getWorkspaceFolder(activeEditorUri);
    if (activeWorkspace) {
      return activeWorkspace.uri.fsPath;
    }
  }

  return workspaceFolders[0]?.uri.fsPath;
}

function getClawPermissionMode(request: ClawPromptRequest): ClawPermissionMode {
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

function getLabAllowedTools(permissionMode: ClawPermissionMode) {
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
  permissionMode: ClawPermissionMode,
  planMode = false,
  previousTurns: CoreConversationTurn[] = [],
) {
  const modeInstruction =
    planMode
      ? "Plan mode: inspect the workspace and produce a concrete implementation plan only. Do not edit files and do not run commands."
      : permissionMode === "danger-full-access"
        ? "Full access mode: you may inspect, edit files, and use runtime tools for this workspace task. Keep changes scoped and explain dangerous actions before using them."
        : permissionMode === "workspace-write"
      ? "You may inspect and edit files inside this workspace only. Before writing, identify the target files, keep changes minimal, and do not modify files outside the workspace."
      : "Read-only mode: inspect files and explain results, but do not edit files.";

  return [
    `Workspace root: ${cwd}`,
    modeInstruction,
    permissionMode === "danger-full-access"
      ? "Use file/search tools first. Shell/runtime tools are available only in full access mode after the user explicitly selected and confirmed this mode."
      : "Use the workspace file tools first: glob_search/grep_search/read_file for inspection, and edit_file/write_file only when edit mode is enabled. Do not use shell/bash in this embedded panel unless full access mode is selected.",
    formatCoreConversationContext(previousTurns),
    "User task:",
    prompt.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getClawRequestRunId(request: ClawPromptRequest | ClawDoctorRequest) {
  if (request && typeof request === "object" && "runId" in request) {
    return request.runId;
  }
  return undefined;
}

function isCoreRuntimeRequest(request: ClawPromptRequest) {
  return !(request && typeof request === "object" && request.surface === "lab");
}

function createLabRunId() {
  return `lab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    .replace(/\bclaw-code\b/gi, "Xynapse runtime")
    .replace(/\bclaw\.exe\b/gi, "xynapse-runtime.exe")
    .replace(/\bclaw\b/gi, "Xynapse runtime")
    .replace(new RegExp(`\\b${["cla", "ude"].join("")}\\b`, "gi"), "Xynapse");
}

function providerEnvSummary(env: Record<string, string>) {
  const merged = { ...process.env, ...env };
  const present = (key: string) =>
    merged[key]?.trim() ? "present" : "absent";
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

function coreConversationPath(cwd: string) {
  return path.join(cwd, ".xynapse", "runtime", "core-conversation.json");
}

function trimConversationText(text: string, limit = 12_000) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, 2_000)}\n\n[...trimmed...]\n\n${text.slice(-limit + 2_000)}`;
}

function readXynapseCoreConversation(cwd: string): CoreConversationTurn[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(coreConversationPath(cwd), "utf8"));
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
      .slice(-8);
  } catch {
    return [];
  }
}

function appendXynapseCoreConversationTurn(
  cwd: string,
  turn: Omit<CoreConversationTurn, "timestamp">,
) {
  try {
    const runtimeDir = path.dirname(coreConversationPath(cwd));
    fs.mkdirSync(runtimeDir, { recursive: true });
    const turns = readXynapseCoreConversation(cwd);
    turns.push({
      ...turn,
      user: trimConversationText(turn.user, 4_000),
      assistant: trimConversationText(turn.assistant),
      timestamp: new Date().toISOString(),
    });
    fs.writeFileSync(
      coreConversationPath(cwd),
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

function runClawInWebview(
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
    conversation?: {
      userPrompt: string;
      permissionMode: ClawPermissionMode;
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
  sendLabRunEvent(sidebar, {
    runId: options.runId,
    kind: "start",
    stream: "system",
    title: options.title,
    cwd: options.cwd,
    model: options.model,
    command: `xynapse-runtime ${args.join(" ")}`,
    text: [
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

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = sanitizeLabOutput(chunk.toString("utf8"));
    outputChunks.push(text);
    sendLabRunEvent(sidebar, {
      runId: options.runId,
      kind: "chunk",
      stream: "stdout",
      text,
    });
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = sanitizeLabOutput(chunk.toString("utf8"));
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
    if (options.conversation) {
      appendXynapseCoreConversationTurn(options.cwd, {
        user: options.conversation.userPrompt,
        assistant: outputChunks.join(""),
        exitCode,
        model: options.model,
        permissionMode: options.conversation.permissionMode,
        planMode: options.conversation.planMode,
      });
    }
    sendLabRunEvent(sidebar, {
      runId: options.runId,
      kind: "end",
      stream: "system",
      exitCode,
      text: `\nProcess exited with code ${exitCode ?? "unknown"}\n`,
    });
  });
}

function stopClawInWebview(
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
    const killer = spawn(
      "taskkill",
      ["/pid", String(child.pid), "/t", "/f"],
      { windowsHide: true, stdio: "ignore" },
    );
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

function setClawEnv(
  env: Record<string, string>,
  key: string,
  value: unknown,
) {
  if (process.env[key] || env[key] || !isUsableSecret(value)) {
    return;
  }
  env[key] = value.trim();
}

function normalizeProviderName(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/_/g, "-")
    .trim();
}

const YANDEX_OPENAI_BASE_URL = "https://llm.api.cloud.yandex.net/v1";

function collectClawEnvFromObject(value: unknown, env: Record<string, string>) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectClawEnvFromObject(item, env));
    return;
  }

  const record = value as Record<string, unknown>;
  const provider = normalizeProviderName(
    record.provider ?? record.name ?? record.uses,
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
      setClawEnv(env, key, vars[key]);
    }
  }

  const providerUnset = provider.length === 0;
  const isYandex = provider.includes("yandex");
  const isAnthropic =
    provider.includes("anthropic");
  const isOpenAi =
    isYandex ||
    provider.includes("openai") ||
    provider.includes("openai-compatible") ||
    provider.includes("deepseek") ||
    model.includes("deepseek") ||
    (providerUnset && (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")));
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
    setClawEnv(env, "ANTHROPIC_API_KEY", record.apiKey);
    setClawEnv(env, "ANTHROPIC_BASE_URL", record.apiBase ?? record.baseUrl);
  } else if (isOpenAi) {
    if (isYandex) {
      setClawEnv(env, "YANDEX_API_KEY", record.apiKey);
      setClawEnv(env, "YANDEX_BASE_URL", record.apiBase ?? record.baseUrl ?? YANDEX_OPENAI_BASE_URL);
      setClawEnv(env, "YANDEX_FOLDER_ID", record.folderId);
      setClawEnv(
        env,
        "YANDEX_FOLDER_ID",
        (record.requestOptions as any)?.extraBodyProperties?.folderId,
      );
    } else {
      setClawEnv(env, "OPENAI_API_KEY", record.apiKey);
      setClawEnv(
        env,
        "OPENAI_BASE_URL",
        provider.includes("deepseek") || model.includes("deepseek")
          ? (record.apiBase ?? record.baseUrl ?? "https://api.deepseek.com/v1")
          : (record.apiBase ?? record.baseUrl),
      );
    }
  } else if (isXai) {
    setClawEnv(env, "XAI_API_KEY", record.apiKey);
    setClawEnv(env, "XAI_BASE_URL", record.apiBase ?? record.baseUrl);
  } else if (isDashscope) {
    setClawEnv(env, "DASHSCOPE_API_KEY", record.apiKey);
    setClawEnv(env, "DASHSCOPE_BASE_URL", record.apiBase ?? record.baseUrl);
  }

  Object.values(record).forEach((item) => collectClawEnvFromObject(item, env));
}

function getConfiguredClawModelOverride() {
  const configured = vscode.workspace
    .getConfiguration("xynapse")
    .get<string>("clawModel")
    ?.trim();

  if (!configured || configured.toLowerCase() === "auto") {
    return undefined;
  }

  return configured;
}

function getModelIdentity(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const model = typeof record.model === "string" ? record.model.trim() : "";
  const title =
    typeof record.title === "string"
      ? record.title.trim()
      : typeof record.name === "string"
        ? record.name.trim()
        : "";
  const provider = normalizeProviderName(record.provider);
  const folderId =
    typeof record.folderId === "string"
      ? record.folderId.trim()
      : typeof (record.requestOptions as any)?.extraBodyProperties?.folderId === "string"
        ? (record.requestOptions as any).extraBodyProperties.folderId.trim()
        : "";

  if (!model && !title) {
    return undefined;
  }

  return { model, title, provider, folderId };
}

function flattenConfigModels(config: any): ILLM[] {
  const roles = config?.modelsByRole ?? {};
  const seen = new Set<string>();
  const models: ILLM[] = [];

  const addModel = (model: unknown) => {
    const identity = getModelIdentity(model);
    if (!identity) {
      return;
    }
    const key = `${identity.provider}:${identity.title}:${identity.model}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    models.push(model as ILLM);
  };

  if (Array.isArray(config?.models)) {
    config.models.forEach(addModel);
  }

  for (const value of Object.values(roles)) {
    if (!Array.isArray(value)) {
      continue;
    }
    value.forEach(addModel);
  }

  return models;
}

function loadRawConfigModels(): ILLM[] {
  const models: ILLM[] = [];

  for (const configPath of [getConfigYamlPath("vscode"), getConfigJsonPath()]) {
    try {
      if (!fs.existsSync(configPath)) {
        continue;
      }
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = configPath.endsWith(".json")
        ? JSON.parse(raw)
        : YAML.parse(raw);
      models.push(...flattenConfigModels(parsed));
    } catch (error) {
      console.warn(`Failed to read ${configPath} for Xynapse runtime models`, error);
    }
  }

  return models;
}

function findRequestedModel(
  config: any,
  request?: ClawPromptRequest,
  rawModels: ILLM[] = [],
) {
  const data = typeof request === "object" ? request : undefined;
  const requestedTitle = data?.modelTitle?.trim();
  const requestedModel = data?.model?.trim();
  const requestedProvider = normalizeProviderName(data?.provider);
  const models = [...rawModels, ...flattenConfigModels(config)];

  if (requestedTitle || requestedModel) {
    const requestedMatches = models.filter((model) => {
      const identity = getModelIdentity(model);
      if (!identity) {
        return false;
      }
      const titleMatches =
        !requestedTitle ||
        identity.title === requestedTitle ||
        identity.model === requestedTitle;
      const modelMatches =
        !requestedModel ||
        identity.model === requestedModel ||
        identity.title === requestedModel;
      return titleMatches && modelMatches;
    });

    if (requestedMatches.length > 0) {
      return requestedMatches[0];
    }
  }

  if (requestedProvider) {
    const match = models.find((model) => {
      const identity = getModelIdentity(model);
      return !!identity && identity.provider === requestedProvider;
    });

    if (match) {
      return match;
    }
  }

  return (
    config?.selectedModelByRole?.chat ??
    config?.selectedModelByRole?.edit ??
    config?.modelsByRole?.chat?.[0] ??
    models[0]
  );
}

function ensureOpenAiRoutingPrefix(model: string) {
  if (/^(openai|qwen|kimi|grok|xai|yandex)\//i.test(model)) {
    return model;
  }
  if (/^(gpt-|o1|o3|o4)/i.test(model)) {
    return model;
  }
  return `openai/${model}`;
}

function toYandexOpenAiModelUri(modelName: string, folderId: string) {
  if (modelName.startsWith("gpt:///") && folderId) {
    return `gpt://${folderId}/${modelName.slice("gpt:///".length)}`;
  }
  if (modelName.startsWith("gpt://")) {
    return modelName;
  }
  if (!folderId) {
    return undefined;
  }
  if (modelName.includes("/")) {
    return `gpt://${folderId}/${modelName}`;
  }
  return `gpt://${folderId}/${modelName}/latest`;
}

function toClawModel(model: ILLM | undefined) {
  const identity = getModelIdentity(model);
  if (!identity) {
    return undefined;
  }

  const provider = identity.provider;
  const modelName = identity.model || identity.title;
  const loweredModel = modelName.toLowerCase();

  if (provider.includes("yandex") || !!identity.folderId || modelName.startsWith("gpt://")) {
    const yandexModel = toYandexOpenAiModelUri(modelName, identity.folderId);
    return yandexModel ? `yandex/${yandexModel}` : undefined;
  }

  if (
    provider.includes("anthropic")
  ) {
    return modelName;
  }

  if (
    provider.includes("openai") ||
    provider.includes("openai-compatible") ||
    provider.includes("deepseek") ||
    loweredModel.includes("deepseek")
  ) {
    return ensureOpenAiRoutingPrefix(modelName);
  }

  if (provider.includes("xai") || provider.includes("grok") || loweredModel.includes("grok")) {
    return /^grok/i.test(modelName) ? modelName : `grok/${modelName}`;
  }

  if (provider.includes("dashscope") || provider === "qwen" || provider === "kimi") {
    if (/^(qwen|kimi)[/-]/i.test(modelName)) {
      return modelName;
    }
    return `qwen/${modelName}`;
  }

  return undefined;
}

async function collectClawEnv(configHandler: ConfigHandler, preferredModel?: ILLM) {
  const env: Record<string, string> = {};

  collectClawEnvFromObject(preferredModel, env);

  try {
    const { config } = await configHandler.loadConfig();
    collectClawEnvFromObject(config, env);
  } catch (error) {
    console.warn("Failed to read Xynapse config for Xynapse runtime env", error);
  }

  for (const configPath of [getConfigYamlPath("vscode"), getConfigJsonPath()]) {
    try {
      if (!fs.existsSync(configPath)) {
        continue;
      }
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = configPath.endsWith(".json")
        ? JSON.parse(raw)
        : YAML.parse(raw);
      collectClawEnvFromObject(parsed, env);
    } catch (error) {
      console.warn(`Failed to scan ${configPath} for Xynapse runtime env`, error);
    }
  }

  return env;
}

async function getClawRunPlan(
  configHandler: ConfigHandler,
  request?: ClawPromptRequest,
): Promise<ClawRunPlan | undefined> {
  let config: any;
  try {
    ({ config } = await configHandler.loadConfig());
  } catch (error) {
    console.warn("Failed to load Xynapse config for Xynapse runtime", error);
  }

  const rawModels = loadRawConfigModels();
  const selectedModel = findRequestedModel(config, request, rawModels);
  const override = getConfiguredClawModelOverride();
  const selectedRoute = toClawModel(selectedModel);
  const model = selectedRoute ?? override;

  if (!model) {
    const identity = getModelIdentity(selectedModel);
    const label = identity?.title || identity?.model || "selected model";
    void vscode.window.showErrorMessage(
      `Xynapse Core runtime cannot run with ${label} yet. Select an OpenAI-compatible, xAI/Grok, Yandex, or DashScope/Qwen model, or use Lab modes for non-coding reasoning.`,
    );
    return undefined;
  }

  return {
    model,
    env: await collectClawEnv(configHandler, selectedModel),
    label: getModelIdentity(selectedModel)?.title ?? model,
  };
}

async function showClawNotFoundMessage() {
  const action = await vscode.window.showErrorMessage(
    "Xynapse runtime was not found. Build or bundle the runtime, or set Xynapse: Lab Runtime Path if needed.",
    "Open Settings",
  );

  if (action === "Open Settings") {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "xynapse.clawPath",
    );
  }
}

async function resolveClawExecutable(
  ide: VsCodeIde,
  extensionContext: vscode.ExtensionContext,
  cwd: string,
) {
  const configured =
    vscode.workspace.getConfiguration("xynapse").get<string>("clawPath")?.trim() ??
    process.env.XYNAPSE_CLAW_PATH?.trim();
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
        "xynapse.clawPath",
      );
    }
    return undefined;
  }

  const binaryName = process.platform === "win32" ? "claw.exe" : "claw";
  const bundledCandidate = path.join(extensionContext.extensionPath, "bin", binaryName);
  if (fs.existsSync(bundledCandidate)) {
    return bundledCandidate;
  }

  const workspaceCandidate = path.join(
    cwd,
    ".external",
    "claw-code",
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
    "claw-code",
    "rust",
    "target",
    "debug",
    binaryName,
  );
  if (fs.existsSync(devCandidate)) {
    return devCandidate;
  }

  try {
    await ide.subprocess(process.platform === "win32" ? "where claw" : "command -v claw", cwd);
    return "claw";
  } catch {
    await showClawNotFoundMessage();
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
            "focusInputWithNewSession",
            undefined,
            false,
          );
        }
      } else {
        focusGUI();
        sidebar.webviewProtocol?.request(
          "focusInputWithNewSession",
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
          "focusInputWithoutClear",
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
    "xynapse.newSession": () => {
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
    "xynapse.focusXynapseSessionId": async (
      sessionId: string | undefined,
    ) => {
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
    "xynapse.openConfigPage": () => {
      vscode.commands.executeCommand("xynapse.navigateTo", "/config", false);
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
    "xynapse.clawDoctor": async (request?: ClawDoctorRequest) => {
      const runId = getClawRequestRunId(request) ?? createLabRunId();
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

      const executable = await resolveClawExecutable(ide, extensionContext, cwd);
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

      runClawInWebview(sidebar, executable, ["doctor"], {
        runId,
        cwd,
        env: await collectClawEnv(configHandler),
        title: "Xynapse runtime diagnostics",
        route: "doctor runtime=embedded",
      });
    },
    "xynapse.clawStop": async (request?: { runId?: string }) => {
      stopClawInWebview(sidebar, request);
    },
    "xynapse.clawPrompt": async (request?: ClawPromptRequest) => {
      const runId = getClawRequestRunId(request) ?? createLabRunId();
      const isCoreRequest = isCoreRuntimeRequest(request);
      const title = isCoreRequest ? "Xynapse Core task" : "Xynapse Lab algorithm";
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

      const permissionMode = getClawPermissionMode(request);
      const executable = await resolveClawExecutable(ide, extensionContext, cwd);
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

      const plan = await getClawRunPlan(configHandler, request);
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

      const previousTurns: CoreConversationTurn[] = [];
      const planMode = typeof request === "object" && !!request?.planMode;

      runClawInWebview(
        sidebar,
        executable,
        [
          "--model",
          plan.model,
          "--permission-mode",
          permissionMode,
          ...(getLabAllowedTools(permissionMode)
            ? ["--allowedTools", getLabAllowedTools(permissionMode)!]
            : []),
          "prompt",
          buildWorkspaceAwareLabPrompt(
            prompt,
            cwd,
            permissionMode,
            planMode,
            previousTurns,
          ),
        ],
        {
          runId,
          cwd,
          env: plan.env,
          title,
          model: plan.label,
          route: `model=${plan.model} label=${plan.label} permission=${permissionMode} runtime=embedded`,
          ...(isCoreRequest
            ? {
                sessionId: "xynapse-core",
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
      const autocompleteModels =
        xynapseConfig?.modelsByRole.autocomplete ?? [];
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
          vscode.commands.executeCommand("xynapse.navigateTo", "/config");
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
              vscode.Uri.parse("https://docs.xynapse.dev/yaml-migration"),
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
        await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
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
}

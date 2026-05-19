import { ToIdeFromWebviewOrCoreProtocol } from "./ide";
import { ToWebviewFromIdeOrCoreProtocol } from "./webview";

import {
  AcceptOrRejectDiffPayload,
  AddToChatPayload,
  ApplyState,
  ApplyToFilePayload,
  ContextItemWithId,
  HighlightedCodePayload,
  MessageContent,
  RangeInFile,
  RangeInFileWithContents,
  SetCodeToEditPayload,
  ShowFilePayload,
} from "../";

export type ToIdeFromWebviewProtocol = ToIdeFromWebviewOrCoreProtocol & {
  openUrl: [string, void];
  openFolder: [undefined, void];
  applyToFile: [ApplyToFilePayload, void];
  overwriteFile: [{ filepath: string; prevFileContent: string | null }, void];
  showTutorial: [undefined, void];
  showFile: [ShowFilePayload, void];
  toggleDevTools: [undefined, void];
  reloadWindow: [undefined, void];
  "xynapse/importProfile": [undefined, void];
  "xynapse/runtimeDoctor": [
    { runId?: string; workspaceDir?: string } | undefined,
    void,
  ];
  "xynapse/runtimePrompt": [
    {
      prompt?: string;
      model?: string;
      modelTitle?: string;
      provider?: string;
      permissionMode?: "read-only" | "workspace-write" | "danger-full-access";
      planMode?: boolean;
      runId?: string;
      surface?: "core" | "lab";
      workspaceDir?: string;
      sessionId?: string;
      previousDiscussion?: string;
      runtimeRules?: string;
      allowedTools?: string;
    } | undefined,
    void,
  ];
  "xynapse/runtimeStop": [{ runId?: string } | undefined, void];
  "xynapse/deleteRuntimeSession": [
    { sessionId?: string; workspaceDir?: string } | undefined,
    void,
  ];
  "xynapse/clearRuntimeSessions": [
    { workspaceDir?: string } | undefined,
    void,
  ];
  "xynapse/confirmAndRestoreRuntimeCheckpoint": [
    {
      runId?: string;
      sessionId?: string;
      workspaceDir?: string;
    } | undefined,
    {
      action: "restored" | "continue" | "cancel";
      message?: string;
    },
  ];
  focusEditor: [undefined, void];
  toggleFullScreen: [{ newWindow?: boolean } | undefined, void];
  insertAtCursor: [{ text: string }, void];
  copyText: [{ text: string }, void];
  "jetbrains/isOSREnabled": [undefined, boolean];
  "jetbrains/onLoad": [
    undefined,
    {
      windowId: string;
      serverUrl: string;
      workspacePaths: string[];
      vscMachineId: string;
      vscMediaUrl: string;
    },
  ];
  "jetbrains/getColors": [undefined, Record<string, string | null | undefined>];
  "vscode/openMoveRightMarkdown": [undefined, void];
  acceptDiff: [AcceptOrRejectDiffPayload, void];
  rejectDiff: [AcceptOrRejectDiffPayload, void];
  "edit/sendPrompt": [
    {
      prompt: MessageContent;
      range: RangeInFileWithContents;
    },
    string | undefined,
  ];
  "edit/addCurrentSelection": [undefined, void];
  "edit/clearDecorations": [undefined, void];
  "session/share": [{ sessionId: string }, void];
  createBackgroundAgent: [
    {
      content: MessageContent;
      contextItems: ContextItemWithId[];
      selectedCode: RangeInFile[];
      organizationId?: string;
      agent?: string;
    },
    void,
  ];
  listBackgroundAgents: [
    { organizationId?: string; limit?: number },
    {
      agents: Array<{
        id: string;
        name: string | null;
        status: string;
        repoUrl: string;
        createdAt: string;
        metadata?: {
          github_repo?: string;
        };
      }>;
      totalCount: number;
    },
  ];
  openAgentLocally: [
    {
      agentSessionId: string;
    },
    void,
  ];
};

export type ToWebviewFromIdeProtocol = ToWebviewFromIdeOrCoreProtocol & {
  setInactive: [undefined, void];
  newSessionWithPrompt: [{ prompt: string }, void];
  userInput: [{ input: string }, void];
  focusXynapseInput: [undefined, void];
  focusXynapseInputWithoutClear: [undefined, void];
  focusXynapseInputWithNewSession: [undefined, void];
  highlightedCode: [HighlightedCodePayload, void];
  setCodeToEdit: [SetCodeToEditPayload, void];
  navigateTo: [{ path: string; toggle?: boolean }, void];
  addModel: [undefined, void];

  focusXynapseSessionId: [{ sessionId: string | undefined }, void];
  newSession: [undefined, void];
  loadAgentSession: [{ session: any }, void];
  setTheme: [{ theme: any }, void];
  setColors: [{ [key: string]: string }, void];
  "jetbrains/editorInsetRefresh": [undefined, void];
  "jetbrains/isOSREnabled": [boolean, void];
  setupApiKey: [undefined, void];
  setupLocalConfig: [undefined, void];
  incrementFtc: [undefined, void];
  openOnboardingCard: [undefined, void];
  applyCodeFromChat: [undefined, void];
  updateApplyState: [ApplyState, void];
  exitEditMode: [undefined, void];
  focusEdit: [undefined, void];
  generateRule: [undefined, void];
  addToChat: [AddToChatPayload, void];
  updateWorkspacePaths: [string[], void];
  "xynapse/labRunEvent": [
    {
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
    void,
  ];
};

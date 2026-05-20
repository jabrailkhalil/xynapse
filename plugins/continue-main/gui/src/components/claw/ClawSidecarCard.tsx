import {
  ArrowPathIcon,
  BeakerIcon,
  ChevronDownIcon,
  CheckIcon,
  CommandLineIcon,
  ClipboardDocumentIcon,
  DocumentTextIcon,
  FolderOpenIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { renderChatMessage } from "core/util/messageContent";
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useWebviewListener } from "../../hooks/useWebviewListener";
import { useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import CouncilDialog, { CouncilConfig } from "../council/CouncilDialog";

export type XynapseMode = "core" | "lab";

type XynapseModeTabsProps = {
  showOpenFolderAction?: boolean;
  mode?: XynapseMode;
  onModeChange?: (mode: XynapseMode) => void;
  coreModelKey?: string;
  onCoreModelKeyChange?: (key: string) => void;
  coreRunMode?: CoreRunMode;
  onCoreRunModeChange?: (mode: CoreRunMode) => void;
  coreRunState?: LabRunState;
};

type XynapseModeSwitcherProps = {
  mode: XynapseMode;
  onModeChange: (mode: XynapseMode) => void;
};

export type LabRunStatus = "idle" | "running" | "done" | "error";
export type CoreRunMode = "plan" | "workspace-write" | "danger-full-access";

type LabOutputChunk = {
  id: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
};

export type LabRunState = {
  runId?: string;
  status: LabRunStatus;
  title: string;
  cwd?: string;
  model?: string;
  exitCode?: number | null;
  output: LabOutputChunk[];
};

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

export type LabModelLike = {
  model?: string;
  title?: string;
  provider?: string;
  apiKey?: string;
  apiBase?: string;
  baseUrl?: string;
  folderId?: string;
  requestOptions?: {
    extraBodyProperties?: {
      folderId?: string;
    };
  };
};

type LabNotice = {
  title: string;
  body: string;
  template?: string;
  runLabel?: string;
  runPrompt?: string;
};

export const DEFAULT_CORE_RUN_STATE: LabRunState = {
  status: "idle",
  title: "Ready for Core run",
  output: [],
};

export function createClientRunId() {
  return `lab-ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getLabModelKey(model: LabModelLike | null | undefined) {
  if (!model) {
    return "";
  }
  return `${model.provider ?? ""}::${model.title ?? ""}::${model.model ?? ""}`;
}

function getLabModelLabel(model: LabModelLike | null | undefined) {
  if (!model) {
    return "Select model";
  }
  return model.title ?? model.model ?? "selected model";
}

export function isCoreRuntimeSupportedModel(
  model: LabModelLike | null | undefined,
) {
  if (!model) {
    return false;
  }

  const provider = (model.provider ?? "").toLowerCase();
  const modelName = (model.model ?? model.title ?? "").toLowerCase();

  if (provider.includes("yandex") || modelName.startsWith("gpt://")) {
    return true;
  }
  if (provider.includes("anthropic")) {
    return true;
  }
  if (
    provider.includes("openai") ||
    provider.includes("openai-compatible") ||
    provider.includes("deepseek") ||
    modelName.includes("deepseek")
  ) {
    return true;
  }
  if (provider.includes("xai") || provider.includes("grok") || modelName.includes("grok")) {
    return true;
  }
  if (provider.includes("dashscope") || provider === "qwen" || provider === "kimi") {
    return true;
  }

  return false;
}

export function collectCoreRuntimeModels(
  config: any,
  selectedModel: LabModelLike | null,
) {
  return collectLabModels(config, selectedModel).filter(
    isCoreRuntimeSupportedModel,
  );
}

export function findCoreRuntimeModel(
  config: any,
  selectedModel: LabModelLike | null | undefined,
) {
  const models = collectCoreRuntimeModels(config, selectedModel ?? null);
  return (
    models.find((model) => getLabModelKey(model) === getLabModelKey(selectedModel)) ??
    models[0]
  );
}

function trimChatContext(text: string, limit = 1_800) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, 600)}\n[...trimmed...]\n${text.slice(-limit + 600)}`;
}

export function buildPreviousDiscussion(
  history: Array<{ message?: { role?: string } }>,
) {
  const turns = history
    .filter((item) => {
      const role = item.message?.role;
      return role === "user" || role === "assistant";
    })
    .slice(-8)
    .map((item) => {
      const role = item.message?.role === "assistant" ? "Xynapse" : "User";
      const text = item.message ? renderChatMessage(item.message as any) : "";
      return `${role}: ${trimChatContext(text.trim())}`;
    })
    .filter((line) => !line.endsWith(": "));

  return trimChatContext(turns.join("\n\n"), 10_000);
}

export function collectLabModels(
  config: any,
  selectedModel: LabModelLike | null,
) {
  const models: LabModelLike[] = [];
  const seen = new Set<string>();

  const add = (model: unknown) => {
    if (!model || typeof model !== "object") {
      return;
    }
    const candidate = model as LabModelLike;
    if (!candidate.model && !candidate.title) {
      return;
    }
    const key = getLabModelKey(candidate);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    models.push(candidate);
  };

  add(selectedModel);
  if (Array.isArray(config?.models)) {
    config.models.forEach(add);
  }
  for (const model of Object.values(config?.selectedModelByRole ?? {})) {
    add(model);
  }
  for (const roleModels of Object.values(config?.modelsByRole ?? {})) {
    if (Array.isArray(roleModels)) {
      roleModels.forEach(add);
    }
  }

  return models;
}

type EnvironmentOpenResult = {
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
  supportedProviders?: string[];
  environmentProvider?: string;
  environmentProviderLabel?: string;
  environmentModel?: string;
  environmentSourceLabel?: string;
  environmentCredentialEnv?: string;
  environmentApiKeyConfigured?: boolean;
  environmentBaseUrl?: string;
};

type EnvironmentPermissionChoice =
  | "default"
  | "plan"
  | "acceptEdits"
  | "dontAsk"
  | "bypassPermissions";

const ENVIRONMENT_PERMISSION_OPTIONS: Array<{
  value: EnvironmentPermissionChoice;
  label: string;
  description: string;
}> = [
  {
    value: "default",
    label: "Default",
    description: "Use the upstream client's normal permission prompts",
  },
  {
    value: "plan",
    label: "Plan",
    description: "Plan first, do not edit until approved",
  },
  {
    value: "acceptEdits",
    label: "Accept edits",
    description: "Allow file edits after the client's own checks",
  },
  {
    value: "dontAsk",
    label: "Don't ask",
    description: "Let the upstream client avoid repeated prompts",
  },
  {
    value: "bypassPermissions",
    label: "Bypass",
    description: "Bypass upstream permission checks",
  },
];

function EnvironmentActionButton({
  icon,
  label,
  title,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex min-h-[34px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-solid border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-description transition hover:bg-white/10 hover:text-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function getEnvironmentProviderId(model: LabModelLike | null | undefined) {
  if (!model) {
    return undefined;
  }

  const provider = (model.provider ?? "").toLowerCase().replace(/_/g, "-");
  const modelName = (model.model ?? model.title ?? "").toLowerCase().trim();
  const prefix = modelName.split("/", 1)[0];

  if (provider.includes("yandex") || modelName.startsWith("gpt://")) {
    return "Xynapse Bridge";
  }
  if (provider.includes("gigachat") || provider.includes("sber")) {
    return undefined;
  }
  if (provider.includes("openrouter") || provider.includes("open-router") || prefix === "openrouter" || prefix === "open_router") {
    return "OpenRouter";
  }
  if (provider.includes("deepseek") || prefix === "deepseek") {
    return "DeepSeek";
  }
  if (provider.includes("kimi") || provider.includes("moonshot") || prefix === "kimi") {
    return "Kimi";
  }
  if (provider.includes("fireworks") || prefix === "fireworks") {
    return "Fireworks";
  }
  if (provider === "zai" || provider.includes("z.ai") || prefix === "zai") {
    return "Z.ai";
  }
  if (provider.includes("nvidia") || prefix === "nvidia_nim" || prefix === "nvidia") {
    return "NVIDIA NIM";
  }
  if (provider.includes("wafer") || prefix === "wafer") {
    return "Wafer";
  }
  if (provider.includes("opencode") || prefix === "opencode") {
    return "OpenCode";
  }
  if (provider.includes("lmstudio") || provider.includes("lm-studio") || prefix === "lmstudio") {
    return "LM Studio";
  }
  if (provider.includes("llamacpp") || provider.includes("llama.cpp") || prefix === "llamacpp") {
    return "llama.cpp";
  }
  if (provider.includes("ollama") || prefix === "ollama") {
    return "Ollama";
  }

  return undefined;
}

function isEnvironmentCompatibleModel(model: LabModelLike | null | undefined) {
  return Boolean(getEnvironmentProviderId(model));
}

function ModeTabButton({
  active,
  label,
  description,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={`${label}: ${description}`}
      className={`min-w-0 cursor-pointer border-x-0 border-b-2 border-t-0 border-solid bg-transparent px-3 py-2 text-left text-sm font-semibold transition focus:outline-none ${
        active
          ? "border-violet-300 text-foreground"
          : "border-transparent text-description hover:border-violet-200/40 hover:text-foreground"
      }`}
      onClick={onClick}
      title={title}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

function ModelDropdown({
  disabled,
  models,
  selectedKey,
  selectedModel,
  onChange,
}: {
  disabled: boolean;
  models: LabModelLike[];
  selectedKey: string;
  selectedModel: LabModelLike | undefined;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="box-border flex min-h-[34px] w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-solid border-violet-300/20 bg-[#09090b] px-3 py-2 text-left text-xs text-foreground outline-none transition hover:border-violet-300/35 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:bg-[#09090b] disabled:text-description disabled:opacity-60"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title="Select the model used by Xynapse Core runtime"
      >
        <span className="min-w-0 truncate">
          {getLabModelLabel(selectedModel)}
        </span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 text-violet-100 transition ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-64 overflow-y-auto rounded-xl border border-solid border-violet-300/20 bg-[#111014] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
          {models.length === 0 ? (
            <div className="px-3 py-2 text-xs text-description">
              No configured models
            </div>
          ) : null}
          {models.map((model) => {
            const key = getLabModelKey(model);
            const active = key === selectedKey;
            return (
              <button
                type="button"
                className={`box-border flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border-0 px-3 py-2 text-left text-xs outline-none transition ${
                  active
                    ? "bg-[#21172d] text-violet-50 shadow-[inset_0_0_0_1px_rgba(196,181,253,0.24)] hover:bg-[#261936] focus:bg-[#261936] focus:text-violet-50"
                    : "bg-transparent text-description hover:bg-[#18131f] hover:text-foreground focus:bg-[#18131f] focus:text-foreground"
                }`}
                key={key}
                onClick={() => {
                  onChange(key);
                  setOpen(false);
                }}
                title={`${getLabModelLabel(model)}${model.provider ? ` (${model.provider})` : ""}`}
              >
                <span className="min-w-0 truncate">
                  {getLabModelLabel(model)}
                </span>
                {model.provider ? (
                  <span className="shrink-0 text-[10px] opacity-60">
                    {model.provider}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AlgorithmButton({
  title,
  description,
  active,
  onClick,
}: {
  title: string;
  description: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-xl border border-solid px-3 py-2 text-left text-xs font-medium transition focus:outline-none ${
        active
          ? "border-violet-300/25 bg-[#191322] text-violet-50 hover:bg-violet-300/16 focus:bg-[#241a31]"
          : "border-white/10 bg-black/25 text-foreground hover:bg-white/5 focus:bg-white/5"
      }`}
      onClick={onClick}
      title={description}
    >
      {title}
      <div className="mt-0.5 text-[10px] font-normal text-description">
        {description}
      </div>
    </button>
  );
}

function getLabHistoryKindLabel(kind: string) {
  switch (kind) {
    case "bvc":
      return "BVC";
    case "council":
      return "Council";
    case "audit":
      return "Audit";
    case "compare":
      return "Compare";
    default:
      return "Research";
  }
}

function getLabHistoryStatusLabel(item: LabHistoryItem) {
  if (item.exitCode === 0) {
    return "done";
  }
  if (item.exitCode === null || item.exitCode === undefined) {
    return "saved";
  }
  return "error";
}

function formatLabHistoryDate(value?: string) {
  if (!value) {
    return "Unknown date";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function LabHistoryPanel({
  items,
  loading,
  error,
  search,
  onSearchChange,
  onRefresh,
  onOpenArtifact,
  onCopyCorePrompt,
  copiedPromptId,
}: {
  items: LabHistoryItem[];
  loading: boolean;
  error: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onOpenArtifact: (relPath: string) => void;
  onCopyCorePrompt: (item: LabHistoryItem) => void;
  copiedPromptId: string | null;
}) {
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return items;
    }
    return items.filter((item) =>
      [
        item.title,
        item.task,
        item.kind,
        item.model,
        item.summary,
        item.reportRelPath,
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase()
        .includes(query),
    );
  }, [items, search]);

  return (
    <div className="mt-4 rounded-xl border border-solid border-violet-300/15 bg-[#08080a] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-100">
            Research history
          </div>
          <div className="mt-0.5 text-[10px] text-description">
            Saved Lab reports and Core-ready plans from this workspace.
          </div>
        </div>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-solid border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-description transition hover:bg-white/10 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
          disabled={loading}
          onClick={onRefresh}
          title="Refresh saved Lab research reports."
        >
          <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <input
        className="mt-3 box-border w-full rounded-lg border border-solid border-white/10 bg-black/35 px-3 py-2 text-xs text-foreground placeholder:text-description focus:border-violet-300/40 focus:outline-none"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search research, task, model, report..."
        title="Filter Lab research history."
      />

      {error ? (
        <div className="mt-3 rounded-lg border border-solid border-red-300/20 bg-red-300/10 p-2 text-xs leading-5 text-red-100">
          {error}
        </div>
      ) : null}

      <div className="mt-3 max-h-80 space-y-2 overflow-auto pr-1">
        {loading && items.length === 0 ? (
          <div className="rounded-lg border border-solid border-white/10 bg-black/25 p-3 text-xs text-description">
            Loading Lab history...
          </div>
        ) : null}

        {!loading && filteredItems.length === 0 ? (
          <div className="rounded-lg border border-solid border-white/10 bg-black/25 p-3 text-xs leading-5 text-description">
            No saved Lab research yet. Run Council, BVC, Audit, or Compare; the
            report will appear here after completion.
          </div>
        ) : null}

        {filteredItems.map((item) => {
          const status = getLabHistoryStatusLabel(item);
          const copied = copiedPromptId === item.id;

          return (
            <article
              key={item.id}
              className="rounded-lg border border-solid border-white/10 bg-black/25 p-3"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="rounded-full border border-solid border-violet-300/20 bg-violet-300/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-violet-100">
                  {getLabHistoryKindLabel(item.kind)}
                </span>
                <span
                  className={`rounded-full border border-solid px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                    status === "error"
                      ? "border-red-300/20 bg-red-300/10 text-red-100"
                      : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                  }`}
                >
                  {status}
                </span>
                <span className="min-w-0 truncate text-[10px] text-description">
                  {formatLabHistoryDate(item.createdAt ?? item.updatedAt)}
                </span>
              </div>

              <div className="mt-2 min-w-0 truncate text-sm font-semibold text-foreground">
                {item.task || item.title}
              </div>
              {item.model ? (
                <div className="mt-1 truncate text-[10px] text-description">
                  {item.model}
                </div>
              ) : null}
              {item.summary ? (
                <p className="m-0 mt-2 line-clamp-3 text-xs leading-5 text-description">
                  {item.summary}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-solid border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-description transition hover:bg-white/10 hover:text-foreground"
                  onClick={() => onOpenArtifact(item.reportRelPath)}
                  title={item.reportRelPath}
                >
                  <DocumentTextIcon className="h-3.5 w-3.5" />
                  Report
                </button>
                {item.planRelPath ? (
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-solid border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-description transition hover:bg-white/10 hover:text-foreground"
                    onClick={() => onOpenArtifact(item.planRelPath!)}
                    title={item.planRelPath}
                  >
                    <DocumentTextIcon className="h-3.5 w-3.5" />
                    Core plan
                  </button>
                ) : null}
                {item.corePrompt ? (
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-solid border-violet-300/20 bg-[#191322] px-2 py-1 text-[10px] font-medium text-violet-50 transition hover:bg-violet-300/16"
                    onClick={() => onCopyCorePrompt(item)}
                    title="Copy the prepared prompt for Xynapse Core."
                  >
                    {copied ? (
                      <CheckIcon className="h-3.5 w-3.5" />
                    ) : (
                      <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                    )}
                    {copied ? "Copied" : "Copy Core prompt"}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function XynapseLabHistoryView() {
  const navigate = useNavigate();
  const ideMessenger = useContext(IdeMessengerContext);
  const [historyItems, setHistoryItems] = useState<LabHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  const workspaceDir = useMemo(() => {
    const workspacePaths = (window as any).workspacePaths;
    return Array.isArray(workspacePaths) ? workspacePaths[0] : undefined;
  }, []);

  const refreshLabHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await ideMessenger.request("xynapse/listLabHistory", {
        workspaceDir,
      });
      if (response.status === "success") {
        setHistoryItems(response.content?.items ?? []);
        setHistoryError(response.content?.error ?? null);
      } else {
        setHistoryError(response.error);
      }
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : "Could not load Lab history.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [ideMessenger, workspaceDir]);

  const openLabArtifact = useCallback(
    async (relPath: string) => {
      setHistoryError(null);
      const response = await ideMessenger.request("xynapse/openLabArtifact", {
        workspaceDir,
        relPath,
      });
      if (response.status === "success") {
        if (!response.content?.ok) {
          setHistoryError(response.content?.error ?? "Could not open Lab artifact.");
        }
      } else {
        setHistoryError(response.error);
      }
    },
    [ideMessenger, workspaceDir],
  );

  const copyCorePrompt = useCallback(
    (item: LabHistoryItem) => {
      if (!item.corePrompt) {
        return;
      }
      ideMessenger.post("copyText", { text: item.corePrompt });
      setCopiedPromptId(item.id);
      setTimeout(() => setCopiedPromptId(null), 1400);
    },
    [ideMessenger],
  );

  useEffect(() => {
    void refreshLabHistory();
  }, [refreshLabHistory]);

  return (
    <div className="flex flex-1 flex-col overflow-auto overflow-x-hidden px-2 pb-3">
      <div className="my-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-100">
            Xynapse Lab
          </div>
          <h2 className="m-0 mt-1 text-base font-semibold text-foreground">
            Research history
          </h2>
          <p className="m-0 mt-1 text-xs leading-5 text-description">
            Saved research reports and Core-ready plans for the current workspace.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center rounded-lg border border-solid border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-description transition hover:bg-white/10 hover:text-foreground"
          onClick={() => navigate("/")}
          title="Return to Xynapse Lab."
        >
          Back
        </button>
      </div>
      <LabHistoryPanel
        items={historyItems}
        loading={historyLoading}
        error={historyError}
        search={historySearch}
        onSearchChange={setHistorySearch}
        onRefresh={refreshLabHistory}
        onOpenArtifact={openLabArtifact}
        onCopyCorePrompt={copyCorePrompt}
        copiedPromptId={copiedPromptId}
      />
    </div>
  );
}

export function XynapseEnvironmentCard({
  showOpenFolderAction,
}: {
  showOpenFolderAction?: boolean;
}) {
  const ideMessenger = useContext(IdeMessengerContext);
  const selectedChatModel = useAppSelector(selectSelectedChatModel);
  const config = useAppSelector((state) => state.config.config);
  const [permissionChoice, setPermissionChoice] =
    useState<EnvironmentPermissionChoice>("default");
  const [environmentModelKey, setEnvironmentModelKey] = useState(() =>
    localStorage.getItem("xynapse.environmentModelKey") ?? "",
  );
  const [status, setStatus] = useState<EnvironmentOpenResult | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [terminalRunId, setTerminalRunId] = useState<string | null>(null);
  const [runState, setRunState] = useState<LabRunState>({
    status: "idle",
    title: "Environment task output",
    output: [],
  });
  const workspaceDir =
    ((window as any).workspacePaths?.[0] as string | undefined) ?? undefined;

  const environmentModels = useMemo(
    () => collectLabModels(config, selectedChatModel),
    [config, selectedChatModel],
  );
  const selectedEnvironmentModel =
    environmentModels.find((model) => getLabModelKey(model) === environmentModelKey) ??
    environmentModels.find(isEnvironmentCompatibleModel) ??
    environmentModels[0] ??
    null;
  const selectedEnvironmentProvider = getEnvironmentProviderId(
    selectedEnvironmentModel,
  );
  const isSelectedEnvironmentCompatible = isEnvironmentCompatibleModel(
    selectedEnvironmentModel,
  );

  useEffect(() => {
    if (!selectedEnvironmentModel) {
      return;
    }
    const key = getLabModelKey(selectedEnvironmentModel);
    if (key && key !== environmentModelKey) {
      setEnvironmentModelKey(key);
      localStorage.setItem("xynapse.environmentModelKey", key);
    }
  }, [environmentModelKey, selectedEnvironmentModel]);

  const selectedPermission = ENVIRONMENT_PERMISSION_OPTIONS.find(
    (option) => option.value === permissionChoice,
  );

  const requestEnvironment = useCallback(async (
    action:
      | "status"
      | "update"
      | "install"
      | "startServer"
      | "startClient"
      | "stop",
    extra?: { runId?: string },
  ) => {
    if (showOpenFolderAction && action !== "status") {
      setStatus({ ok: false, message: "Open a project folder first." });
      return null;
    }

    if (
      (action === "startServer" || action === "startClient") &&
      !isSelectedEnvironmentCompatible
    ) {
      setStatus({
        ok: false,
        message:
          "The selected Xynapse model is not supported by Environment. Choose a Yandex-backed Xynapse model or a model backed by OpenRouter, DeepSeek, Kimi, Fireworks, Z.ai, NVIDIA NIM, Wafer, OpenCode, LM Studio, llama.cpp, or Ollama.",
      });
      return null;
    }

    const runId =
      extra?.runId ??
      (action === "stop"
        ? runState.runId
        : createClientRunId());
    setBusyAction(action);
    try {
      const response = await Promise.race([
        ideMessenger.request("xynapse/openEnvironment", {
          action,
          runId,
          workspaceDir,
          permissionMode: permissionChoice,
          environmentProvider: selectedEnvironmentModel?.provider,
          environmentModel: selectedEnvironmentModel?.model,
          environmentModelTitle: selectedEnvironmentModel?.title,
          environmentApiKey: selectedEnvironmentModel?.apiKey,
          environmentBaseUrl:
            selectedEnvironmentModel?.apiBase ??
            selectedEnvironmentModel?.baseUrl,
          environmentFolderId:
            selectedEnvironmentModel?.folderId ??
            selectedEnvironmentModel?.requestOptions?.extraBodyProperties?.folderId,
        }),
        new Promise<{
          status: "error";
          error: string;
        }>((resolve) =>
          setTimeout(
            () =>
              resolve({
                status: "error",
                error:
                  "Environment did not respond. Try Reload Window and open it again.",
              }),
            8000,
          ),
        ),
      ]);
      if (response.status === "success") {
        setStatus(response.content);
        return response.content;
      } else {
        setStatus({
          ok: false,
          message: response.error,
        });
      }
    } catch (error) {
      setStatus({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not open Environment.",
      });
    } finally {
      setBusyAction(null);
    }
    return null;
  }, [
    ideMessenger,
    isSelectedEnvironmentCompatible,
    permissionChoice,
    runState.runId,
    selectedEnvironmentModel,
    showOpenFolderAction,
    workspaceDir,
  ]);

  useEffect(() => {
    void requestEnvironment("status");
  }, [requestEnvironment]);

  useWebviewListener(
    "xynapse/environmentEvent",
    async (event) => {
      setRunState((previous) => {
        const output =
          event.text && event.text.length > 0
            ? [
                ...previous.output,
                {
                  id: `${event.runId}-${previous.output.length}-${Date.now()}`,
                  stream: event.stream ?? "system",
                  text: event.text,
                },
              ]
            : previous.output;

        if (event.kind === "start") {
          return {
            runId: event.runId,
            status: "running",
            title: event.title ?? "Environment task output",
            cwd: event.cwd,
            output,
          };
        }

        if (previous.runId && event.runId !== previous.runId) {
          return previous;
        }

        if (event.kind === "chunk") {
          return { ...previous, status: "running", output };
        }

        if (event.kind === "error") {
          return { ...previous, status: "error", output };
        }

        return {
          ...previous,
          status: event.exitCode === 0 ? "done" : "error",
          exitCode: event.exitCode,
          output,
        };
      });
    },
    [],
  );

  const outputText =
    runState.output.length > 0
      ? runState.output.map((chunk) => chunk.text).join("")
      : "No Environment task output yet. Install/update logs appear here. Coding sessions open in the IDE Terminal panel.";

  const startCodingSession = async () => {
    const response = await requestEnvironment("startClient");
    if (response?.ok && response.runId) {
      setTerminalRunId(response.runId);
    }
  };

  const stopActiveEnvironment = async () => {
    const runId =
      terminalRunId ??
      (runState.status === "running" ? runState.runId : undefined);
    if (!runId) {
      return;
    }
    const response = await requestEnvironment("stop", { runId });
    if (response?.ok && runId === terminalRunId) {
      setTerminalRunId(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-auto overflow-x-hidden px-2 pb-3">
      <section className="my-3 rounded-2xl border border-solid border-violet-300/15 bg-[#0b0a0d] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CommandLineIcon className="h-5 w-5 text-violet-100" />
              <h2 className="m-0 text-base font-semibold text-foreground">
                Environment
              </h2>
              <span className="rounded-full border border-solid border-violet-300/20 bg-violet-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-100">
                Upstream
              </span>
            </div>
            <p className="m-0 mt-2 text-sm leading-6 text-description">
              Uses a clean checkout of the upstream project in
              .external/environment. The proxy runs in the background; the
              coding session opens in the IDE integrated terminal for the
              opened project.
            </p>
          </div>
        </div>

        {showOpenFolderAction ? (
          <div className="mt-4 rounded-xl border border-solid border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
            Open a project folder before starting Environment.
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3">
          <div className="rounded-xl border border-solid border-white/10 bg-[#08080a] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-description">
              Xynapse model
            </div>
            <select
              className="mt-2 w-full rounded-lg border border-solid border-white/10 bg-[#08080a] px-3 py-2 text-sm text-foreground outline-none"
              value={getLabModelKey(selectedEnvironmentModel)}
              disabled={busyAction !== null || environmentModels.length === 0}
              onChange={(event) => {
                setEnvironmentModelKey(event.target.value);
                localStorage.setItem("xynapse.environmentModelKey", event.target.value);
              }}
            >
              {environmentModels.map((model) => {
                const key = getLabModelKey(model);
                const provider = getEnvironmentProviderId(model);
                return (
                  <option key={key} value={key}>
                    {getLabModelLabel(model)}
                    {provider ? ` - ${provider}` : " - Core/Lab only"}
                  </option>
                );
              })}
            </select>
            <div className="mt-2 grid grid-cols-1 gap-1 text-xs leading-5 text-description">
              <div>
                Selected:{" "}
                {selectedEnvironmentModel
                  ? getLabModelLabel(selectedEnvironmentModel)
                  : "no Xynapse model"}
              </div>
              <div>
                Environment route:{" "}
                {selectedEnvironmentProvider ??
                  "not supported by Environment"}
              </div>
              <div>
                Active upstream model:{" "}
                {status?.environmentModel ?? "will be prepared on start"}
              </div>
            </div>
            {!isSelectedEnvironmentCompatible ? (
              <div className="mt-2 rounded-lg border border-solid border-amber-300/20 bg-amber-300/10 p-2 text-[11px] leading-5 text-amber-100">
                This model remains available in Core/Lab. Environment can only
                run Yandex models through Xynapse Bridge or providers supported
                directly by the upstream free-claude-code runtime.
              </div>
            ) : (
              <div className="mt-2 text-[11px] leading-5 text-description">
                The upstream session will use this Xynapse model and its saved
                Xynapse key; there is no separate Environment key picker.
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-description">
              Client permission mode
            </span>
            <select
              className="mt-1 w-full rounded-lg border border-solid border-white/10 bg-[#08080a] px-3 py-2 text-sm text-foreground outline-none"
              value={permissionChoice}
              disabled={busyAction !== null}
              onChange={(event) =>
                setPermissionChoice(event.target.value as EnvironmentPermissionChoice)
              }
            >
              {ENVIRONMENT_PERMISSION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {selectedPermission ? (
              <span className="mt-1 block text-xs text-description">
                {selectedPermission.description}
              </span>
            ) : null}
          </label>
        </div>

        <div className="mt-4 rounded-xl border border-solid border-white/10 bg-[#08080a] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-100">
                Upstream status
              </div>
              <p className="m-0 mt-2 text-xs leading-5 text-description">
                {status?.message ??
                  (busyAction
                    ? "Working..."
                    : "Checking upstream Environment status.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <EnvironmentActionButton
                icon={<ArrowPathIcon className="h-3.5 w-3.5" />}
                label="Refresh"
                title="Refresh Environment status."
                disabled={busyAction !== null}
                onClick={() => void requestEnvironment("status")}
              />
              <EnvironmentActionButton
                icon={<ArrowPathIcon className="h-3.5 w-3.5" />}
                label="Update upstream"
                title="Pull the clean upstream checkout and reinstall the tool when uv is available."
                disabled={busyAction !== null}
                onClick={() => void requestEnvironment("update")}
              />
              <EnvironmentActionButton
                icon={<WrenchScrewdriverIcon className="h-3.5 w-3.5" />}
                label="Install runtime"
                title="Install uv/Python 3.14 and the upstream commands."
                disabled={busyAction !== null}
                onClick={() => void requestEnvironment("install")}
              />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-description">
            {status?.upstreamRoot ? (
              <div className="truncate">Checkout: {status.upstreamRoot}</div>
            ) : null}
            {status?.upstreamCommit ? (
              <div>
                Commit: {status.upstreamCommit}
                {status.upstreamDirty ? " (local changes)" : ""}
              </div>
            ) : null}
            <div>
              uv: {status?.uvInstalled ? "installed" : "missing"} | Python
              3.14: {status?.python314Installed ? "installed" : "missing"} |
              upstream commands: {status?.fccInstalled ? "installed" : "missing"}
            </div>
            <div>
              Client command: {status?.clientInstalled ? "installed" : "missing"}
            </div>
            {status?.supportedProviders?.length ? (
              <div>
                Providers from upstream: {status.supportedProviders.join(", ")}.
                Core-only providers stay in Core/Lab unless upstream adds them.
              </div>
            ) : null}
            <div>
              Proxy server: {status?.serverRunning ? "running" : "stopped"}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-solid border-white/10 bg-[#08080a] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-100">
                Coding session
              </div>
              <p className="m-0 mt-1 text-xs leading-5 text-description">
                Start a coding session in the real IDE terminal. The proxy
                server starts in the background automatically.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <EnvironmentActionButton
                icon={<CommandLineIcon className="h-3.5 w-3.5" />}
                label="Start proxy"
                title="Start the upstream local proxy server in the background."
                disabled={busyAction !== null || !isSelectedEnvironmentCompatible}
                onClick={() => void requestEnvironment("startServer")}
              />
              <EnvironmentActionButton
                icon={<CommandLineIcon className="h-3.5 w-3.5" />}
                label="Open terminal session"
                title="Start an interactive upstream code session in the IDE terminal."
                disabled={
                  busyAction !== null ||
                  showOpenFolderAction ||
                  !isSelectedEnvironmentCompatible
                }
                onClick={() => void startCodingSession()}
              />
              <EnvironmentActionButton
                icon={<CheckIcon className="h-3.5 w-3.5" />}
                label={terminalRunId ? "Stop terminal" : "Stop task"}
                title="Stop the active Environment terminal or task process."
                disabled={
                  busyAction !== null ||
                  (!terminalRunId && (!runState.runId || runState.status !== "running"))
                }
                onClick={() => void stopActiveEnvironment()}
              />
            </div>
          </div>
          <pre
            aria-label="Environment task output"
            className="mt-3 max-h-64 min-h-[120px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-solid border-white/10 bg-black/45 p-3 font-mono text-[11px] leading-5 text-zinc-200"
          >
            {outputText}
          </pre>
          <div className="mt-2 text-[11px] leading-5 text-description">
            This panel only shows setup/update output. The coding session uses
            the native Terminal panel, so prompts, arrows, Backspace, Esc, and
            Ctrl+C work normally.
          </div>
        </div>
      </section>
    </div>
  );
}

export function XynapseResearchCard({
  showOpenFolderAction,
}: XynapseModeTabsProps) {
  const ideMessenger = useContext(IdeMessengerContext);
  const chatHistory = useAppSelector((state) => state.session.history);
  const previousDiscussion = useMemo(
    () => buildPreviousDiscussion(chatHistory),
    [chatHistory],
  );
  const [labNotice, setLabNotice] = useState<LabNotice | null>(null);
  const [activeCouncilMode, setActiveCouncilMode] = useState<
    "council" | "bvc" | null
  >(null);
  const [runState, setRunState] = useState<LabRunState>({
    status: "idle",
    title: "Ready for Lab run",
    output: [],
  });

  useWebviewListener(
    "xynapse/labRunEvent",
    async (event) => {
      setRunState((previous) => {
        if (event.kind === "start") {
          return {
            runId: event.runId,
            status: "running",
            title: event.title ?? "Xynapse Lab run",
            cwd: event.cwd,
            model: event.model,
            output: event.text
              ? [
                  {
                    id: `${event.runId}-start`,
                    stream: event.stream ?? "system",
                    text: event.text,
                  },
                ]
              : [],
          };
        }

        if (previous.runId && event.runId !== previous.runId) {
          return previous;
        }

        const output =
          event.text && event.text.length > 0
            ? [
                ...previous.output,
                {
                  id: `${event.runId}-${previous.output.length}-${Date.now()}`,
                  stream: event.stream ?? "system",
                  text: event.text,
                },
              ]
            : previous.output;

        if (event.kind === "chunk") {
          return { ...previous, status: "running", output };
        }

        if (event.kind === "error") {
          return { ...previous, status: "error", output };
        }

        return {
          ...previous,
          status: event.exitCode === 0 ? "done" : "error",
          exitCode: event.exitCode,
          output,
        };
      });
    },
    [],
  );

  const openCouncilDialog = (mode: "council" | "bvc") => {
    setLabNotice(null);
    setActiveCouncilMode(mode);
  };

  const prepareCouncilRun = (
    mode: "council" | "bvc",
    config: CouncilConfig,
  ) => {
    setActiveCouncilMode(null);
    setLabNotice({
      title: mode === "bvc" ? "BVC verification prepared" : "Council run prepared",
      body:
        mode === "bvc"
          ? "BVC is a non-coding verification mode. It checks a candidate answer against criteria, budget, and role outputs."
          : "Council is a non-coding multi-role discussion mode. Use it for critique, alternatives, and a final decision.",
      template: JSON.stringify(config, null, 2),
      runLabel: mode === "bvc" ? "Run BVC check" : "Run Council review",
      runPrompt:
        mode === "bvc"
          ? `Run BVC verification with this configuration. Do not edit files. Return criteria, checks, contradictions, confidence, and final verdict.\n\n${JSON.stringify(config, null, 2)}`
          : `Run a Council review with this configuration. Do not edit files. Return role opinions, conflicts, synthesis, and final decision.\n\n${JSON.stringify(config, null, 2)}`,
    });
  };

  const showAlgorithmGuide = (
    title: string,
    body: string,
    template: string,
    runLabel: string,
  ) => {
    setLabNotice({ title, body, template, runLabel, runPrompt: template });
  };

  const runLabPrompt = (prompt: string) => {
    if (showOpenFolderAction || !prompt.trim() || runState.status === "running") {
      return;
    }
    const runId = createClientRunId();
    ideMessenger.post("xynapse/runtimePrompt", {
      runId,
      prompt,
      surface: "lab",
      sessionId: "xynapse-lab",
      permissionMode: "read-only",
      planMode: true,
      previousDiscussion,
    });
  };

  const stopLabRun = () => {
    if (runState.runId) {
      ideMessenger.post("xynapse/runtimeStop", { runId: runState.runId });
    }
  };

  const outputText =
    runState.output.length > 0
      ? runState.output.map((chunk) => chunk.text).join("")
      : "No Lab output yet. Pick an algorithm, prepare the prompt, then run it.";

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-solid border-violet-300/15 bg-[#101010] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.35)]"
      title="Xynapse Lab is for non-coding reasoning: Council, BVC, audit, comparison, and research checks."
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(139,92,246,0.18),transparent_35%),linear-gradient(135deg,rgba(255,255,255,0.05),transparent_48%)]" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <BeakerIcon className="h-4 w-4 text-violet-200" />
            <h3 className="m-0 text-base font-semibold text-foreground">
              Xynapse Lab
            </h3>
            <span className="rounded-full border border-solid border-violet-300/20 bg-violet-300/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-violet-100">
              algorithms
            </span>
          </div>
        </div>

        <p className="m-0 mt-2 text-sm leading-5 text-description">
          Lab is the research layer. Use Core for code edits; use Lab for
          Council, BVC, audit, comparison, and model-key reasoning.
        </p>

        <div className="mt-3 rounded-xl border border-solid border-violet-300/15 bg-black/25 p-3 text-xs leading-5 text-description">
          <div className="mb-1 font-semibold uppercase tracking-[0.16em] text-violet-100">
            How to choose a mode
          </div>
          <div>Council: roles discuss a decision and synthesize a final answer.</div>
          <div>BVC: budgeted verification checks candidate answers.</div>
          <div>Audit: risk and quality review without file edits.</div>
          <div>Compare: alternatives, tradeoffs, and a recommended path.</div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <AlgorithmButton
            active
            title="Council"
            description="roles, critique, decision"
            onClick={() => openCouncilDialog("council")}
          />
          <AlgorithmButton
            active
            title="BVC"
            description="budgeted verification"
            onClick={() => openCouncilDialog("bvc")}
          />
          <AlgorithmButton
            title="Audit"
            description="risk and quality review"
            onClick={() =>
              showAlgorithmGuide(
                "Audit template",
                "Use Audit when you need a structured risk and quality review. It does not edit files; Core handles code changes.",
                "Audit the current solution. Check risks, weak points, missing tests, regressions, and the first fixes to make.",
                "Run Audit",
              )
            }
          />
          <AlgorithmButton
            title="Compare"
            description="compare alternatives"
            onClick={() =>
              showAlgorithmGuide(
                "Compare template",
                "Use Compare when several approaches are possible and you need a defensible choice.",
                "Compare alternatives by correctness, implementation cost, risk, speed, maintainability, and testing effort. Recommend one path.",
                "Run Compare",
              )
            }
          />
        </div>

        {activeCouncilMode ? (
          <div className="mt-4 rounded-xl border border-solid border-violet-300/15 bg-[#08080a] p-2">
            <CouncilDialog
              mode={activeCouncilMode}
              onClose={() => setActiveCouncilMode(null)}
              onSubmit={(config) =>
                prepareCouncilRun(activeCouncilMode, config)
              }
            />
          </div>
        ) : null}

        {labNotice ? (
          <div className="mt-4 rounded-xl border border-solid border-violet-300/15 bg-[#08080a] p-3">
            <div className="text-sm font-semibold text-violet-50">
              {labNotice.title}
            </div>
            <p className="m-0 mt-1 text-xs leading-5 text-description">
              {labNotice.body}
            </p>
            {labNotice.template ? (
              <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-solid border-white/10 bg-black/35 p-2 font-mono text-[11px] leading-5 text-zinc-200">
                {labNotice.template}
              </pre>
            ) : null}
            {labNotice.runPrompt ? (
              <button
                type="button"
                className="mt-3 rounded-lg border border-solid border-violet-300/20 bg-[#191322] px-3 py-2 text-xs font-medium text-violet-50 transition hover:bg-violet-300/16 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={showOpenFolderAction || runState.status === "running"}
                onClick={() => runLabPrompt(labNotice.runPrompt!)}
                title={
                  showOpenFolderAction
                    ? "Open a project folder before running a prompt."
                    : "Run this Lab algorithm in read-only mode against the current project context."
                }
              >
                {showOpenFolderAction
                  ? "Open project first"
                  : runState.status === "running"
                  ? "Running..."
                  : labNotice.runLabel ?? "Run"}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 rounded-xl border border-solid border-violet-300/15 bg-[#08080a] p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-100">
              Lab output
            </div>
            {runState.status === "running" ? (
              <button
                type="button"
                className="rounded-md border border-solid border-red-300/20 bg-red-300/10 px-2 py-1 text-[10px] font-medium text-red-100"
                onClick={stopLabRun}
                title="Stop the running Lab task."
              >
                Stop
              </button>
            ) : (
              <span
                className="text-[10px] uppercase tracking-[0.14em] text-description"
                title="Current Lab runtime state."
              >
                {runState.status}
              </span>
            )}
          </div>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-solid border-white/10 bg-black/35 p-2 font-mono text-[11px] leading-5 text-zinc-200">
            {outputText}
          </pre>
        </div>

        {showOpenFolderAction ? (
          <button
            type="button"
            className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-solid border-violet-300/20 bg-[#191322] px-3 py-2 text-sm font-medium text-violet-50 transition hover:bg-violet-300/16 focus:bg-[#241a31] focus:outline-none"
            onClick={() => ideMessenger.post("openFolder", undefined)}
            title="Open a workspace folder. Core and Lab will use the same project root."
          >
            <FolderOpenIcon className="h-4 w-4" />
            Open project folder
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function XynapseModeSwitcher({
  mode,
  onModeChange,
}: XynapseModeSwitcherProps) {
  return (
    <div className="border-x-0 border-b border-t-0 border-solid border-white/10">
      <div className="flex gap-2" role="tablist" aria-label="Xynapse area">
        <ModeTabButton
          active={mode === "core"}
          label="Xynapse Core"
          description="code runtime"
          title="Core writes and edits code in the opened workspace."
          onClick={() => onModeChange("core")}
        />
        <ModeTabButton
          active={mode === "lab"}
          label="Xynapse Lab"
          description="Council, BVC"
          title="Lab runs non-coding reasoning modes: Council, BVC, audit, comparison, and verification."
          onClick={() => onModeChange("lab")}
        />
      </div>
    </div>
  );
}

export function XynapseModeTabs(props: XynapseModeTabsProps) {
  const [localMode, setLocalMode] = useState<XynapseMode>("core");
  const mode = props.mode ?? localMode;
  const setMode = (nextMode: XynapseMode) => {
    if (props.mode === undefined) {
      setLocalMode(nextMode);
    }
    props.onModeChange?.(nextMode);
  };

  return (
    <div className="space-y-3">
      <XynapseModeSwitcher mode={mode} onModeChange={setMode} />
      {mode === "core" ? (
        <ClawSidecarCard
          modelKey={props.coreModelKey}
          onModelKeyChange={props.onCoreModelKeyChange}
          onRunModeChange={props.onCoreRunModeChange}
          runMode={props.coreRunMode}
          runState={props.coreRunState}
          showOpenFolderAction={props.showOpenFolderAction}
        />
      ) : (
        <XynapseResearchCard {...props} />
      )}
    </div>
  );
}

export function ClawSidecarCard({
  showOpenFolderAction,
  modelKey,
  onModelKeyChange,
  runMode,
  onRunModeChange,
  runState = DEFAULT_CORE_RUN_STATE,
}: {
  showOpenFolderAction?: boolean;
  modelKey?: string;
  onModelKeyChange?: (key: string) => void;
  runMode?: CoreRunMode;
  onRunModeChange?: (mode: CoreRunMode) => void;
  runState?: LabRunState;
} = {}) {
  const ideMessenger = useContext(IdeMessengerContext);
  const coreSelectedModel = useAppSelector(selectSelectedChatModel);
  const config = useAppSelector((state) => state.config.config);
  const [localModelKey, setLocalModelKey] = useState<string>("");
  const [localRunMode, setLocalRunMode] =
    useState<CoreRunMode>("workspace-write");
  const activeModelKey = modelKey ?? localModelKey;
  const activeRunMode = runMode ?? localRunMode;
  const setActiveModelKey = onModelKeyChange ?? setLocalModelKey;
  const setActiveRunMode = onRunModeChange ?? setLocalRunMode;

  const models = useMemo(
    () => collectCoreRuntimeModels(config, coreSelectedModel),
    [config, coreSelectedModel],
  );
  const selectedModel =
    models.find((model) => getLabModelKey(model) === activeModelKey) ??
    models[0];
  const selectedModelKey = getLabModelKey(selectedModel);
  const workspaceLocked = !!showOpenFolderAction;

  const runDoctor = () => {
    if (workspaceLocked) {
      return;
    }
    ideMessenger.post("xynapse/runtimeDoctor", { runId: createClientRunId() });
  };

  const stopRun = () => {
    if (runState.runId) {
      ideMessenger.post("xynapse/runtimeStop", { runId: runState.runId });
    }
  };

  return (
    <section
      className="m-0 box-border min-w-0 max-w-full overflow-visible rounded-xl border border-solid border-violet-300/15 bg-[#101010] p-3 text-foreground"
      title="Xynapse Core is the coding runtime. It can inspect, plan, and edit files in the opened workspace."
    >
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 truncate text-base font-semibold">
              Xynapse Core
            </h3>
          <span className="rounded-full border border-solid border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-200">
              coding runtime
            </span>
          </div>
        </div>
        <button
          type="button"
          className={`shrink-0 rounded-full border border-solid px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${
            runState.status === "running"
              ? "cursor-pointer border-violet-300/30 bg-violet-300/15 text-violet-100"
              : "border-white/10 bg-white/5 text-description"
          }`}
          disabled={runState.status !== "running"}
          onClick={stopRun}
          title={
            runState.status === "running"
              ? "Stop the running Core process"
              : "Core runtime state"
          }
        >
          {runState.status === "running" ? "running - stop" : runState.status}
        </button>
      </div>

      {showOpenFolderAction ? (
        <button
          type="button"
          className="mb-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-solid border-violet-300/20 bg-[#191322] px-3 py-2 text-sm font-medium text-violet-50 transition hover:bg-violet-300/16 focus:bg-[#241a31] focus:outline-none"
          onClick={() => ideMessenger.post("openFolder", undefined)}
          title="Open a workspace folder. Core and Lab will use the same project root."
        >
          <FolderOpenIcon className="h-4 w-4" />
          Open project folder
        </button>
      ) : null}

      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-100/70">
        Core model
      </label>
      <ModelDropdown
        disabled={
          workspaceLocked || runState.status === "running" || models.length === 0
        }
        models={models}
        onChange={setActiveModelKey}
        selectedKey={selectedModelKey}
        selectedModel={selectedModel}
      />

      <div className="my-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          className={`rounded-lg border border-solid px-3 py-2 text-left text-xs ${
            activeRunMode === "plan"
              ? "border-violet-300/35 bg-violet-300/15 text-violet-50"
              : "border-white/10 bg-black/30 text-description"
          } disabled:bg-black/30 disabled:text-description disabled:opacity-60`}
          disabled={workspaceLocked || runState.status === "running"}
          onClick={() => setActiveRunMode("plan")}
          title="Plan mode: inspect and propose a plan without editing files."
        >
          Plan
          <div className="mt-0.5 opacity-70">no edits</div>
        </button>
        <button
          type="button"
          className={`rounded-lg border border-solid px-3 py-2 text-left text-xs ${
            activeRunMode === "workspace-write"
              ? "border-violet-300/35 bg-violet-300/15 text-violet-50"
              : "border-white/10 bg-black/30 text-description"
          } disabled:bg-black/30 disabled:text-description disabled:opacity-60`}
          disabled={workspaceLocked || runState.status === "running"}
          onClick={() => setActiveRunMode("workspace-write")}
          title="Edit mode: allow file changes inside the opened workspace."
        >
          Edit
          <div className="mt-0.5 opacity-70">workspace</div>
        </button>
        <button
          type="button"
          className={`rounded-lg border border-solid px-3 py-2 text-left text-xs ${
            activeRunMode === "danger-full-access"
              ? "border-red-300/35 bg-[#281316] text-red-50"
              : "border-white/10 bg-black/30 text-description"
          } disabled:bg-black/30 disabled:text-description disabled:opacity-60`}
          disabled={workspaceLocked || runState.status === "running"}
          onClick={() => setActiveRunMode("danger-full-access")}
          title="Full mode: all runtime tools, including shell commands. Requires explicit confirmation before run."
        >
          Full
          <div className="mt-0.5 opacity-70">run commands</div>
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground transition hover:bg-white/10 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-description disabled:opacity-60"
          disabled={workspaceLocked || runState.status === "running"}
          onClick={runDoctor}
          title="Run runtime diagnostics for the opened workspace"
        >
          <WrenchScrewdriverIcon className="h-3.5 w-3.5" />
          Diagnostics
        </button>
        {runState.status === "running" ? (
          <button
            type="button"
            className="rounded-lg border border-solid border-red-300/20 bg-red-300/10 px-3 py-2 text-xs font-medium text-red-100"
            onClick={stopRun}
            title="Stop the running Core process"
          >
            Stop
          </button>
        ) : null}
      </div>
    </section>
  );
}

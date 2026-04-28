import {
  BeakerIcon,
  ChevronDownIcon,
  CommandLineIcon,
  FolderOpenIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { useContext, useMemo, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useWebviewListener } from "../../hooks/useWebviewListener";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import CouncilDialog, { CouncilConfig } from "../council/CouncilDialog";

export type XynapseMode = "core" | "lab";

type XynapseModeTabsProps = {
  showOpenFolderAction?: boolean;
  mode?: XynapseMode;
  onModeChange?: (mode: XynapseMode) => void;
};

type XynapseModeSwitcherProps = {
  mode: XynapseMode;
  onModeChange: (mode: XynapseMode) => void;
};

type LabRunStatus = "idle" | "running" | "done" | "error";
type CoreRunMode = "plan" | "workspace-write" | "danger-full-access";

type LabOutputChunk = {
  id: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
};

type LabRunState = {
  runId?: string;
  status: LabRunStatus;
  title: string;
  cwd?: string;
  model?: string;
  exitCode?: number | null;
  output: LabOutputChunk[];
};

type LabModelLike = {
  model?: string;
  title?: string;
  provider?: string;
};

type LabNotice = {
  title: string;
  body: string;
  template?: string;
  runLabel?: string;
  runPrompt?: string;
};

const defaultCorePrompt = "implement the requested code change in this workspace";

function createClientRunId() {
  return `lab-ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getLabModelKey(model: LabModelLike | null | undefined) {
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

function collectLabModels(config: any, selectedModel: LabModelLike | null) {
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
      className={`min-w-0 flex-1 cursor-pointer rounded-xl border border-solid px-3 py-2 text-left transition ${
        active
          ? "border-violet-300/40 bg-violet-300/15 text-foreground shadow-[0_0_28px_rgba(139,92,246,0.18)]"
          : "border-white/10 bg-black/25 text-description hover:border-violet-200/25 hover:bg-white/5"
      }`}
      onClick={onClick}
      title={title}
    >
      <div className="truncate text-sm font-semibold">{label}</div>
      <div className="mt-0.5 truncate text-[11px] opacity-70">
        {description}
      </div>
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

export function XynapseResearchCard({
  showOpenFolderAction,
}: XynapseModeTabsProps) {
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();
  const [labNotice, setLabNotice] = useState<LabNotice | null>(null);
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
    const handleSubmit = (config: CouncilConfig) => {
      dispatch(setShowDialog(false));
      dispatch(setDialogMessage(undefined));

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

    dispatch(
      setDialogMessage(
        <CouncilDialog
          mode={mode}
          onClose={() => {
            dispatch(setShowDialog(false));
            dispatch(setDialogMessage(undefined));
          }}
          onSubmit={handleSubmit}
        />,
      ),
    );
    dispatch(setShowDialog(true));
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
    if (!prompt.trim() || runState.status === "running") {
      return;
    }
    ideMessenger.post("xynapse/clawPrompt", {
      runId: createClientRunId(),
      prompt,
      surface: "lab",
      permissionMode: "read-only",
      planMode: true,
    });
  };

  const stopLabRun = () => {
    if (runState.runId) {
      ideMessenger.post("xynapse/clawStop", { runId: runState.runId });
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
        <div className="flex flex-wrap items-center gap-2">
          <BeakerIcon className="h-4 w-4 text-violet-200" />
          <h3 className="m-0 text-base font-semibold text-foreground">
            Xynapse Lab
          </h3>
          <span className="rounded-full border border-solid border-violet-300/20 bg-violet-300/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-violet-100">
            algorithms
          </span>
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
                disabled={runState.status === "running"}
                onClick={() => runLabPrompt(labNotice.runPrompt!)}
                title="Run this Lab algorithm in read-only mode against the current project context."
              >
                {runState.status === "running"
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
    <div className="rounded-2xl border border-solid border-violet-300/15 bg-[linear-gradient(135deg,rgba(139,92,246,0.18),rgba(18,18,18,0.94)_42%,rgba(18,18,18,0.98))] p-2 shadow-[0_18px_48px_rgba(0,0,0,0.28)]">
      <div className="grid grid-cols-2 gap-2">
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
        <ClawSidecarCard showOpenFolderAction={props.showOpenFolderAction} />
      ) : (
        <XynapseResearchCard {...props} />
      )}
    </div>
  );
}

export function ClawSidecarCard({
  showOpenFolderAction,
}: {
  showOpenFolderAction?: boolean;
} = {}) {
  const ideMessenger = useContext(IdeMessengerContext);
  const coreSelectedModel = useAppSelector(selectSelectedChatModel);
  const config = useAppSelector((state) => state.config.config);
  const [prompt, setPrompt] = useState(defaultCorePrompt);
  const [modelMenuKey, setModelMenuKey] = useState<string>("");
  const [runMode, setRunMode] = useState<CoreRunMode>("workspace-write");
  const [runState, setRunState] = useState<LabRunState>({
    status: "idle",
    title: "Ready for Core run",
    output: [],
  });

  const models = useMemo(
    () => collectLabModels(config, coreSelectedModel),
    [config, coreSelectedModel],
  );
  const selectedModel =
    models.find((model) => getLabModelKey(model) === modelMenuKey) ??
    coreSelectedModel ??
    models[0];
  const selectedModelKey = getLabModelKey(selectedModel);

  useWebviewListener(
    "xynapse/labRunEvent",
    async (event) => {
      setRunState((previous) => {
        if (event.kind === "start") {
          return {
            runId: event.runId,
            status: "running",
            title: event.title ?? "Xynapse Core run",
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

  const runDoctor = () => {
    ideMessenger.post("xynapse/clawDoctor", { runId: createClientRunId() });
  };

  const stopRun = () => {
    if (runState.runId) {
      ideMessenger.post("xynapse/clawStop", { runId: runState.runId });
    }
  };

  const runPrompt = () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || runState.status === "running") {
      return;
    }

    if (
      runMode === "danger-full-access" &&
      !window.confirm(
        "Full access allows the runtime to use all available tools, including shell commands. Continue?",
      )
    ) {
      return;
    }

    ideMessenger.post("xynapse/clawPrompt", {
      runId: createClientRunId(),
      prompt: trimmedPrompt,
      model: selectedModel?.model,
      modelTitle: selectedModel?.title,
      provider: selectedModel?.provider,
      surface: "core",
      permissionMode: runMode === "plan" ? "read-only" : runMode,
      planMode: runMode === "plan",
    });
  };

  const outputText =
    runState.output.length > 0
      ? runState.output.map((chunk) => chunk.text).join("")
      : "No Core runtime output yet. Open a project folder, describe the code task, then run. After the first answer, type the next instruction in the same box and run again.";

  return (
    <section
      className="m-0 box-border min-w-0 max-w-full overflow-visible rounded-2xl border border-solid border-violet-300/20 bg-[#101010] p-3 text-foreground shadow-[0_18px_60px_rgba(0,0,0,0.35)]"
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
          <p className="m-0 mt-1 text-xs leading-5 text-description">
            Core uses the stronger workspace runtime for code writing and
            edits. Council and BVC live in Xynapse Lab.
          </p>
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
        disabled={runState.status === "running" || models.length === 0}
        models={models}
        onChange={setModelMenuKey}
        selectedKey={selectedModelKey}
        selectedModel={selectedModel}
      />

      <div className="my-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          className={`rounded-lg border border-solid px-3 py-2 text-left text-xs ${
            runMode === "plan"
              ? "border-violet-300/35 bg-violet-300/15 text-violet-50"
              : "border-white/10 bg-black/30 text-description"
          } disabled:bg-black/30 disabled:text-description disabled:opacity-60`}
          disabled={runState.status === "running"}
          onClick={() => setRunMode("plan")}
          title="Plan mode: inspect and propose a plan without editing files."
        >
          Plan
          <div className="mt-0.5 opacity-70">no edits</div>
        </button>
        <button
          type="button"
          className={`rounded-lg border border-solid px-3 py-2 text-left text-xs ${
            runMode === "workspace-write"
              ? "border-violet-300/35 bg-violet-300/15 text-violet-50"
              : "border-white/10 bg-black/30 text-description"
          } disabled:bg-black/30 disabled:text-description disabled:opacity-60`}
          disabled={runState.status === "running"}
          onClick={() => setRunMode("workspace-write")}
          title="Edit mode: allow file changes inside the opened workspace."
        >
          Edit
          <div className="mt-0.5 opacity-70">workspace</div>
        </button>
        <button
          type="button"
          className={`rounded-lg border border-solid px-3 py-2 text-left text-xs ${
            runMode === "danger-full-access"
              ? "border-red-300/35 bg-[#281316] text-red-50"
              : "border-white/10 bg-black/30 text-description"
          } disabled:bg-black/30 disabled:text-description disabled:opacity-60`}
          disabled={runState.status === "running"}
          onClick={() => setRunMode("danger-full-access")}
          title="Full mode: all runtime tools, including shell commands. Requires explicit confirmation before run."
        >
          Full
          <div className="mt-0.5 opacity-70">run commands</div>
        </button>
      </div>

      <textarea
        className="box-border min-h-[92px] w-full max-w-full resize-y rounded-xl border border-solid border-white/10 bg-[#09090b] px-3 py-2 text-sm leading-5 text-foreground outline-none transition focus:border-violet-300/40"
        disabled={runState.status === "running"}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            runPrompt();
          }
        }}
        placeholder="Describe the code task..."
        value={prompt}
      />
      <div className="mt-1 text-[11px] leading-4 text-description">
        Follow-up prompts continue the same Core context. Select Full mode when
        the task must run scripts or shell commands.
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-violet-300/20 bg-[#191322] px-3 py-2 text-xs font-medium text-violet-50 transition hover:bg-violet-300/16 disabled:cursor-not-allowed disabled:bg-[#191322] disabled:text-violet-100 disabled:opacity-60"
          disabled={runState.status === "running" || prompt.trim().length === 0}
          onClick={runPrompt}
          title="Run the prompt through Xynapse Core runtime"
        >
          <CommandLineIcon className="h-3.5 w-3.5" />
          Run Core task
        </button>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground transition hover:bg-white/10 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-description disabled:opacity-60"
          disabled={runState.status === "running"}
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

      <pre className="mt-3 box-border max-h-[360px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-xl border border-solid border-white/10 bg-[#070708] p-3 font-mono text-[11px] leading-5 text-zinc-200">
        {outputText}
      </pre>
    </section>
  );
}

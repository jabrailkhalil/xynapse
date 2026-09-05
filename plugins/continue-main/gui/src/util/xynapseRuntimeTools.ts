import { Tool } from "core";
import {
  BUILT_IN_GROUP_NAME,
  BuiltInToolNames,
} from "core/tools/builtIn";
import {
  DEFAULT_TOOL_SETTING,
  ToolGroupPolicies,
  ToolPolicies,
} from "../redux/slices/uiSlice";

const RUNTIME_TOOL_ORDER = [
  "read_file",
  "glob_search",
  "grep_search",
  "edit_file",
  "write_file",
  "bash",
  "WebFetch",
  "WebSearch",
] as const;

type RuntimeToolName = (typeof RUNTIME_TOOL_ORDER)[number];

const RUNTIME_TOOL_TO_CONFIG_TOOL: Record<RuntimeToolName, BuiltInToolNames> = {
  read_file: BuiltInToolNames.ReadFile,
  glob_search: BuiltInToolNames.FileGlobSearch,
  grep_search: BuiltInToolNames.GrepSearch,
  edit_file: BuiltInToolNames.EditExistingFile,
  write_file: BuiltInToolNames.CreateNewFile,
  bash: BuiltInToolNames.RunTerminalCommand,
  WebFetch: BuiltInToolNames.FetchUrlContent,
  WebSearch: BuiltInToolNames.SearchWeb,
};

export const RUNTIME_CONFIG_TOOL_INFO: Record<
  string,
  {
    runtimeName: RuntimeToolName;
    modes: string;
    description: string;
  }
> = {
  [BuiltInToolNames.ReadFile]: {
    runtimeName: "read_file",
    modes: "Plan, Edit, Full",
    description: "Read files from the opened workspace.",
  },
  [BuiltInToolNames.FileGlobSearch]: {
    runtimeName: "glob_search",
    modes: "Plan, Edit, Full",
    description: "Find files in the opened workspace by glob pattern.",
  },
  [BuiltInToolNames.GrepSearch]: {
    runtimeName: "grep_search",
    modes: "Plan, Edit, Full",
    description: "Search text in workspace files.",
  },
  [BuiltInToolNames.EditExistingFile]: {
    runtimeName: "edit_file",
    modes: "Edit, Full",
    description: "Patch existing workspace files.",
  },
  [BuiltInToolNames.CreateNewFile]: {
    runtimeName: "write_file",
    modes: "Edit, Full",
    description: "Create or overwrite workspace files.",
  },
  [BuiltInToolNames.RunTerminalCommand]: {
    runtimeName: "bash",
    modes: "Full",
    description: "Run shell commands in the opened workspace.",
  },
  [BuiltInToolNames.FetchUrlContent]: {
    runtimeName: "WebFetch",
    modes: "Full",
    description: "Fetch web page content when Full mode allows it.",
  },
  [BuiltInToolNames.SearchWeb]: {
    runtimeName: "WebSearch",
    modes: "Full",
    description: "Search the web when Full mode allows it.",
  },
};

export const RUNTIME_CONFIGURABLE_TOOL_NAMES: string[] = Object.values(
  RUNTIME_TOOL_TO_CONFIG_TOOL,
);

export function getRuntimeToolInfo(configToolName: string) {
  return RUNTIME_CONFIG_TOOL_INFO[configToolName];
}

function getRuntimeToolModeCap(mode: string) {
  if (mode === "plan") {
    return new Set<RuntimeToolName>([
      "read_file",
      "glob_search",
      "grep_search",
    ]);
  }

  if (mode === "full") {
    return new Set<RuntimeToolName>(RUNTIME_TOOL_ORDER);
  }

  return new Set<RuntimeToolName>([
    "read_file",
    "glob_search",
    "grep_search",
    "edit_file",
    "write_file",
  ]);
}

export function getRuntimeAllowedToolsForMode({
  mode,
  availableTools,
  toolSettings,
  toolGroupSettings,
}: {
  mode: string;
  availableTools: Tool[];
  toolSettings: ToolPolicies;
  toolGroupSettings: ToolGroupPolicies;
}) {
  if (mode === "chat" || mode === "background") {
    return "";
  }

  if (!availableTools.length) {
    return undefined;
  }

  if (toolGroupSettings[BUILT_IN_GROUP_NAME] === "exclude") {
    return "";
  }

  const toolsByName = new Map(
    availableTools.map((tool) => [tool.function.name, tool]),
  );
  const modeCap = getRuntimeToolModeCap(mode);

  return RUNTIME_TOOL_ORDER.filter((runtimeToolName) => {
    if (!modeCap.has(runtimeToolName)) {
      return false;
    }

    const configToolName = RUNTIME_TOOL_TO_CONFIG_TOOL[runtimeToolName];
    const tool = toolsByName.get(configToolName);
    if (!tool) {
      return false;
    }

    const policy =
      toolSettings[configToolName] ??
      tool.defaultToolPolicy ??
      DEFAULT_TOOL_SETTING;
    return policy !== "disabled";
  }).join(",");
}

import ignore from "ignore";

import type {
  ContextItemWithId,
  FileType,
  IDE,
  RangeInFile,
} from "../../../index.js";
import { ChatMessage, ILLM, SlashCommand } from "../../../index.js";
import {
  DEFAULT_IGNORE,
  gitIgArrayFromFile,
} from "../../../indexing/ignore.js";
import { getGlobalXynapseIgArray } from "../../../indexing/xynapseignore.js";
import { renderChatMessage } from "../../../util/messageContent.js";
import {
  runBvc,
  type BvcEvent,
  type BvcMessage,
  type BvcModelAdapter,
  type BvcResult,
} from "../../../../packages/bvc/src/index.js";
import {
  findUriInDirs,
  getUriPathBasename,
  joinPathsToUri,
} from "../../../util/uri.js";

// ── Types ──────────────────────────────────────────────────────────

interface CouncilAgent {
  name: string;
  systemPrompt: string;
  llm: ILLM;
}

type Difficulty = "easy" | "medium" | "hard";

interface CouncilGuiConfig {
  difficulty: Difficulty;
  roles: Array<{
    name: string;
    modelTitle: string;
  }>;
  saveDiscussion?: boolean;
  bvcParams?: BVCParamsConfig;
}

interface HistoryEntry {
  agent: string;
  content: string;
  phase: "analysis" | "recovery" | "critique" | "plan";
  round: number; // 0-based within phase
}

// ── BVC Parameters (Algorithm 2 from thesis) ──────────────────────

/** BVC thresholds (defaults, can be overridden via GUI) */
const DEFAULT_TAU_VOTE = 0.3; // τ_vote: enter critique if D_vote > this
const DEFAULT_TAU_CRIT = 0.7; // τ_crit: early-fail if D_vote > this after critique
const DEFAULT_TAU_COV = 0.5; // τ_cov: structured-output degradation threshold
const DEFAULT_K_MAX = 2; // max critique rounds (adaptive, not fixed)
const DEFAULT_J_SO = 1; // bounded structured-output re-asks per invalid role
const DEFAULT_LAMBDA_COST = 0.1;
const DEFAULT_EPSILON_VOTE = 0.05;
const DEFAULT_EPSILON_COV = 0.03;

interface BVCParamsConfig {
  mode?: "council" | "adaptive" | "single" | "fixed";
  tauVote?: number;
  tauCrit?: number;
  tauCov?: number;
  /** @deprecated Use tauCov. Kept for GUI compatibility. */
  tauCovBase?: number;
  kMax?: number;
  bRes?: number;
  pMax?: number;
  jSo?: number;
  lambdaCost?: number;
  epsilonVote?: number;
  epsilonCov?: number;
  selectiveActivation?: boolean;
  forceCouncil?: boolean;
  callTimeoutMs?: number;
}

function resolveBVCParams(params?: BVCParamsConfig) {
  return {
    MODE: params?.forceCouncil
      ? ("council" as const)
      : (params?.mode ?? ("council" as const)),
    TAU_VOTE: params?.tauVote ?? DEFAULT_TAU_VOTE,
    TAU_CRIT: params?.tauCrit ?? DEFAULT_TAU_CRIT,
    TAU_COV: params?.tauCov ?? params?.tauCovBase ?? DEFAULT_TAU_COV,
    K_MAX: params?.kMax ?? DEFAULT_K_MAX,
    B_RES: params?.bRes ?? 1,
    J_SO: params?.jSo ?? DEFAULT_J_SO,
    LAMBDA_COST: params?.lambdaCost ?? DEFAULT_LAMBDA_COST,
    EPSILON_VOTE: params?.epsilonVote ?? DEFAULT_EPSILON_VOTE,
    EPSILON_COV: params?.epsilonCov ?? DEFAULT_EPSILON_COV,
    CALL_TIMEOUT_MS: params?.callTimeoutMs ?? 120_000,
  };
}

function formatMetric(value: number | undefined): string {
  return value === undefined ? "undef" : value.toFixed(2);
}

// ── Config ─────────────────────────────────────────────────────────

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

/** Budget multiplier per difficulty (higher = more room for critique) */
const DIFFICULTY_BUDGET: Record<Difficulty, number> = {
  easy: 1, // N+1 (no critique)
  medium: 2, // 2N+1
  hard: 3, // 3N+1
};

const COUNCIL_DEFAULT_ROLES = ["PM", "Architect", "Developer", "Reviewer"];
const BVC_DEFAULT_ROLES = ["Architect", "Developer", "Reviewer", "Tester"];

const COUNCIL_CRITIQUE_ROUNDS: Record<Difficulty, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
};

const MAX_EXPLORE_DEPTH = 2;

const LANGUAGE_DEP_MGMT_FILENAMES = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "composer.json",
  "Cargo.toml",
  "go.mod",
  "CMakeLists.txt",
  "Makefile",
  "packages.config",
  "pubspec.yaml",
  "Project.toml",
  "mix.exs",
  "rebar.config",
  "shard.yml",
  "Package.swift",
  "dependencies.gradle",
  "Podfile",
  "dub.json",
];

// ── Role Prompts ───────────────────────────────────────────────────

const ROLE_PROMPTS: Record<string, string> = {
  PM: `You are the Project Manager on the Council team.
Your responsibilities:
- Clarify the user's requirements and turn them into an actionable scope
- Keep the discussion aligned with the user's goal
- Prioritize work into an MVP and follow-up tasks
- Resolve tradeoffs from a product and delivery perspective
- Synthesize the final plan when the discussion converges

Be concise, practical, and specific.`,

  Architect: `You are the Architect on the Council team.
Your responsibilities:
- Propose the project architecture: file structure, modules, APIs
- Choose appropriate design patterns
- Consider scalability and extensibility
- Assess technical risks
- Respond to remarks from other participants

Justify your architectural decisions.
Be specific — name files, folder structures, data formats.`,

  Developer: `You are the Senior Developer on the Council team.
Your responsibilities:
- Propose specific technologies, libraries, and frameworks
- Design algorithms and data structures
- Estimate implementation complexity for each component
- Critically evaluate architectural decisions — point out issues
- Suggest improvements and alternative approaches

Be practical — propose concrete code and solutions.`,

  Reviewer: `You are the Code Reviewer and QA expert on the Council team.
Your responsibilities:
- Critically evaluate the proposed architecture and solutions
- Find potential bugs, vulnerabilities, and edge cases
- Assess security (SQL injection, XSS, CSRF, etc.)
- Suggest alternative approaches if current ones have problems
- Verify that the solution covers all task requirements

Be strict but constructive.`,

  Tester: `You are the QA Engineer and Tester on the Council team.
Your responsibilities:
- Design the project testing strategy
- Identify key test cases and scenarios
- Point out edge cases that need test coverage
- Suggest test types: unit, integration, e2e
- Evaluate the testability of the proposed architecture

Be specific — describe test cases in detail.`,
};

const DEFAULT_ROLE_PROMPT = `You are a "{name}" expert on the Council team.
Your responsibilities:
- Evaluate the project from the perspective of your expertise
- Provide specific recommendations and suggestions
- Point out potential issues in your area
- Respond to suggestions from other participants

Be specific and practical.`;

// ── Phase Prompt Suffixes ──────────────────────────────────────────

const PLAN_PROMPT = `You are the Lead Architect. Based on the previous discussion, create the FINAL PROJECT PLAN.

You have seen each participant's individual analysis and their cross-critique. Now you must MAKE DECISIONS on all disputed points.

Plan format STRICTLY:

# Project Plan

## Description
Brief project description (2-3 sentences)

## Disputed Decisions
For each point where participants DID NOT agree with each other:
- What the dispute is about
- What decision was made and WHY (referencing participants' arguments)

## File Structure
\`\`\`
project/
├── file1.ext
├── file2.ext
└── dir/
    └── file3.ext
\`\`\`

## File Descriptions
For each file: what it contains, what it is responsible for.

## Implementation Order
Numbered list of steps. Each step must include:
- Which file to create/modify
- What exactly to write (key code fragments)
- Which dependencies to install

## Technologies
List of technologies/libraries used.

Be as specific as possible — each step must be implementable without additional clarification.`;

// ── Input Parsing ──────────────────────────────────────────────────

const VALID_DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

function validateDifficulty(value: unknown): Difficulty {
  if (
    typeof value === "string" &&
    VALID_DIFFICULTIES.includes(value as Difficulty)
  ) {
    return value as Difficulty;
  }
  return "medium";
}

function validateRoles(roles: unknown): CouncilGuiConfig["roles"] | undefined {
  if (!Array.isArray(roles) || roles.length === 0) return undefined;
  return roles.filter(
    (r) =>
      r &&
      typeof r.name === "string" &&
      r.name.trim() !== "" &&
      typeof r.modelTitle === "string",
  );
}

function parseInput(input: string): {
  difficulty: Difficulty;
  task: string;
  roleOverrides?: CouncilGuiConfig["roles"];
  saveDiscussion: boolean;
  bvcParams?: BVCParamsConfig;
} {
  const trimmed = input.trim();

  // Try JSON config from GUI dialog (promptBlockContent + task on next line)
  if (trimmed.startsWith("{")) {
    const newlineIdx = trimmed.indexOf("\n");
    const jsonStr = newlineIdx > 0 ? trimmed.substring(0, newlineIdx) : trimmed;
    const task = newlineIdx > 0 ? trimmed.substring(newlineIdx + 1).trim() : "";

    try {
      const config: CouncilGuiConfig = JSON.parse(jsonStr);
      if (config.difficulty && config.roles) {
        return {
          difficulty: validateDifficulty(config.difficulty),
          task: task || "plan",
          roleOverrides: validateRoles(config.roles),
          saveDiscussion: config.saveDiscussion !== false,
          bvcParams: config.bvcParams,
        };
      }
    } catch {
      // Not valid JSON — fall through
    }
  }

  // Also try full JSON (old format with task inside)
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const config = JSON.parse(trimmed) as Record<string, unknown>;
      if (config.task && config.difficulty) {
        return {
          difficulty: validateDifficulty(config.difficulty),
          task: String(config.task),
          roleOverrides: validateRoles(config.roles),
          saveDiscussion: config.saveDiscussion !== false,
          bvcParams: config.bvcParams as BVCParamsConfig | undefined,
        };
      }
    } catch {
      // fall through
    }
  }

  // Text-based: /council [level] task
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("easy ")) {
    return {
      difficulty: "easy",
      task: trimmed.replace(/^easy\s+/i, ""),
      saveDiscussion: true,
    };
  }
  if (lower.startsWith("hard ")) {
    return {
      difficulty: "hard",
      task: trimmed.replace(/^hard\s+/i, ""),
      saveDiscussion: true,
    };
  }
  return {
    difficulty: "medium",
    task: trimmed.replace(/^medium\s+/i, ""),
    saveDiscussion: true,
  };
}

// ── Model & Agent Helpers ──────────────────────────────────────────

function isLLMLike(value: unknown): value is ILLM {
  return isRecord(value) && typeof value.streamChat === "function";
}

function getAvailableModels(config: unknown, fallbackLlm: ILLM): ILLM[] {
  const seen = new Set<string>();
  const models: ILLM[] = [];

  const configRecord = isRecord(config) ? config : {};
  const byRole = isRecord(configRecord.modelsByRole)
    ? configRecord.modelsByRole
    : {};
  for (const role of ["chat", "edit", "apply", "summarize"]) {
    const roleModels = byRole[role];
    if (!Array.isArray(roleModels)) {
      continue;
    }
    for (const m of roleModels) {
      if (isLLMLike(m)) {
        const key = [
          m.providerName,
          m.uniqueId && m.uniqueId !== "None" ? m.uniqueId : undefined,
          m.model,
          m.title,
        ]
          .filter(Boolean)
          .join("|");
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        models.push(m);
      }
    }
  }

  const topLevelModels = configRecord.models;
  if (Array.isArray(topLevelModels)) {
    for (const m of topLevelModels) {
      if (isLLMLike(m)) {
        const key = [
          m.providerName,
          m.uniqueId && m.uniqueId !== "None" ? m.uniqueId : undefined,
          m.model,
          m.title,
        ]
          .filter(Boolean)
          .join("|");
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        models.push(m);
      }
    }
  }

  if (models.length === 0 && fallbackLlm) {
    models.push(fallbackLlm);
  }

  return models;
}

function findModelByTitle(models: ILLM[], title: string): ILLM | undefined {
  return models.find((m) => m.title === title || m.model === title);
}

function getPromptForRole(name: string): string {
  return ROLE_PROMPTS[name] ?? DEFAULT_ROLE_PROMPT.replace("{name}", name);
}

function buildBvcAgents(
  models: ILLM[],
  roleOverrides?: CouncilGuiConfig["roles"],
): CouncilAgent[] {
  if (models.length === 0) return [];

  if (roleOverrides && roleOverrides.length > 0) {
    return roleOverrides.map((role) => ({
      name: role.name,
      systemPrompt: getPromptForRole(role.name),
      llm: findModelByTitle(models, role.modelTitle) ?? models[0],
    }));
  }

  return BVC_DEFAULT_ROLES.map((name, i) => ({
    name,
    systemPrompt: getPromptForRole(name),
    llm: models[i % models.length],
  }));
}

function buildCouncilAgents(
  models: ILLM[],
  roleOverrides?: CouncilGuiConfig["roles"],
): CouncilAgent[] {
  if (models.length === 0) return [];

  if (roleOverrides && roleOverrides.length > 0) {
    return roleOverrides.map((role) => ({
      name: role.name,
      systemPrompt: getPromptForRole(role.name),
      llm: findModelByTitle(models, role.modelTitle) ?? models[0],
    }));
  }

  return COUNCIL_DEFAULT_ROLES.map((name, i) => ({
    name,
    systemPrompt: getPromptForRole(name),
    llm: models[i % models.length],
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidPlanContent(planContent: string): boolean {
  const requiredHeadings = [
    "## Description",
    "## Disputed Decisions",
    "## File Structure",
    "## File Descriptions",
    "## Implementation Order",
    "## Technologies",
  ];
  const normalized = planContent.replace(/\r\n/g, "\n");
  return (
    normalized.trim().length > 0 &&
    normalized.includes("# Project Plan") &&
    requiredHeadings.every((heading) => normalized.includes(heading))
  );
}

// ── Project Context Gathering ──────────────────────────────────────

async function getEntriesFilteredByIgnore(dir: string, ide: IDE) {
  const ig = ignore().add(DEFAULT_IGNORE).add(getGlobalXynapseIgArray());
  const entries = await ide.listDir(dir);

  const ignoreUri = joinPathsToUri(dir, ".gitignore");
  const fileExists = await ide.fileExists(ignoreUri);

  if (fileExists) {
    const gitIgnore = await ide.readFile(ignoreUri);
    const igPatterns = gitIgArrayFromFile(gitIgnore);
    ig.add(igPatterns);
  }

  const workspaceDirs = await ide.getWorkspaceDirs();

  const withRelativePaths = entries
    .filter(
      (entry) =>
        entry[1] === (1 as FileType.File) ||
        entry[1] === (2 as FileType.Directory),
    )
    .map((entry) => {
      const { relativePathOrBasename } = findUriInDirs(entry[0], workspaceDirs);
      return {
        uri: entry[0],
        type: entry[1],
        basename: getUriPathBasename(entry[0]),
        relativePath:
          relativePathOrBasename +
          (entry[1] === (2 as FileType.Directory) ? "/" : ""),
      };
    });

  return withRelativePaths.filter((entry) => !ig.ignores(entry.relativePath));
}

async function gatherProjectContext(
  ide: IDE,
  signal?: AbortSignal,
  maxChars = Infinity,
): Promise<string> {
  const workspaceDirs = await ide.getWorkspaceDirs();
  if (workspaceDirs.length === 0) return "";

  const workspaceDir = workspaceDirs[0];
  let context = "";

  async function exploreDirectory(dir: string, currentDepth: number = 0) {
    if (
      currentDepth > MAX_EXPLORE_DEPTH ||
      signal?.aborted ||
      context.length >= maxChars
    ) {
      return;
    }

    const entries = await getEntriesFilteredByIgnore(dir, ide);

    for (const entry of entries) {
      if (signal?.aborted || context.length >= maxChars) break;
      if (entry.type === (2 as FileType.Directory)) {
        context += `Folder: ${entry.relativePath}\n`;
        await exploreDirectory(entry.uri, currentDepth + 1);
      } else {
        if (entry.basename.toLowerCase() === "readme.md") {
          try {
            const content = await ide.readFile(entry.uri);
            const truncated =
              content.length > 2000
                ? content.substring(0, 2000) + "\n... (truncated)"
                : content;
            context += `\nREADME (${entry.relativePath}):\n${truncated}\n\n`;
          } catch {
            // skip unreadable files
          }
        } else if (LANGUAGE_DEP_MGMT_FILENAMES.includes(entry.basename)) {
          try {
            const content = await ide.readFile(entry.uri);
            const truncated =
              content.length > 3000
                ? content.substring(0, 3000) + "\n... (truncated)"
                : content;
            context += `\n${entry.basename} (${entry.relativePath}):\n${truncated}\n\n`;
          } catch {
            // skip unreadable files
          }
        }
      }
    }
  }

  try {
    await exploreDirectory(workspaceDir);
  } catch {
    // If context gathering fails, continue without it
  }

  return context;
}

// ── Message Builders ───────────────────────────────────────────────

function buildCouncilAnalysisMessages(
  agent: CouncilAgent,
  task: string,
  projectContext: string,
): ChatMessage[] {
  let systemContent = `${agent.systemPrompt}

You are participating in free Council mode. This is not BVC: do not use fixed decision axes, voting metrics, or JSON-only output.

Respond with:
## Proposal
Your concrete approach.

## Risks
Important risks, gaps, and assumptions.

## Questions
Only blocking questions. If none, write "None."`;

  if (projectContext) {
    systemContent += `\n\n## Project Context\n${projectContext}`;
  }

  return [
    { role: "system", content: systemContent },
    { role: "user", content: `Task: ${task}` },
  ];
}

function buildCouncilCritiqueMessages(
  agent: CouncilAgent,
  task: string,
  projectContext: string,
  previousResponses: HistoryEntry[],
  round: number,
): ChatMessage[] {
  let systemContent = `${agent.systemPrompt}

You are participating in free Council mode, critique round ${round + 1}. This is not BVC.

Critique the prior proposals and update your recommendation. Be concrete and do not invent formal voting metrics.

Respond with:
## Agree
What should be kept.

## Disagree
What should be changed and why.

## Revised Recommendation
Your updated practical recommendation.`;

  if (projectContext) {
    systemContent += `\n\n## Project Context\n${projectContext}`;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: `Task: ${task}` },
  ];

  for (const entry of previousResponses) {
    messages.push({
      role: "assistant",
      content: `[${entry.agent}] (${entry.phase}, round ${entry.round + 1}):\n${entry.content}`,
    });
  }

  messages.push({
    role: "user",
    content: `Now respond as ${agent.name}. Produce critique round ${round + 1}.`,
  });

  return messages;
}

function formatCouncilDiscussion(
  history: HistoryEntry[],
  task: string,
  agents: CouncilAgent[],
  difficulty: Difficulty,
): string {
  const lines: string[] = [];
  lines.push("# Council Discussion\n");
  lines.push(`**Task:** ${task}\n`);
  lines.push(`**Level:** ${DIFFICULTY_LABELS[difficulty]}\n`);
  lines.push(
    `**Participants:** ${agents.map((a) => `${a.name} (${a.llm.title || a.llm.model})`).join(", ")}\n`,
  );
  lines.push("---\n");

  const analysis = history.filter((h) => h.phase === "analysis");
  if (analysis.length > 0) {
    lines.push("\n## Independent Proposals\n");
    for (const msg of analysis) {
      lines.push(`### ${msg.agent}\n`);
      lines.push(msg.content);
      lines.push("\n");
    }
  }

  const critiques = history.filter((h) => h.phase === "critique");
  if (critiques.length > 0) {
    const maxRound = Math.max(...critiques.map((c) => c.round));
    for (let r = 0; r <= maxRound; r++) {
      const roundEntries = critiques.filter((c) => c.round === r);
      if (roundEntries.length === 0) continue;

      lines.push(`\n## Critique Round ${r + 1}\n`);
      for (const msg of roundEntries) {
        lines.push(`### ${msg.agent}\n`);
        lines.push(msg.content);
        lines.push("\n");
      }
    }
  }

  return lines.join("\n");
}

function buildPlanMessages(
  task: string,
  projectContext: string,
  fullHistory: HistoryEntry[],
): ChatMessage[] {
  let systemContent = PLAN_PROMPT;
  if (projectContext) {
    systemContent += `\n\n## Project Context\n${projectContext}`;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: `Task: ${task}` },
  ];

  // Group by phase for clear presentation
  const phase1 = fullHistory.filter((h) => h.phase === "analysis");
  const recoveries = fullHistory.filter((h) => h.phase === "recovery");
  const critiques = fullHistory.filter((h) => h.phase === "critique");

  if (phase1.length > 0) {
    let analysisBlock = "--- Phase 1: Individual Analysis ---\n\n";
    for (const entry of phase1) {
      analysisBlock += `[${entry.agent}]:\n${entry.content}\n\n`;
    }
    messages.push({ role: "assistant", content: analysisBlock });
    messages.push({
      role: "user",
      content: "These were the individual analyses from participants.",
    });
  }

  if (recoveries.length > 0) {
    let recoveryBlock = "--- Structured-output Recovery ---\n\n";
    for (const entry of recoveries) {
      recoveryBlock += `[${entry.agent}] corrected JSON:\n${entry.content}\n\n`;
    }
    messages.push({ role: "assistant", content: recoveryBlock });
    messages.push({
      role: "user",
      content:
        "Use these corrected decisions instead of invalid structured outputs from the same roles.",
    });
  }

  if (critiques.length > 0) {
    // Group critiques by round
    const maxRound = Math.max(...critiques.map((c) => c.round));
    for (let r = 0; r <= maxRound; r++) {
      const roundEntries = critiques.filter((c) => c.round === r);
      if (roundEntries.length === 0) continue;

      let critiqueBlock = `--- Phase 2: Critique, Round ${r + 1} ---\n\n`;
      for (const entry of roundEntries) {
        critiqueBlock += `[${entry.agent}]:\n${entry.content}\n\n`;
      }
      messages.push({ role: "assistant", content: critiqueBlock });
      messages.push({
        role: "user",
        content: `These were the critiques from round ${r + 1}.`,
      });
    }
  }

  messages.push({
    role: "user",
    content:
      "Based on the ENTIRE discussion, create the final plan. Be sure to resolve all disputed points in the 'Disputed Decisions' section.",
  });

  return messages;
}

function getBvcModelIdentity(llm: ILLM): string {
  return [
    llm.providerName,
    llm.uniqueId && llm.uniqueId !== "None" ? llm.uniqueId : undefined,
    llm.model,
    llm.title,
  ]
    .filter(Boolean)
    .join(":");
}

function normalizeBvcFinishReason(
  value: unknown,
): "stop" | "length" | "refusal" | "unknown" {
  if (typeof value !== "string") return "unknown";
  switch (value.toLowerCase()) {
    case "stop":
    case "end_turn":
      return "stop";
    case "length":
    case "max_tokens":
    case "incomplete":
      return "length";
    case "refusal":
    case "content_filter":
    case "safety":
      return "refusal";
    default:
      return "unknown";
  }
}

function createBvcAdapter(agents: CouncilAgent[]): {
  adapter: BvcModelAdapter;
  roles: Array<{ name: string; modelId: string; systemPrompt: string }>;
} {
  const llms = new Map<string, ILLM>();
  const roles = agents.map((agent) => {
    const modelId = getBvcModelIdentity(agent.llm);
    llms.set(modelId, agent.llm);
    return { name: agent.name, modelId, systemPrompt: agent.systemPrompt };
  });

  const adapter: BvcModelAdapter = {
    async *stream(request) {
      const model = llms.get(request.modelId);
      if (!model)
        throw new Error(`BVC model is unavailable: ${request.modelId}`);
      const messages: ChatMessage[] = request.messages.map(
        (message: BvcMessage) => ({
          role: message.role,
          content: message.content,
        }),
      );
      for await (const chunk of model.streamChat(messages, request.signal, {
        maxTokens: request.maxOutputTokens,
        temperature: 0,
      })) {
        if (chunk.role !== "assistant" && chunk.role !== "thinking") continue;
        const terminalReason =
          chunk.metadata?.finishReason ?? chunk.metadata?.stopReason;
        const finishReason = normalizeBvcFinishReason(terminalReason);
        const usage = chunk.usage
          ? {
              inputTokens: chunk.usage.promptTokens,
              outputTokens: chunk.usage.completionTokens,
            }
          : undefined;
        const text = chunk.role === "assistant" ? renderChatMessage(chunk) : "";
        if (text || usage || finishReason !== "unknown") {
          yield { text, usage, finishReason };
        }
        if (terminalReason === "error") {
          throw new Error("The model provider reported a failed response");
        }
      }
    },
  };

  return { adapter, roles };
}

async function gatherBvcContext(
  ide: IDE,
  contextItems: ContextItemWithId[],
  selectedCode: RangeInFile[],
  signal: AbortSignal,
): Promise<{ content: string; truncated: boolean }> {
  const explicit: string[] = [];
  for (const item of contextItems) {
    explicit.push(`Attached context: ${item.name}\n${item.content}`);
  }
  for (const selection of selectedCode) {
    if (signal.aborted) break;
    try {
      const content = await ide.readRangeInFile(
        selection.filepath,
        selection.range,
      );
      explicit.push(`Selected code: ${selection.filepath}\n${content}`);
    } catch {
      explicit.push(`Selected code unavailable: ${selection.filepath}`);
    }
  }

  let project = "";
  try {
    if (!signal.aborted)
      project = await gatherProjectContext(ide, signal, 32_000);
  } catch {
    // Explicit context still makes the run useful when repository discovery fails.
  }
  const combined = [
    explicit.join("\n\n"),
    project ? `Repository overview:\n${project}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const maxChars = 90_000;
  return combined.length > maxChars
    ? {
        content: `${combined.slice(0, maxChars)}\n... (context truncated by host)`,
        truncated: true,
      }
    : { content: combined, truncated: false };
}

function formatPortableBvcDiscussion(
  result: BvcResult,
  task: string,
  agents: CouncilAgent[],
  difficulty: Difficulty,
): string {
  const lines = [
    "# BVC Discussion\n",
    `**Task:** ${task}\n`,
    `**Level:** ${DIFFICULTY_LABELS[difficulty]}\n`,
    `**Policy:** ${result.policyVersion}\n`,
    `**Route:** ${result.route} — ${result.reason}\n`,
    `**Participants:** ${agents.map((agent) => `${agent.name} (${agent.llm.title || agent.llm.model})`).join(", ")}\n`,
    `**Budget:** ${result.callsUsed}/${result.callLimit} provider calls\n`,
    `**Critique rounds:** ${result.critiqueRounds}\n`,
    `**Verification:** ${result.verification}\n`,
    `**Reported usage:** ${result.reportedUsage.inputTokens} input, ${result.reportedUsage.outputTokens} output tokens (${result.usageComplete ? "complete" : "partial"})\n`,
  ];
  if (result.disagreement) {
    lines.push(
      `**Disagreement:** D_vote=${formatMetric(result.disagreement.D_vote)}, D_cov=${result.disagreement.D_cov.toFixed(2)}, comparable axes=${result.disagreement.T_ge2.length}\n`,
    );
  }
  lines.push("\n## Call trace\n");
  lines.push(
    "| # | Role | Model | Phase | Status | Finish | Time | Omitted evidence chars |\n",
  );
  lines.push("|---:|---|---|---|---|---|---:|---:|\n");
  for (const call of result.calls) {
    const model = call.modelId.replaceAll("|", "\\|");
    lines.push(
      `| ${call.index} | ${call.role} | ${model} | ${call.phase} | ${call.status} | ${call.finishReason ?? "unknown"} | ${call.elapsedMs} ms | ${call.omittedEvidenceChars} |\n`,
    );
  }
  for (const phase of ["analysis", "recovery", "critique"] as const) {
    const entries = result.history.filter((entry) => entry.phase === phase);
    if (!entries.length) continue;
    lines.push(`\n## ${phase[0].toUpperCase()}${phase.slice(1)}\n`);
    for (const entry of entries) {
      lines.push(
        `\n### ${entry.agent} — round ${entry.round + 1}\n\n${entry.content}\n`,
      );
    }
  }
  return lines.join("");
}

function formatBvcEvent(event: BvcEvent): string | undefined {
  switch (event.type) {
    case "route":
      return `\n**Route:** ${event.route} — ${event.reason}\n\n`;
    case "call": {
      const phase =
        event.phase === "analysis"
          ? "Independent analysis"
          : event.phase === "critique"
            ? `Critique round ${event.round + 1}`
            : event.phase === "recovery"
              ? "Structured-output recovery"
              : "Plan synthesis";
      return `\n### ${phase}: ${event.role}\n\n`;
    }
    case "text":
      return event.text;
    case "call_end":
      return event.call.status === "complete"
        ? event.call.omittedEvidenceChars > 0
          ? `\n**Context limit:** peer reports were shortened by ${event.call.omittedEvidenceChars} characters; full reports are retained in the discussion.\n`
          : "\n"
        : `\n\n**Call ${event.call.index} ended with ${event.call.status}; its partial output was excluded.**\n`;
    case "metrics":
      return `\n**Decision diagnostics (round ${event.round}):** D_vote=${formatMetric(event.disagreement.D_vote)}, D_cov=${event.disagreement.D_cov.toFixed(2)}, comparable axes=${event.disagreement.T_ge2.length}\n`;
    case "critique_decision":
      return event.allowed
        ? `\n**Critique:** ${event.reason}\n`
        : `\n**Critique stopped:** ${event.reason}\n`;
    case "complete":
      return undefined;
  }
}

export const BvcCommand: SlashCommand = {
  name: "bvc",
  description: "BVC - bounded multi-role planning with an auditable call trace",
  run: async function* ({
    ide,
    llm,
    input,
    config,
    contextItems,
    selectedCode,
    abortController,
  }) {
    if (!input.trim()) {
      yield "Describe a task. Format: `/bvc [easy|medium|hard] task`.";
      return;
    }
    if (abortController.signal.aborted) return;
    const { difficulty, task, roleOverrides, saveDiscussion, bvcParams } =
      parseInput(input);
    if (!task.trim()) {
      yield "Describe a task. Example: `/bvc easy fix the failing parser test`.";
      return;
    }
    const models = getAvailableModels(config, llm);
    const missingModels = roleOverrides
      ?.filter((role) => !findModelByTitle(models, role.modelTitle))
      .map((role) => role.modelTitle);
    if (missingModels?.length) {
      yield `BVC configuration references unavailable models: ${[
        ...new Set(missingModels),
      ].join(", ")}.`;
      return;
    }
    const agents = buildBvcAgents(models, roleOverrides);
    if (!agents.length) {
      yield "No available models. Add a chat model in config.yaml.";
      return;
    }
    const params = resolveBVCParams(bvcParams);
    const callLimit =
      agents.length * DIFFICULTY_BUDGET[difficulty] + params.B_RES;
    const { adapter, roles } = createBvcAdapter(agents);
    yield `## BVC portable v1 | ${DIFFICULTY_LABELS[difficulty]}\n\n`;
    yield "Gathering attached context and repository overview...\n\n";
    const context = await gatherBvcContext(
      ide,
      contextItems,
      selectedCode,
      abortController.signal,
    );
    if (abortController.signal.aborted) return;
    yield `**Task:** ${task}\n`;
    yield `**Participants:** ${agents.map((agent) => `${agent.name} (${agent.llm.title || agent.llm.model})`).join(", ")}\n`;
    yield `**Budget:** ${callLimit} provider calls\n`;
    yield `**Mode:** ${params.MODE}; explicit /bvc defaults to council\n`;
    yield `**Context:** ${context.content.length.toLocaleString()} characters${context.truncated ? " (truncated by host)" : ""}\n`;
    yield "**Guarantee:** planning only; agreement is not test verification\n";

    let result: BvcResult | undefined;
    try {
      for await (const event of runBvc({
        task,
        context: context.content,
        roles,
        adapter,
        synthesisModelId: roles[0].modelId,
        signal: abortController.signal,
        options: {
          requireConfirmedSynthesis: true,
          mode: params.MODE,
          maxCalls: callLimit,
          maxCritiqueRounds: params.K_MAX,
          maxRecoveryAttempts: params.J_SO,
          callTimeoutMs: params.CALL_TIMEOUT_MS,
          tauVote: params.TAU_VOTE,
          tauCrit: params.TAU_CRIT,
          tauCov: params.TAU_COV,
          lambdaCost: params.LAMBDA_COST,
          epsilonVote: params.EPSILON_VOTE,
          epsilonCov: params.EPSILON_COV,
        },
      })) {
        if (event.type === "complete") result = event.result;
        const output = formatBvcEvent(event);
        if (output) yield output;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield `\n\n**BVC failed before producing a saveable plan:** ${message}\n`;
      return;
    }

    if (!result || result.status !== "planned" || !result.plan) {
      yield `\n\n**No plan saved:** ${result?.reason ?? "the run did not complete"}.\n`;
      return;
    }

    const confirmedCalls = result.calls.filter(
      (call) => call.completionConfirmed,
    ).length;
    yield `\n\n---\n\n**Run:** ${result.callsUsed}/${result.callLimit} calls; ${result.critiqueRounds} critique rounds; ${result.distinctModels} model configurations\n`;
    yield `**Provider metadata:** ${confirmedCalls}/${result.callsUsed} completions explicitly confirmed; usage ${result.usageComplete ? "complete" : "partial"}\n`;
    try {
      if (abortController.signal.aborted) return;
      const workspaceDirs = await ide.getWorkspaceDirs();
      if (abortController.signal.aborted) return;
      if (!workspaceDirs.length) {
        await ide.showVirtualFile("bvc-plan.md", result.plan);
        yield "**Plan opened in a temporary tab.**\n";
        return;
      }
      const planUri = joinPathsToUri(workspaceDirs[0], "bvc-plan.md");
      await ide.writeFile(planUri, result.plan);
      await ide.openFile(planUri);
      yield "**Plan saved and opened:** `bvc-plan.md`\n";
      if (saveDiscussion && !abortController.signal.aborted) {
        const discussionUri = joinPathsToUri(
          workspaceDirs[0],
          "bvc-discussion.md",
        );
        await ide.writeFile(
          discussionUri,
          formatPortableBvcDiscussion(result, task, agents, difficulty),
        );
        yield "**Auditable discussion saved:** `bvc-discussion.md`\n";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield `**Plan was completed but could not be saved:** ${message}\n`;
      if (!abortController.signal.aborted) {
        try {
          await ide.showVirtualFile("bvc-plan.md", result.plan);
        } catch {
          yield "The completed plan remains available in this conversation.\n";
        }
      }
    }
  },
};

const CouncilCommand: SlashCommand = {
  name: "council",
  description: "Council - free-form multi-agent project planning",
  run: async function* ({ ide, llm, input, config, abortController }) {
    if (!input.trim()) {
      yield "Describe a task for Council.\n\n";
      yield "Format: `/council [easy|medium|hard] task`\n\n";
      yield "Or use the Council button in the input toolbar.\n";
      return;
    }

    const { difficulty, task, roleOverrides, saveDiscussion } =
      parseInput(input);
    const diffLabel = DIFFICULTY_LABELS[difficulty];

    if (!task.trim()) {
      yield "Describe a task. Example: `/council easy build a calculator`";
      return;
    }

    const models = getAvailableModels(config, llm);
    const agents = buildCouncilAgents(models, roleOverrides);
    const critiqueRounds = COUNCIL_CRITIQUE_ROUNDS[difficulty];

    if (agents.length === 0) {
      yield "No available models. Add a model in config.yaml.";
      return;
    }

    const agentList = agents
      .map((a) => `${a.name} (${a.llm.title || a.llm.model})`)
      .join(", ");

    yield `## Council | ${diffLabel}\n\n`;
    yield `**Task:** ${task}\n`;
    yield `**Participants:** ${agentList}\n`;
    yield `**Critique rounds:** ${critiqueRounds}\n`;
    yield `**Mode:** free-form planning, no BVC voting metrics\n\n`;

    const history: HistoryEntry[] = [];
    const abortSignal = abortController.signal;

    yield `Gathering project context...\n`;
    let projectContext = "";
    try {
      projectContext = await gatherProjectContext(ide);
    } catch {
      // Continue without context
    }
    yield projectContext
      ? `Context gathered.\n\n`
      : `No context found (no open folder).\n\n`;

    yield `---\n\n### Phase 1 - Independent Proposals\n\n`;

    for (const agent of agents) {
      yield `**${agent.name}** is preparing a proposal...\n\n`;

      const messages = buildCouncilAnalysisMessages(
        agent,
        task,
        projectContext,
      );
      let response = "";

      try {
        for await (const chunk of agent.llm.streamChat(messages, abortSignal)) {
          const text = renderChatMessage(chunk);
          response += text;
          yield text;
        }
      } catch (e: any) {
        response = `[Error: ${e.message}]`;
        yield `\n! Error: ${e.message}\n`;
      }

      history.push({
        agent: agent.name,
        content: response,
        phase: "analysis",
        round: 0,
      });

      yield `\n\n`;
    }

    if (critiqueRounds > 0) {
      yield `---\n\n### Phase 2 - Council Critique\n\n`;
    }

    for (let round = 0; round < critiqueRounds; round++) {
      yield `**Critique Round ${round + 1}**\n\n`;

      const previousResponses = history.filter(
        (h) =>
          h.phase === "analysis" || (h.phase === "critique" && h.round < round),
      );

      for (const agent of agents) {
        yield `**${agent.name}** is critiquing...\n\n`;

        const messages = buildCouncilCritiqueMessages(
          agent,
          task,
          projectContext,
          previousResponses,
          round,
        );

        let response = "";
        try {
          for await (const chunk of agent.llm.streamChat(
            messages,
            abortSignal,
          )) {
            const text = renderChatMessage(chunk);
            response += text;
            yield text;
          }
        } catch (e: any) {
          response = `[Error: ${e.message}]`;
          yield `\n! Error: ${e.message}\n`;
        }

        history.push({
          agent: agent.name,
          content: response,
          phase: "critique",
          round,
        });

        yield `\n\n`;
      }
    }

    yield `---\n\n### Phase 3 - Plan Synthesis\n\n`;

    const planMessages = buildPlanMessages(task, projectContext, history);
    let planContent = "";

    try {
      for await (const chunk of agents[0].llm.streamChat(
        planMessages,
        abortSignal,
      )) {
        const text = renderChatMessage(chunk);
        planContent += text;
        yield text;
      }
    } catch (e: any) {
      yield `\n! Error generating plan: ${e.message}\n`;
    }

    if (!isValidPlanContent(planContent)) {
      yield `\n\n**FAIL:** Plan synthesis returned malformed result.\n`;
      return;
    }

    if (planContent.trim()) {
      try {
        const workspaceDirs = await ide.getWorkspaceDirs();
        if (workspaceDirs.length > 0) {
          const planUri = joinPathsToUri(workspaceDirs[0], "council-plan.md");
          await ide.writeFile(planUri, planContent);
          await ide.openFile(planUri);

          yield `\n\n---\n\n`;
          yield `**Plan saved and opened:** \`council-plan.md\`\n`;

          if (saveDiscussion) {
            const discussionContent = formatCouncilDiscussion(
              history,
              task,
              agents,
              difficulty,
            );
            const discussionUri = joinPathsToUri(
              workspaceDirs[0],
              "council-discussion.md",
            );
            await ide.writeFile(discussionUri, discussionContent);
            yield `**Discussion saved:** \`council-discussion.md\`\n`;
          }

          yield `\nTo implement the plan, copy the contents of council-plan.md into the chat and write "implement this plan, create all files".\n`;
        } else {
          yield `\n! No project folder open. Open a folder via File > Open Folder.\n`;
        }
      } catch (e: any) {
        yield `\n! Failed to save: ${e.message}\n`;
        try {
          await ide.showVirtualFile("council-plan.md", planContent);
          yield `Plan opened in a temporary tab.\n`;
        } catch {
          yield `\n${planContent}\n`;
        }
      }
    }
  },
};

export default CouncilCommand;

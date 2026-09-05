import ignore from "ignore";

import type { FileType, IDE } from "../../../index.js";
import { ChatMessage, ILLM, SlashCommand } from "../../../index.js";
import { DEFAULT_IGNORE, gitIgArrayFromFile } from "../../../indexing/ignore.js";
import { getGlobalXynapseIgArray } from "../../../indexing/xynapseignore.js";
import { renderChatMessage } from "../../../util/messageContent.js";
import {
  computeBvcPreflight,
  didBvcCritiqueImprove,
  evaluateBvcCritique,
} from "./bvcPolicy.js";
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

/** Disagreement metrics returned by Disagreement() */
interface DisagreementResult {
  D_vote: number | undefined; // undefined when no axis has >=2 valid votes
  D_cov: number;              // coverage divergence [0,1]: 0 = all axes covered
  T_ge2: BVCDecisionAxisId[];  // fixed BVC axes with >=2 valid votes
  axisStats: AxisDisagreementStats[];
}

interface AxisDisagreementStats {
  axis: BVCDecisionAxisId;
  m: number;
  d_vote?: number;
  d_cov: number;
  voteCounts: Record<string, number>;
}

/** BVC thresholds (defaults, can be overridden via GUI) */
const DEFAULT_TAU_VOTE = 0.3;   // τ_vote: enter critique if D_vote > this
const DEFAULT_TAU_CRIT = 0.7;   // τ_crit: early-fail if D_vote > this after critique
const DEFAULT_TAU_COV = 0.5;     // τ_cov: structured-output degradation threshold
const DEFAULT_K_MAX = 2;         // max critique rounds (adaptive, not fixed)
const DEFAULT_P_MAX = 0;         // this slash command performs planning/synthesis only
const DEFAULT_J_SO = 1;          // bounded structured-output re-asks per invalid role
const DEFAULT_LAMBDA_COST = 0.1;
const DEFAULT_EPSILON_VOTE = 0.05;
const DEFAULT_EPSILON_COV = 0.03;
const DEFAULT_EPSILON_NUM = 1e-6;

interface BVCParamsConfig {
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
}

function resolveBVCParams(params?: BVCParamsConfig) {
  const P_MAX = Math.max(0, Math.floor(params?.pMax ?? DEFAULT_P_MAX));
  const derivedBRes = 1 + (P_MAX >= 1 ? 1 : 0);
  const requestedBRes = params?.bRes;
  const safeBRes = typeof requestedBRes === "number" && Number.isFinite(requestedBRes)
    ? Math.max(1, Math.floor(requestedBRes))
    : derivedBRes;
  return {
    TAU_VOTE: params?.tauVote ?? DEFAULT_TAU_VOTE,
    TAU_CRIT: params?.tauCrit ?? DEFAULT_TAU_CRIT,
    TAU_COV: params?.tauCov ?? params?.tauCovBase ?? DEFAULT_TAU_COV,
    K_MAX: Math.max(0, Math.floor(params?.kMax ?? DEFAULT_K_MAX)),
    P_MAX,
    B_RES: safeBRes,
    J_SO: Math.max(0, Math.floor(params?.jSo ?? DEFAULT_J_SO)),
    LAMBDA_COST: Math.max(0, params?.lambdaCost ?? DEFAULT_LAMBDA_COST),
    EPSILON_VOTE: Math.max(0, params?.epsilonVote ?? DEFAULT_EPSILON_VOTE),
    EPSILON_COV: Math.max(0, params?.epsilonCov ?? DEFAULT_EPSILON_COV),
    SELECTIVE_ACTIVATION: params?.selectiveActivation !== false,
    FORCE_COUNCIL: params?.forceCouncil === true,
  };
}

function formatMetric(value: number | undefined): string {
  return value === undefined ? "undef" : value.toFixed(2);
}

function metricLeq(value: number | undefined, threshold: number): boolean {
  return value !== undefined && value <= threshold;
}

function metricGt(value: number | undefined, threshold: number): boolean {
  return value !== undefined && value > threshold;
}

// ── Config ─────────────────────────────────────────────────────────

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

/** Budget multiplier per difficulty (higher = more room for critique) */
const DIFFICULTY_BUDGET: Record<Difficulty, number> = {
  easy: 1,    // N+1 (no critique)
  medium: 2,  // 2N+1
  hard: 3,    // 3N+1
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
  "PM": `You are the Project Manager on the Council team.
Your responsibilities:
- Clarify the user's requirements and turn them into an actionable scope
- Keep the discussion aligned with the user's goal
- Prioritize work into an MVP and follow-up tasks
- Resolve tradeoffs from a product and delivery perspective
- Synthesize the final plan when the discussion converges

Be concise, practical, and specific.`,

  "Architect": `You are the Architect on the Council team.
Your responsibilities:
- Propose the project architecture: file structure, modules, APIs
- Choose appropriate design patterns
- Consider scalability and extensibility
- Assess technical risks
- Respond to remarks from other participants

Justify your architectural decisions.
Be specific — name files, folder structures, data formats.`,

  "Developer": `You are the Senior Developer on the Council team.
Your responsibilities:
- Propose specific technologies, libraries, and frameworks
- Design algorithms and data structures
- Estimate implementation complexity for each component
- Critically evaluate architectural decisions — point out issues
- Suggest improvements and alternative approaches

Be practical — propose concrete code and solutions.`,

  "Reviewer": `You are the Code Reviewer and QA expert on the Council team.
Your responsibilities:
- Critically evaluate the proposed architecture and solutions
- Find potential bugs, vulnerabilities, and edge cases
- Assess security (SQL injection, XSS, CSRF, etc.)
- Suggest alternative approaches if current ones have problems
- Verify that the solution covers all task requirements

Be strict but constructive.`,

  "Tester": `You are the QA Engineer and Tester on the Council team.
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

const PHASE1_SUFFIX = `

Respond STRICTLY in the following format:

## Proposal
Your vision for solving the task. Specific technologies, approaches, structure.

## Risks
What problems and challenges you foresee. What could go wrong.

## Key Decisions
Return EXACTLY these four fixed BVC axes. Use one value per axis.
If an axis is not applicable, write NA. Do not omit axes.
- root_cause_location: <where the root cause or main work is located, or NA>
- fix_strategy: <the proposed strategy, or NA>
- dependencies_to_update: <dependencies/configs/data/contracts to change, or NA>
- test_coverage: <tests/verification needed, or NA>

## BVC Decisions JSON
Return the same decisions as strict JSON. The object must have no extra fields and each value must be a string with max 240 characters.
\`\`\`json
{
  "bvc_decisions": {
    "root_cause_location": "value or NA",
    "fix_strategy": "value or NA",
    "dependencies_to_update": "value or NA",
    "test_coverage": "value or NA"
  }
}
\`\`\``;

const PHASE2_SUFFIX = `

You have received responses from all team members. Your task is to perform a CRITICAL ANALYSIS.

Respond STRICTLY in the following format:

## Agree
Which specific proposals from other participants you agree with and why. Name the participant and their point.

## Disagree
What you do NOT agree with. For each point:
- Whose proposal it is
- What the problem is
- Why it is a bad decision

## Suggest Changes
Your specific alternative proposals to replace what you disagree with.

## Key Decisions
Return EXACTLY these four fixed BVC axes after considering the full snapshot.
Use [PARSE_FAILURE] only if you cannot produce a valid value for an axis.
- root_cause_location: <updated value, NA, or [PARSE_FAILURE]>
- fix_strategy: <updated value, NA, or [PARSE_FAILURE]>
- dependencies_to_update: <updated value, NA, or [PARSE_FAILURE]>
- test_coverage: <updated value, NA, or [PARSE_FAILURE]>

## BVC Decisions JSON
Return the same updated decisions as strict JSON. The object must have no extra fields and each value must be a string with max 240 characters.
\`\`\`json
{
  "bvc_decisions": {
    "root_cause_location": "value, NA, or [PARSE_FAILURE]",
    "fix_strategy": "value, NA, or [PARSE_FAILURE]",
    "dependencies_to_update": "value, NA, or [PARSE_FAILURE]",
    "test_coverage": "value, NA, or [PARSE_FAILURE]"
  }
}
\`\`\``;

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
  if (typeof value === "string" && VALID_DIFFICULTIES.includes(value as Difficulty)) {
    return value as Difficulty;
  }
  return "medium";
}

function validateRoles(roles: unknown): CouncilGuiConfig["roles"] | undefined {
  if (!Array.isArray(roles) || roles.length === 0) return undefined;
  return roles.filter(
    (r) => r && typeof r.name === "string" && r.name.trim() !== "" && typeof r.modelTitle === "string",
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
    return { difficulty: "easy", task: trimmed.replace(/^easy\s+/i, ""), saveDiscussion: true };
  }
  if (lower.startsWith("hard ")) {
    return { difficulty: "hard", task: trimmed.replace(/^hard\s+/i, ""), saveDiscussion: true };
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
  const byRole = isRecord(configRecord.modelsByRole) ? configRecord.modelsByRole : {};
  for (const role of ["chat", "edit", "apply", "summarize"]) {
    const roleModels = byRole[role];
    if (!Array.isArray(roleModels)) {
      continue;
    }
    for (const m of roleModels) {
      if (isLLMLike(m)) {
        const key = m.uniqueId ?? m.model ?? m.title;
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
        const key = m.uniqueId ?? m.model ?? m.title;
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

// ── BVC Decision Axes and Canonization ────────────────────────────

const BVC_DECISION_AXES = [
  {
    id: "root_cause_location",
    aliases: ["root_cause_location", "root cause location", "root cause", "location"],
  },
  {
    id: "fix_strategy",
    aliases: ["fix_strategy", "fix strategy", "strategy", "solution strategy"],
  },
  {
    id: "dependencies_to_update",
    aliases: ["dependencies_to_update", "dependencies to update", "dependencies", "dependency updates"],
  },
  {
    id: "test_coverage",
    aliases: ["test_coverage", "test coverage", "tests", "verification"],
  },
] as const;

type BVCDecisionAxisId = (typeof BVC_DECISION_AXES)[number]["id"];

type CanonicalVote = "bot" | "NA" | `cluster:${number}`;
type BVCDecisionValue = string | "bot" | "NA";

const MAX_DECISION_VALUE_LENGTH = 240;

const BOT_MARKERS = new Set([
  "",
  "bot",
  "⊥",
  "[parse_failure]",
  "parse_failure",
  "[error]",
  "error",
]);

function normalizeDecisionValue(value: string | undefined): string | "bot" | "NA" {
  const trimmed = (value ?? "").trim();
  const lower = trimmed.toLowerCase();
  if (BOT_MARKERS.has(lower)) {
    return "bot";
  }
  if (lower === "na" || lower === "n/a" || lower === "not applicable") {
    return "NA";
  }
  if (trimmed.length > MAX_DECISION_VALUE_LENGTH) {
    return "bot";
  }
  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Common stop words to remove when computing axis similarity */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "with",
  "is", "it", "by", "at", "as", "be", "this", "that", "from", "not",
  "are", "was", "were", "been", "being", "have", "has", "had", "do",
  "does", "did", "will", "would", "shall", "should", "may", "might",
  "can", "could", "must", "vs", "between", "right", "best", "good",
  "use", "using", "choosing", "selecting", "designing", "implementing",
  "handling", "based", "approach", "strategy", "recommendation",
]);

/**
 * Synonym map: maps domain-specific words to a canonical form.
 * This ensures "architecture" and "structure" are recognized as related,
 * "testing" and "test" merge, etc.
 */
const SYNONYM_MAP: Record<string, string> = {
  // Architecture / Structure
  architecture: "structure", architectur: "structure", modular: "structure",
  structural: "structure", organize: "structure", organiz: "structure",
  pattern: "structure", layout: "structure",
  // Technology / Stack
  technology: "tech", technolog: "tech", stack: "tech",
  framework: "tech", library: "tech", librari: "tech",
  tool: "tech", javascript: "tech_js", css: "tech_css", html: "tech_html",
  bootstrap: "tech_css", typescript: "tech_js",
  // Testing
  test: "test", testing: "test", unittest: "test", e2e: "test",
  selenium: "test", cypress: "test", jasmine: "test", mocha: "test",
  verification: "test", coverage: "test",
  // Error / Validation
  error: "error", exception: "error", fault: "error", failure: "error",
  validation: "validate", validate: "validate", validat: "validate",
  sanitize: "validate", sanitiz: "validate",
  // UI / Interface
  interface: "ui", ui: "ui", ux: "ui", visual: "ui", display: "ui",
  responsive: "ui", button: "ui",
  // Performance
  performance: "perf", performanc: "perf", optimization: "perf",
  optimiz: "perf", optimiza: "perf", speed: "perf", efficient: "perf",
  // Security
  security: "security", secur: "security", xss: "security",
  // Compatibility
  compatibility: "compat", compatibil: "compat", browser: "compat",
  crossbrowser: "compat",
  // Input
  input: "input", user: "input",
  // Edge cases
  edge: "edge", corner: "edge", boundary: "edge",
};

/**
 * Extract significant keywords from an axis title.
 * Removes stop words, stems common suffixes, maps synonyms,
 * and returns a set of canonical keywords.
 */
function extractKeywords(axis: string): Set<string> {
  const words = axis
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));

  const result = new Set<string>();
  for (const w of words) {
    // Simple English suffix stemming
    let s = w;
    if (s.endsWith("tion") || s.endsWith("sion")) s = s.slice(0, -4);
    else if (s.endsWith("ment")) s = s.slice(0, -4);
    else if (s.endsWith("ness")) s = s.slice(0, -4);
    else if (s.endsWith("ity")) s = s.slice(0, -3);
    else if (s.endsWith("ing")) s = s.slice(0, -3);
    else if (s.endsWith("ies")) s = s.slice(0, -3) + "y";
    else if (s.endsWith("es")) s = s.slice(0, -2);
    else if (s.endsWith("ed")) s = s.slice(0, -2);
    else if (s.endsWith("ly")) s = s.slice(0, -2);
    else if (s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);

    // Apply synonym mapping: try both original and stemmed forms
    const canonical = SYNONYM_MAP[w] ?? SYNONYM_MAP[s] ?? s;
    if (canonical.length > 1) result.add(canonical);
  }
  return result;
}

/**
 * Compute Jaccard similarity between two keyword sets.
 * Returns a value in [0, 1] where 1 means identical sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Similarity threshold for merging axes (0.25 = share ≥25% of keywords) */
const AXIS_SIMILARITY_THRESHOLD = 0.2;

/**
 * Merge semantically similar axes across agents using fuzzy keyword matching.
 * Returns a map from canonical axis name → set of original axis names that map to it.
 */
function mergeAxes(allRawAxes: string[]): Map<string, Set<string>> {
  const groups: Array<{ canonical: string; keywords: Set<string>; members: Set<string> }> = [];

  for (const axis of allRawAxes) {
    const kw = extractKeywords(axis);
    let merged = false;

    for (const group of groups) {
      if (jaccardSimilarity(kw, group.keywords) >= AXIS_SIMILARITY_THRESHOLD) {
        group.members.add(axis);
        // Expand group keywords with the new member's keywords
        for (const w of kw) group.keywords.add(w);
        merged = true;
        break;
      }
    }

    if (!merged) {
      groups.push({ canonical: axis, keywords: kw, members: new Set([axis]) });
    }
  }

  const result = new Map<string, Set<string>>();
  for (const g of groups) {
    result.set(g.canonical, g.members);
  }
  return result;
}

function createEmptyBVCDecisions(): Map<BVCDecisionAxisId, BVCDecisionValue> {
  const decisions = new Map<BVCDecisionAxisId, BVCDecisionValue>();
  for (const axis of BVC_DECISION_AXES) {
    decisions.set(axis.id, "bot");
  }
  return decisions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function extractJsonCandidates(content: string): string[] {
  const candidates: string[] = [];
  const trimmedContent = content.trim();
  if (trimmedContent.startsWith("{")) {
    candidates.push(trimmedContent);
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = fenced.exec(content)) !== null) {
    candidates.push(match[1].trim());
  }

  const keyIndex = content.indexOf('"bvc_decisions"');
  if (keyIndex >= 0) {
    const start = content.lastIndexOf("{", keyIndex);
    if (start >= 0) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      let completed = false;

      for (let i = start; i < content.length; i++) {
        const char = content[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "\"") {
          inString = !inString;
          continue;
        }
        if (inString) {
          continue;
        }
        if (char === "{") {
          depth++;
        } else if (char === "}") {
          depth--;
          if (depth === 0) {
            candidates.push(content.slice(start, i + 1));
            completed = true;
            break;
          }
        }
      }
      if (!completed) {
        candidates.push(content.slice(start));
      }
    }
  }

  return candidates;
}

function deterministicJsonRepairs(candidate: string): string[] {
  const normalized = candidate
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/^\uFEFF/, "")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
  const repaired = [normalized];
  const hasAllAxes = BVC_DECISION_AXES.every((axis) => normalized.includes(`"${axis.id}"`));
  if (!hasAllAxes) {
    return repaired;
  }

  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escaped = false;
  for (const char of normalized) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "{") braces++;
      else if (char === "}") braces--;
      else if (char === "[") brackets++;
      else if (char === "]") brackets--;
    }
  }
  if (braces > 0 || brackets > 0 || inString) {
    repaired.push(
      normalized
        + (inString ? "\"" : "")
        + "]".repeat(Math.max(0, brackets))
        + "}".repeat(Math.max(0, braces)),
    );
  }
  return repaired;
}

function parseBVCDecisionsFromJson(content: string): Map<BVCDecisionAxisId, BVCDecisionValue> | undefined {
  const candidates = extractJsonCandidates(content).flatMap(deterministicJsonRepairs);
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }

    if (!isRecord(parsed)) {
      continue;
    }

    const wrapped = hasOwn(parsed, "bvc_decisions");
    if (wrapped && Object.keys(parsed).length !== 1) {
      continue;
    }
    const decisionsObject = wrapped ? parsed.bvc_decisions : parsed;
    if (!isRecord(decisionsObject)) {
      continue;
    }

    const allowedKeys = new Set(BVC_DECISION_AXES.map((axis) => axis.id));
    const keys = Object.keys(decisionsObject);
    if (keys.length !== BVC_DECISION_AXES.length || keys.some((key) => !allowedKeys.has(key as BVCDecisionAxisId))) {
      continue;
    }

    const decisions = createEmptyBVCDecisions();
    for (const axis of BVC_DECISION_AXES) {
      const value = decisionsObject[axis.id];
      const scalar = Array.isArray(value) && value.length === 1 ? value[0] : value;
      decisions.set(axis.id, typeof scalar === "string" ? normalizeDecisionValue(scalar) : "bot");
    }
    return decisions;
  }

  return undefined;
}

function extractKeyDecisionBlock(content: string): string {
  const match = content.match(/##\s*Key Decisions\s*\n([\s\S]*?)(?=\n##|\n---|$)/i);
  return match?.[1] ?? "";
}

function getAxisFromLine(line: string): BVCDecisionAxisId | undefined {
  for (const axis of BVC_DECISION_AXES) {
    for (const alias of axis.aliases) {
      const pattern = new RegExp(
        `^\\s*(?:[-*]|\\d+[.)])?\\s*(?:\\*\\*)?\\s*${escapeRegExp(alias)}\\s*(?:\\*\\*)?\\s*[:—-]\\s*(.*)$`,
        "i",
      );
      if (pattern.test(line)) {
        return axis.id;
      }
    }
  }
  return undefined;
}

function getAxisValueFromLine(line: string, axisId: BVCDecisionAxisId): string {
  const axis = BVC_DECISION_AXES.find((entry) => entry.id === axisId)!;
  for (const alias of axis.aliases) {
    const pattern = new RegExp(
      `^\\s*(?:[-*]|\\d+[.)])?\\s*(?:\\*\\*)?\\s*${escapeRegExp(alias)}\\s*(?:\\*\\*)?\\s*[:—-]\\s*(.*)$`,
      "i",
    );
    const match = line.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return "";
}

function looksLikeExtraDecisionLine(line: string): boolean {
  return /^\s*(?:[-*]|\d+[.)])\s*(?:\*\*)?[^:\n]{2,80}(?:\*\*)?\s*[:\-–—]/.test(line);
}

function extractBVCDecisions(content: string): Map<BVCDecisionAxisId, BVCDecisionValue> {
  const jsonDecisions = parseBVCDecisionsFromJson(content);
  if (jsonDecisions) {
    return jsonDecisions;
  }

  const decisions = createEmptyBVCDecisions();
  const duplicateAxes = new Set<BVCDecisionAxisId>();
  const seenAxes = new Set<BVCDecisionAxisId>();
  let hasExtraField = false;

  const block = extractKeyDecisionBlock(content);
  if (!block.trim()) {
    return decisions;
  }

  let currentAxis: BVCDecisionAxisId | undefined;
  let currentValue = "";

  const flush = () => {
    if (currentAxis) {
      if (duplicateAxes.has(currentAxis)) {
        decisions.set(currentAxis, "bot");
      } else {
        decisions.set(currentAxis, normalizeDecisionValue(currentValue));
      }
    }
  };

  for (const line of block.split("\n")) {
    const axis = getAxisFromLine(line);
    if (axis) {
      flush();
      if (seenAxes.has(axis)) {
        duplicateAxes.add(axis);
        decisions.set(axis, "bot");
      }
      seenAxes.add(axis);
      currentAxis = axis;
      currentValue = getAxisValueFromLine(line, axis);
    } else if (looksLikeExtraDecisionLine(line)) {
      hasExtraField = true;
    } else if (currentAxis && line.trim() && !line.trim().startsWith("##")) {
      currentValue += ` ${line.trim()}`;
    }
  }
  flush();

  if (hasExtraField) {
    return createEmptyBVCDecisions();
  }

  return decisions;
}

function countValidBVCDecisions(content: string): number {
  return [...extractBVCDecisions(content).values()].filter((value) => value !== "bot").length;
}

function normalizeForAxis(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'(){}\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function axisSimilarity(axis: BVCDecisionAxisId, left: string, right: string): number {
  const a = normalizeForAxis(left);
  const b = normalizeForAxis(right);
  if (a === b) {
    return 1;
  }

  const aKeywords = extractKeywords(a);
  const bKeywords = extractKeywords(b);
  if (axis === "root_cause_location" || axis === "dependencies_to_update") {
    return jaccardSimilarity(aKeywords, bKeywords);
  }

  return jaccardSimilarity(aKeywords, bKeywords);
}

function axisClusterThreshold(axis: BVCDecisionAxisId): number {
  if (axis === "root_cause_location" || axis === "dependencies_to_update") {
    return 0.55;
  }
  return 0.85;
}

function canonicalizeAxisVotes(axis: BVCDecisionAxisId, values: BVCDecisionValue[]): CanonicalVote[] {
  const clusters: Array<{ representative: string }> = [];
  const threshold = axisClusterThreshold(axis);

  return values.map((value) => {
    if (value === "bot") {
      return "bot";
    }
    if (value === "NA") {
      return "NA";
    }

    const normalized = normalizeForAxis(value);
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const similar = axisSimilarity(axis, normalized, cluster.representative) >= threshold;
      if (similar) {
        return `cluster:${i + 1}` as const;
      }
    }

    clusters.push({ representative: normalized });
    return `cluster:${clusters.length}` as const;
  });
}

// ── Disagreement (Algorithm 2, line 626) ──────────────────────────

/**
 * Compute disagreement metrics from agent responses.
 *
 * Implements the precise BVC metric:
 *   - fixed axes T0 = {root_cause_location, fix_strategy,
 *     dependencies_to_update, test_coverage}
 *   - bot / [PARSE_FAILURE] is excluded from voting
 *   - NA is a valid vote label
 *   - d_vote(t) = (m_t - max_c n_t,c) / (m_t - 1), for m_t >= 2
 *   - D_cov averages 1 - m_t/R over all fixed axes
 */
function computeDisagreement(
  responses: HistoryEntry[],
  totalAgents = responses.length,
): DisagreementResult {
  const R = Math.max(totalAgents, responses.length, 1);
  const decisionsByAgent = responses.map((response) => extractBVCDecisions(response.content));
  const T_ge2: BVCDecisionAxisId[] = [];
  const axisStats: AxisDisagreementStats[] = [];
  let totalValidVotes = 0;
  let voteDivergenceSum = 0;

  for (const axis of BVC_DECISION_AXES) {
    const rawValues = decisionsByAgent.map((decisions) => decisions.get(axis.id) ?? "bot");
    const votes = canonicalizeAxisVotes(axis.id, rawValues);
    const voteCounts: Record<string, number> = {};

    for (const vote of votes) {
      if (vote === "bot") {
        continue;
      }
      voteCounts[vote] = (voteCounts[vote] ?? 0) + 1;
    }

    const m = Object.values(voteCounts).reduce((sum, count) => sum + count, 0);
    totalValidVotes += m;
    const d_cov = 1 - m / R;
    let d_vote: number | undefined;

    if (m >= 2) {
      const maxCluster = Math.max(...Object.values(voteCounts));
      d_vote = (m - maxCluster) / (m - 1);
      voteDivergenceSum += d_vote;
      T_ge2.push(axis.id);
    }

    axisStats.push({ axis: axis.id, m, d_vote, d_cov, voteCounts });
  }

  const D_vote = T_ge2.length > 0 ? voteDivergenceSum / T_ge2.length : undefined;
  const D_cov = 1 - totalValidVotes / (BVC_DECISION_AXES.length * R);

  return { D_vote, D_cov, T_ge2, axisStats };
}

function formatDecisionSnapshot(entries: HistoryEntry[]): string {
  const lines: string[] = [];
  lines.push("Structured BVC decision snapshot:");

  for (const entry of entries) {
    const decisions = extractBVCDecisions(entry.content);
    lines.push(`\n[${entry.agent}]`);
    for (const axis of BVC_DECISION_AXES) {
      const value = decisions.get(axis.id) ?? "bot";
      lines.push(`- ${axis.id}: ${value === "bot" ? "[PARSE_FAILURE]" : value}`);
    }
  }

  return lines.join("\n");
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

async function gatherProjectContext(ide: IDE): Promise<string> {
  const workspaceDirs = await ide.getWorkspaceDirs();
  if (workspaceDirs.length === 0) return "";

  const workspaceDir = workspaceDirs[0];
  let context = "";

  async function exploreDirectory(dir: string, currentDepth: number = 0) {
    if (currentDepth > MAX_EXPLORE_DEPTH) {
      return;
    }

    const entries = await getEntriesFilteredByIgnore(dir, ide);

    for (const entry of entries) {
      if (entry.type === (2 as FileType.Directory)) {
        context += `Folder: ${entry.relativePath}\n`;
        await exploreDirectory(entry.uri, currentDepth + 1);
      } else {
        if (entry.basename.toLowerCase() === "readme.md") {
          try {
            const content = await ide.readFile(entry.uri);
            const truncated = content.length > 2000
              ? content.substring(0, 2000) + "\n... (truncated)"
              : content;
            context += `\nREADME (${entry.relativePath}):\n${truncated}\n\n`;
          } catch {
            // skip unreadable files
          }
        } else if (LANGUAGE_DEP_MGMT_FILENAMES.includes(entry.basename)) {
          try {
            const content = await ide.readFile(entry.uri);
            const truncated = content.length > 3000
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
  lines.push(`**Participants:** ${agents.map((a) => `${a.name} (${a.llm.title || a.llm.model})`).join(", ")}\n`);
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

function buildPhase1Messages(
  agent: CouncilAgent,
  task: string,
  projectContext: string,
): ChatMessage[] {
  let systemContent = agent.systemPrompt;
  if (projectContext) {
    systemContent += `\n\n## Project Context\n${projectContext}`;
  }
  systemContent += PHASE1_SUFFIX;

  return [
    { role: "system", content: systemContent },
    { role: "user", content: `Task: ${task}` },
  ];
}

function buildBvcRecoveryMessages(
  agent: CouncilAgent,
  invalidContent: string,
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You repair structured output for the ${agent.name} role.
Return ONLY one JSON object, with no markdown and no reasoning.
Each value must be a string of at most 240 characters. Use "NA" when an axis is not applicable.
The exact schema is:
{"bvc_decisions":{"root_cause_location":"string","fix_strategy":"string","dependencies_to_update":"string","test_coverage":"string"}}`,
    },
    {
      role: "user",
      content: `Repair this invalid or incomplete output without adding new analysis:\n${invalidContent.slice(-8000)}`,
    },
  ];
}

function buildFallbackPlanMessages(
  task: string,
  projectContext: string,
  reason: string,
): ChatMessage[] {
  let systemContent = `${PLAN_PROMPT}

This is the BVC fallback route. Produce the best single-agent plan directly; do not pretend that Council reached consensus.
Routing reason: ${reason}`;
  if (projectContext) {
    systemContent += `\n\n## Project Context\n${projectContext}`;
  }
  return [
    { role: "system", content: systemContent },
    { role: "user", content: `Task: ${task}` },
  ];
}

function buildPhase2Messages(
  agent: CouncilAgent,
  task: string,
  projectContext: string,
  previousResponses: HistoryEntry[],
): ChatMessage[] {
  let systemContent = agent.systemPrompt;
  if (projectContext) {
    systemContent += `\n\n## Project Context\n${projectContext}`;
  }
  systemContent += PHASE2_SUFFIX;

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: `Task: ${task}` },
    {
      role: "user",
      content: formatDecisionSnapshot(previousResponses),
    },
  ];

  // Add each previous response as assistant/user pairs with clear attribution
  for (const entry of previousResponses) {
    messages.push({
      role: "assistant",
      content: `[${entry.agent}] responds:\n${entry.content}`,
    });
    messages.push({
      role: "user",
      content: `That was the response from "${entry.agent}". Continue the analysis.`,
    });
  }

  messages.push({
    role: "user",
    content: `Now respond as ${agent.name}. Perform a critical analysis of ALL responses above.`,
  });

  return messages;
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
    messages.push({ role: "user", content: "These were the individual analyses from participants." });
  }

  if (recoveries.length > 0) {
    let recoveryBlock = "--- Structured-output Recovery ---\n\n";
    for (const entry of recoveries) {
      recoveryBlock += `[${entry.agent}] corrected JSON:\n${entry.content}\n\n`;
    }
    messages.push({ role: "assistant", content: recoveryBlock });
    messages.push({ role: "user", content: "Use these corrected decisions instead of invalid structured outputs from the same roles." });
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
      messages.push({ role: "user", content: `These were the critiques from round ${r + 1}.` });
    }
  }

  messages.push({
    role: "user",
    content: "Based on the ENTIRE discussion, create the final plan. Be sure to resolve all disputed points in the 'Disputed Decisions' section.",
  });

  return messages;
}

// ── Discussion Formatter ───────────────────────────────────────────

function formatDiscussion(
  history: HistoryEntry[],
  task: string,
  agents: CouncilAgent[],
  difficulty: Difficulty,
  totalBudgetUsed: number,
  totalBudget: number,
  critiqueRoundsUsed: number,
  result?: {
    disagreement?: DisagreementResult;
    routeReason?: string;
  },
): string {
  const lines: string[] = [];
  lines.push("# BVC Discussion\n");
  lines.push(`**Task:** ${task}\n`);
  lines.push(`**Level:** ${DIFFICULTY_LABELS[difficulty]}\n`);
  lines.push(`**Participants:** ${agents.map((a) => `${a.name} (${a.llm.title || a.llm.model})`).join(", ")}\n`);
  lines.push(`**Budget:** ${totalBudgetUsed}/${totalBudget} LLM calls used\n`);
  lines.push(`**Critique rounds:** ${critiqueRoundsUsed} (adaptive)\n`);
  if (result?.routeReason) {
    lines.push(`**Route:** single-agent fallback — ${result.routeReason}\n`);
  } else {
    lines.push("**Route:** Council-triggered\n");
  }

  if (result?.disagreement) {
    lines.push(`**Disagreement:** D_vote=${formatMetric(result.disagreement.D_vote)}, D_cov=${result.disagreement.D_cov.toFixed(2)}, axes>=2: ${result.disagreement.T_ge2.length}\n`);
    lines.push("**Axis stats:**\n");
    for (const stat of result.disagreement.axisStats) {
      lines.push(`- ${stat.axis}: m=${stat.m}, d_vote=${formatMetric(stat.d_vote)}, d_cov=${stat.d_cov.toFixed(2)}\n`);
    }
  }

  lines.push("---\n");

  // Phase 1
  const phase1 = history.filter((h) => h.phase === "analysis");
  if (phase1.length > 0) {
    lines.push("\n## Phase 1 — Independent Analysis\n");
    for (const msg of phase1) {
      lines.push(`### ${msg.agent}\n`);
      lines.push(msg.content);
      lines.push("\n");
    }
  }

  const recoveries = history.filter((h) => h.phase === "recovery");
  if (recoveries.length > 0) {
    lines.push("\n## Structured-output Recovery\n");
    for (const msg of recoveries) {
      lines.push(`### ${msg.agent}\n`);
      lines.push(msg.content);
      lines.push("\n");
    }
  }

  // Phase 2
  const critiques = history.filter((h) => h.phase === "critique");
  if (critiques.length > 0) {
    const maxRound = Math.max(...critiques.map((c) => c.round));
    for (let r = 0; r <= maxRound; r++) {
      const roundEntries = critiques.filter((c) => c.round === r);
      if (roundEntries.length === 0) continue;

      lines.push(`\n## Phase 2 — Adaptive Critique, Round ${r + 1}\n`);
      for (const msg of roundEntries) {
        lines.push(`### ${msg.agent}\n`);
        lines.push(msg.content);
        lines.push("\n");
      }
    }
  }

  return lines.join("\n");
}

// ── Main Command (BVC Algorithm 2) ─────────────────────────────────

export const BvcCommand: SlashCommand = {
  name: "bvc",
  description: "BVC - budgeted verified council algorithm",
  // This method deliberately streams the five visible BVC phases in order.
  // eslint-disable-next-line max-statements, complexity
  run: async function* ({ ide, llm, input, config, abortController }) {
    if (!input.trim()) {
      yield "Describe a task for BVC.\n\n";
      yield "Format: `/bvc [easy|medium|hard] task`\n\n";
      yield "Or use the BVC button in the input toolbar.\n";
      return;
    }

    const { difficulty, task, roleOverrides, saveDiscussion, bvcParams } = parseInput(input);
    const {
      TAU_VOTE,
      TAU_CRIT,
      TAU_COV,
      K_MAX,
      P_MAX,
      B_RES,
      J_SO,
      LAMBDA_COST,
      EPSILON_VOTE,
      EPSILON_COV,
      SELECTIVE_ACTIVATION,
      FORCE_COUNCIL,
    } = resolveBVCParams(bvcParams);
    const diffLabel = DIFFICULTY_LABELS[difficulty];

    if (!task.trim()) {
      yield "Describe a task. Example: `/bvc easy build a calculator`";
      return;
    }

    const models = getAvailableModels(config, llm);
    const agents = buildBvcAgents(models, roleOverrides);
    const R = agents.length; // |R| — number of agents

    if (R === 0) {
      yield "No available models. Add a model in config.yaml.";
      return;
    }

    // ── Budget computation (Algorithm 2, line 617-618) ──
    const B = R * DIFFICULTY_BUDGET[difficulty] + B_RES; // total call budget
    let b = 0; // call counter (monotonically non-decreasing)

    if (B < R + B_RES) {
      yield "Budget too small for the number of agents. Reduce agents or increase difficulty.";
      return;
    }

    const agentList = agents
      .map((a) => `${a.name} (${a.llm.title || a.llm.model})`)
      .join(", ");

    // Header
    yield `## BVC v2 | ${diffLabel}\n\n`;
    yield `**Task:** ${task}\n`;
    yield `**Participants:** ${agentList}\n`;
    yield `**Budget:** B=${B} LLM calls\n`;
    yield `**Scope:** planning/synthesis (P_max=${P_MAX}; repair loop is not executed by this slash command)\n`;
    yield `**Thresholds:** τ_vote=${TAU_VOTE}, τ_crit=${TAU_CRIT}, τ_cov=${TAU_COV.toFixed(2)}, K_max=${K_MAX}, J_SO=${J_SO}\n\n`;

    const history: HistoryEntry[] = [];
    const abortSignal = abortController.signal;
    let lastDisagreement: DisagreementResult | undefined;
    let critiqueRoundsUsed = 0;
    let fallbackReason: string | undefined;

    // ── Gather Project Context (CollectContext) ──
    yield `Gathering project context...\n`;
    let projectContext = "";
    try {
      projectContext = await gatherProjectContext(ide);
    } catch {
      // Continue without context
    }
    if (projectContext) {
      yield `Context gathered.\n\n`;
    } else {
      yield `No context found (no open folder).\n\n`;
    }

    const preflight = computeBvcPreflight(task);
    const policyUncertainty = FORCE_COUNCIL || !SELECTIVE_ACTIVATION
      ? 1
      : preflight.uncertainty;
    const triggerCouncil = FORCE_COUNCIL
      || !SELECTIVE_ACTIVATION
      || preflight.triggerCouncil;
    yield `**Preflight:** U0=${preflight.uncertainty.toFixed(2)}, hard signals=${preflight.hardSignals}, files=${preflight.signals.nFiles}, signatures=${preflight.signals.nSignatures}\n`;
    if (triggerCouncil) {
      const triggerKind = FORCE_COUNCIL
        ? "manual forceCouncil override"
        : SELECTIVE_ACTIVATION
          ? "deterministic uncertainty gate"
          : "selective activation disabled";
      yield `**Route:** Council-triggered (${triggerKind}).\n\n`;
    } else {
      fallbackReason = "deterministic preflight classified the task as low uncertainty";
      yield `**Route:** single-agent fallback (${fallbackReason}).\n\n`;
    }

    // ════════════════════════════════════════════════════════════════
    // Phase 1: Independent Analysis (Algorithm 2, lines 620-627)
    // ════════════════════════════════════════════════════════════════
    let currentResponses: HistoryEntry[] = [];
    if (!fallbackReason) {
    yield `---\n\n### Phase 1 — Independent Analysis\n\n`;

    if (b + R > B) {
      yield `\n**Budget exhausted before analysis batch (b=${b}, R=${R}, B=${B}). Stopping.**\n`;
      return;
    }
    b += R; // reserve the whole LLM_Analyze batch before model calls

    for (const agent of agents) {
      yield `**${agent.name}** is analyzing the task...\n\n`;

      const messages = buildPhase1Messages(agent, task, projectContext);
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

    // Free deterministic repair is part of extraction. Re-ask only roles that
    // still do not have all four fixed axes, while preserving synthesis budget.
    currentResponses = history.filter((h) => h.phase === "analysis");
    for (let i = 0; i < currentResponses.length; i++) {
      let bestEntry = currentResponses[i];
      let bestValid = countValidBVCDecisions(bestEntry.content);
      for (let attempt = 0; bestValid < BVC_DECISION_AXES.length && attempt < J_SO; attempt++) {
        if (b + 1 + B_RES > B) {
          break;
        }
        yield `**${bestEntry.agent}** structured output is incomplete (${bestValid}/4 axes); running bounded JSON recovery...\n\n`;
        b += 1;
        const agent = agents.find((candidate) => candidate.name === bestEntry.agent) ?? agents[0];
        let repairedContent = "";
        try {
          for await (const chunk of agent.llm.streamChat(
            buildBvcRecoveryMessages(agent, bestEntry.content),
            abortSignal,
            { maxTokens: 1000, temperature: 0 },
          )) {
            const text = renderChatMessage(chunk);
            repairedContent += text;
            yield text;
          }
        } catch (e: any) {
          repairedContent = `[Error: ${e.message}]`;
          yield `\n! Recovery error: ${e.message}\n`;
        }
        const repairedEntry: HistoryEntry = {
          agent: bestEntry.agent,
          content: repairedContent,
          phase: "recovery",
          round: 0,
        };
        history.push(repairedEntry);
        const repairedValid = countValidBVCDecisions(repairedContent);
        if (repairedValid > bestValid) {
          bestEntry = repairedEntry;
          bestValid = repairedValid;
        }
        yield `\n\n`;
      }
      currentResponses[i] = bestEntry;
    }

    // Compute Disagreement after Phase 1 and structured-output recovery.
    lastDisagreement = computeDisagreement(currentResponses, R);

    yield `**Disagreement:** D_vote=${formatMetric(lastDisagreement.D_vote)}, D_cov=${lastDisagreement.D_cov.toFixed(2)}, axes>=2: ${lastDisagreement.T_ge2.length}\n\n`;

    // ════════════════════════════════════════════════════════════════
    // Phase 2: Adaptive Critique (Algorithm 2, lines 628-639)
    // Loop while: T≥2≠∅ AND D_cov≤τ_cov AND D_vote>τ_vote AND k<K_max AND budget allows
    // ════════════════════════════════════════════════════════════════
    let k = 0;
    let lastImproved = true;
    let critiqueHeaderShown = false;
    while (true) {
      const critiqueDecision = evaluateBvcCritique({
        dVote: lastDisagreement.D_vote,
        dCov: lastDisagreement.D_cov,
        comparableAxes: lastDisagreement.T_ge2.length,
        uncertainty: policyUncertainty,
        tauVote: TAU_VOTE,
        tauCrit: TAU_CRIT,
        tauCov: TAU_COV,
        round: k,
        maxRounds: K_MAX,
        activeRoles: R,
        usedBudget: b,
        totalBudget: B,
        reserve: B_RES,
        lastImproved,
        lambdaCost: LAMBDA_COST,
        epsilonNum: DEFAULT_EPSILON_NUM,
      });
      if (!critiqueDecision.allowed) {
        if (metricGt(lastDisagreement.D_vote, TAU_VOTE)) {
          yield `**Critique stopped:** ${critiqueDecision.reason} (gain=${critiqueDecision.gain.toFixed(3)}, cost=${critiqueDecision.cost.toFixed(3)}).\n\n`;
        }
        break;
      }
      if (!critiqueHeaderShown) {
        yield `---\n\n### Phase 2 — Budget-aware Critique\n\n`;
        critiqueHeaderShown = true;
      }

      const previousDisagreement = lastDisagreement;
      yield `**Critique Round ${k + 1}** (gain=${critiqueDecision.gain.toFixed(3)} > cost=${critiqueDecision.cost.toFixed(3)})\n\n`;
      b += R;
      const roundResponses: HistoryEntry[] = [];

      for (const agent of agents) {
        yield `**${agent.name}** is critiquing...\n\n`;
        const messages = buildPhase2Messages(agent, task, projectContext, currentResponses);
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
        const entry: HistoryEntry = {
          agent: agent.name,
          content: response,
          phase: "critique",
          round: k,
        };
        history.push(entry);
        roundResponses.push(entry);
        yield `\n\n`;
      }

      // Apply the same bounded SO recovery to the current critique batch.
      for (let i = 0; i < roundResponses.length; i++) {
        let bestEntry = roundResponses[i];
        let bestValid = countValidBVCDecisions(bestEntry.content);
        for (let attempt = 0; bestValid < BVC_DECISION_AXES.length && attempt < J_SO; attempt++) {
          if (b + 1 + B_RES > B) break;
          const agent = agents.find((candidate) => candidate.name === bestEntry.agent) ?? agents[0];
          yield `**${bestEntry.agent}** critique JSON is incomplete (${bestValid}/4); recovering...\n\n`;
          b += 1;
          let repairedContent = "";
          try {
            for await (const chunk of agent.llm.streamChat(
              buildBvcRecoveryMessages(agent, bestEntry.content),
              abortSignal,
              { maxTokens: 1000, temperature: 0 },
            )) {
              const text = renderChatMessage(chunk);
              repairedContent += text;
              yield text;
            }
          } catch (e: any) {
            repairedContent = `[Error: ${e.message}]`;
            yield `\n! Recovery error: ${e.message}\n`;
          }
          const repairedEntry: HistoryEntry = {
            agent: bestEntry.agent,
            content: repairedContent,
            phase: "recovery",
            round: k + 1,
          };
          history.push(repairedEntry);
          const repairedValid = countValidBVCDecisions(repairedContent);
          if (repairedValid > bestValid) {
            bestEntry = repairedEntry;
            bestValid = repairedValid;
          }
          yield `\n\n`;
        }
        roundResponses[i] = bestEntry;
      }

      const candidateDisagreement = computeDisagreement(roundResponses, R);
      lastImproved = didBvcCritiqueImprove(
        previousDisagreement.D_vote,
        previousDisagreement.D_cov,
        candidateDisagreement.D_vote,
        candidateDisagreement.D_cov,
        EPSILON_VOTE,
        EPSILON_COV,
      );
      currentResponses = roundResponses;
      lastDisagreement = candidateDisagreement;
      k++;
      critiqueRoundsUsed = k;
      yield `**After round ${k}:** D_vote=${formatMetric(lastDisagreement.D_vote)}, D_cov=${lastDisagreement.D_cov.toFixed(2)}, improved=${lastImproved ? "yes" : "no"}\n\n`;
    }

    if (critiqueRoundsUsed > 0 && metricLeq(lastDisagreement.D_vote, TAU_VOTE)) {
      yield `Critique converged (D_vote=${formatMetric(lastDisagreement.D_vote)} ≤ τ_vote=${TAU_VOTE}).\n\n`;
    }

    // ════════════════════════════════════════════════════════════════
    // Phase 3: fallback guards
    // ════════════════════════════════════════════════════════════════
    if (lastDisagreement.T_ge2.length === 0) {
      fallbackReason = "no axis has at least two valid votes after structured-output recovery";
    } else if (lastDisagreement.D_cov > TAU_COV) {
      fallbackReason = `structured-output coverage remained degraded (D_cov=${lastDisagreement.D_cov.toFixed(2)})`;
    } else if (metricGt(lastDisagreement.D_vote, TAU_CRIT)) {
      fallbackReason = `substantive disagreement remained critical (D_vote=${formatMetric(lastDisagreement.D_vote)})`;
    }

    if (b + 1 > B) {
      yield `**FAIL:** Insufficient budget for synthesis (b=${b}, B_res=${B_RES}, B=${B}).\n`;
      return;
    }

    if (fallbackReason) {
      yield `---\n\n### Phase 3 — Fallback\n\n`;
      yield `Council route stopped: ${fallbackReason}. Structured-output failure is not treated as disagreement.\n\n`;
    } else {
      yield `Phase 3 checks passed (D_vote=${formatMetric(lastDisagreement.D_vote)} ≤ τ_crit=${TAU_CRIT}, D_cov=${lastDisagreement.D_cov.toFixed(2)} ≤ τ_cov=${TAU_COV}).\n\n`;
    }
    }

    // ════════════════════════════════════════════════════════════════
    // Phase 4: Plan Synthesis (Algorithm 2, lines 646-649)
    // ════════════════════════════════════════════════════════════════
    yield `---\n\n### Phase 4 — ${fallbackReason ? "Single-Agent Fallback Plan" : "Council Plan Synthesis"}\n\n`;

    const planMessages = fallbackReason
      ? buildFallbackPlanMessages(task, projectContext, fallbackReason)
      : buildPlanMessages(task, projectContext, history);

    if (b + 1 > B) {
      yield `**FAIL:** No budget remains for ${fallbackReason ? "fallback" : "synthesis"} (b=${b}, B=${B}).\n`;
      return;
    }

    let planContent = "";
    b += 1; // reserve LLM_Synthesize before the model call
    try {
      for await (const chunk of agents[0].llm.streamChat(planMessages, abortSignal)) {
        const text = renderChatMessage(chunk);
        planContent += text;
        yield text;
      }
    } catch (e: any) {
      yield `\n! Error generating plan: ${e.message}\n`;
    }

    // Plan validation (Algorithm 2, line 649: Π=⊥ → Fail)
    if (!isValidPlanContent(planContent)) {
      yield `\n\n**FAIL:** Plan synthesis returned malformed result (Pi=bot).\n`;
      return;
    }

    // ── Save Files ──
    if (planContent.trim()) {
      try {
        const workspaceDirs = await ide.getWorkspaceDirs();
        if (workspaceDirs.length > 0) {
          // Save plan
          const planUri = joinPathsToUri(workspaceDirs[0], "bvc-plan.md");
          await ide.writeFile(planUri, planContent);
          await ide.openFile(planUri);

          yield `\n\n---\n\n`;
          yield `**Plan saved and opened:** \`bvc-plan.md\`\n`;
          yield `**Budget used:** ${b}/${B} LLM calls\n`;

          // Save discussion (only if enabled)
          if (saveDiscussion) {
            const discussionContent = formatDiscussion(
              history,
              task,
              agents,
              difficulty,
              b,
              B,
              critiqueRoundsUsed,
              {
                disagreement: lastDisagreement,
                routeReason: fallbackReason,
              },
            );
            const discussionUri = joinPathsToUri(
              workspaceDirs[0],
              "bvc-discussion.md",
            );
            await ide.writeFile(discussionUri, discussionContent);
            yield `**Discussion saved:** \`bvc-discussion.md\`\n`;
          }

          yield `\nTo implement the plan, copy the contents of bvc-plan.md into the chat and write "implement this plan, create all files".\n`;
        } else {
          yield `\n! No project folder open. Open a folder via File > Open Folder.\n`;
        }
      } catch (e: any) {
        yield `\n! Failed to save: ${e.message}\n`;
        try {
          await ide.showVirtualFile("bvc-plan.md", planContent);
          yield `Plan opened in a temporary tab.\n`;
        } catch {
          yield `\n${planContent}\n`;
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

    const { difficulty, task, roleOverrides, saveDiscussion } = parseInput(input);
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
    yield projectContext ? `Context gathered.\n\n` : `No context found (no open folder).\n\n`;

    yield `---\n\n### Phase 1 - Independent Proposals\n\n`;

    for (const agent of agents) {
      yield `**${agent.name}** is preparing a proposal...\n\n`;

      const messages = buildCouncilAnalysisMessages(agent, task, projectContext);
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
        (h) => h.phase === "analysis" || (h.phase === "critique" && h.round < round),
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
      for await (const chunk of agents[0].llm.streamChat(planMessages, abortSignal)) {
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

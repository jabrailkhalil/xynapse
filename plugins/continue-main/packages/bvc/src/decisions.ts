import type {
  DisagreementResult,
  AxisDisagreementStats,
  HistoryEntry,
} from "./types.js";

export const BVC_DECISION_AXES = [
  {
    id: "root_cause_location",
    aliases: [
      "root_cause_location",
      "root cause location",
      "root cause",
      "location",
    ],
  },
  {
    id: "fix_strategy",
    aliases: ["fix_strategy", "fix strategy", "strategy", "solution strategy"],
  },
  {
    id: "dependencies_to_update",
    aliases: [
      "dependencies_to_update",
      "dependencies to update",
      "dependencies",
      "dependency updates",
    ],
  },
  {
    id: "test_coverage",
    aliases: ["test_coverage", "test coverage", "tests", "verification"],
  },
] as const;

export type BVCDecisionAxisId = (typeof BVC_DECISION_AXES)[number]["id"];

type CanonicalVote = "bot" | "NA" | `cluster:${number}`;
export type BVCDecisionValue = string | "bot" | "NA";

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

function normalizeDecisionValue(
  value: string | undefined,
): string | "bot" | "NA" {
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

/** Conservative lexical comparison: preserve negation, identifiers and test types. */
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "is",
  "this",
  "that",
  "from",
]);
function extractKeywords(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/[\p{L}\p{N}_./-]+/gu) ?? []).filter(
      (word) => !STOP_WORDS.has(word),
    ),
  );
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
        if (char === '"') {
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
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^\uFEFF/, "")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
  const repaired = [normalized];
  const hasAllAxes = BVC_DECISION_AXES.every((axis) =>
    normalized.includes(`"${axis.id}"`),
  );
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
    if (char === '"') {
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
  if (!inString && (braces > 0 || brackets > 0)) {
    repaired.push(
      normalized +
        "]".repeat(Math.max(0, brackets)) +
        "}".repeat(Math.max(0, braces)),
    );
  }
  return repaired;
}

function parseBVCDecisionsFromJson(
  content: string,
): Map<BVCDecisionAxisId, BVCDecisionValue> | undefined {
  const candidates = extractJsonCandidates(content).flatMap((candidate) => {
    // Never rewrite valid JSON string values while attempting formatting repair.
    try {
      JSON.parse(candidate);
      return [candidate];
    } catch {
      return deterministicJsonRepairs(candidate);
    }
  });
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
    if (
      keys.length !== BVC_DECISION_AXES.length ||
      keys.some((key) => !allowedKeys.has(key as BVCDecisionAxisId))
    ) {
      continue;
    }

    const decisions = createEmptyBVCDecisions();
    for (const axis of BVC_DECISION_AXES) {
      const value = decisionsObject[axis.id];
      decisions.set(
        axis.id,
        typeof value === "string" ? normalizeDecisionValue(value) : "bot",
      );
    }
    return decisions;
  }

  return undefined;
}

function extractKeyDecisionBlock(content: string): string {
  const match = content.match(
    /##\s*Key Decisions\s*\n([\s\S]*?)(?=\n##|\n---|$)/i,
  );
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
  return /^\s*(?:[-*]|\d+[.)])\s*(?:\*\*)?[^:\n]{2,80}(?:\*\*)?\s*[:\-–—]/.test(
    line,
  );
}

export function extractBVCDecisions(
  content: string,
): Map<BVCDecisionAxisId, BVCDecisionValue> {
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

export function countValidBVCDecisions(content: string): number {
  return [...extractBVCDecisions(content).values()].filter(
    (value) => value !== "bot",
  ).length;
}

function normalizeForAxis(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'(){}\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decisionGuards(value: string): string {
  const paths =
    value.match(
      /(?:[a-z]:[\\/])?(?:[\w@.-]+[\\/])*[\w@.-]+\.[a-zA-Z][\w]*\b/g,
    ) ?? [];
  const negations =
    value
      .toLowerCase()
      .match(
        /(?<![\p{L}\p{N}_])(?:not|no|never|without|avoid|disable|remove|don't|cannot|can't|не|без)(?![\p{L}\p{N}_])/gu,
      ) ?? [];
  return JSON.stringify([
    Array.from(new Set(paths)).sort(),
    Array.from(new Set(negations)).sort(),
  ]);
}

function axisSimilarity(
  _axis: BVCDecisionAxisId,
  left: string,
  right: string,
): number {
  if (decisionGuards(left) !== decisionGuards(right)) return 0;
  const a = normalizeForAxis(left);
  const b = normalizeForAxis(right);
  return a === b
    ? 1
    : jaccardSimilarity(extractKeywords(a), extractKeywords(b));
}

function axisClusterThreshold(axis: BVCDecisionAxisId): number {
  if (axis === "root_cause_location" || axis === "dependencies_to_update") {
    return 0.55;
  }
  return 0.85;
}

function canonicalizeAxisVotes(
  axis: BVCDecisionAxisId,
  values: BVCDecisionValue[],
): CanonicalVote[] {
  const clusters: string[][] = [];
  const assignments = new Map<string, CanonicalVote>();
  const sorted = Array.from(
    new Set(values.filter((value) => value !== "bot" && value !== "NA")),
  ).sort();
  for (const value of sorted) {
    // Complete-link clustering prevents A≈B≈C from collapsing A≠C.
    let index = clusters.findIndex((cluster) =>
      cluster.every(
        (member) =>
          axisSimilarity(axis, value, member) >= axisClusterThreshold(axis),
      ),
    );
    if (index < 0) {
      index = clusters.length;
      clusters.push([]);
    }
    clusters[index].push(value);
    assignments.set(value, `cluster:${index + 1}`);
  }
  return values.map((value) =>
    value === "bot" || value === "NA" ? value : assignments.get(value)!,
  );
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
export function computeDisagreement(
  responses: HistoryEntry[],
  totalAgents = responses.length,
): DisagreementResult {
  const R = Math.max(totalAgents, responses.length, 1);
  const decisionsByAgent = responses.map((response) =>
    extractBVCDecisions(response.content),
  );
  const T_ge2: BVCDecisionAxisId[] = [];
  const axisStats: AxisDisagreementStats[] = [];
  let totalValidVotes = 0;
  let voteDivergenceSum = 0;

  for (const axis of BVC_DECISION_AXES) {
    const rawValues = decisionsByAgent.map(
      (decisions) => decisions.get(axis.id) ?? "bot",
    );
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

  const D_vote =
    T_ge2.length > 0 ? voteDivergenceSum / T_ge2.length : undefined;
  const D_cov = 1 - totalValidVotes / (BVC_DECISION_AXES.length * R);

  return { D_vote, D_cov, T_ge2, axisStats };
}

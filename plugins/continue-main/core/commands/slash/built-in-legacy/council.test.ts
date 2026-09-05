/**
 * Isolated tests for the precise BVC Disagreement metric.
 * Run from this directory: npx --no-install tsx council.test.ts
 */

type BVCDecisionAxisId =
  | "root_cause_location"
  | "fix_strategy"
  | "dependencies_to_update"
  | "test_coverage";

type BVCDecisionValue = string | "bot" | "NA";
type CanonicalVote = "bot" | "NA" | `cluster:${number}`;

interface HistoryEntry {
  agent: string;
  content: string;
  phase: "analysis" | "critique" | "plan";
  round: number;
}

interface AxisDisagreementStats {
  axis: BVCDecisionAxisId;
  m: number;
  d_vote?: number;
  d_cov: number;
  voteCounts: Record<string, number>;
}

interface DisagreementResult {
  D_vote: number | undefined;
  D_cov: number;
  T_ge2: BVCDecisionAxisId[];
  axisStats: AxisDisagreementStats[];
}

const BVC_DECISION_AXES = [
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

const BOT_MARKERS = new Set([
  "",
  "bot",
  "[parse_failure]",
  "parse_failure",
  "[error]",
  "error",
]);
const MAX_DECISION_VALUE_LENGTH = 240;

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "of",
  "to",
  "in",
  "on",
  "with",
  "use",
  "using",
]);

function normalizeDecisionValue(value: string | undefined): BVCDecisionValue {
  const trimmed = (value ?? "").trim();
  const lower = trimmed.toLowerCase();
  if (BOT_MARKERS.has(lower)) return "bot";
  if (lower === "na" || lower === "n/a" || lower === "not applicable")
    return "NA";
  if (trimmed.length > MAX_DECISION_VALUE_LENGTH) return "bot";
  return trimmed;
}

function createEmptyBVCDecisions(): Map<BVCDecisionAxisId, BVCDecisionValue> {
  const decisions = new Map<BVCDecisionAxisId, BVCDecisionValue>();
  for (const axis of BVC_DECISION_AXES) {
    decisions.set(axis.id, "bot");
  }
  return decisions;
}

function extractKeywords(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9_\s./-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word)),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizeForAxis(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'(){}\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function axisSimilarity(left: string, right: string): number {
  const a = normalizeForAxis(left);
  const b = normalizeForAxis(right);
  if (a === b) return 1;
  return jaccardSimilarity(extractKeywords(a), extractKeywords(b));
}

function axisClusterThreshold(axis: BVCDecisionAxisId): number {
  if (axis === "root_cause_location" || axis === "dependencies_to_update")
    return 0.55;
  return 0.85;
}

function canonicalizeAxisVotes(
  axis: BVCDecisionAxisId,
  values: BVCDecisionValue[],
): CanonicalVote[] {
  const clusters: Array<{ representative: string }> = [];
  const threshold = axisClusterThreshold(axis);

  return values.map((value) => {
    if (value === "bot") return "bot";
    if (value === "NA") return "NA";

    const normalized = normalizeForAxis(value);
    for (let i = 0; i < clusters.length; i++) {
      if (axisSimilarity(normalized, clusters[i].representative) >= threshold) {
        return `cluster:${i + 1}` as const;
      }
    }
    clusters.push({ representative: normalized });
    return `cluster:${clusters.length}` as const;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBVCDecisionsFromJson(
  content: string,
): Map<BVCDecisionAxisId, BVCDecisionValue> | undefined {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!match) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return undefined;
  }

  if (
    !isRecord(parsed) ||
    Object.keys(parsed).length !== 1 ||
    !isRecord(parsed.bvc_decisions)
  ) {
    return undefined;
  }

  const decisionsObject = parsed.bvc_decisions;
  const expectedKeys = BVC_DECISION_AXES.map((axis) => axis.id);
  const actualKeys = Object.keys(decisionsObject);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => !expectedKeys.includes(key as BVCDecisionAxisId))
  ) {
    return undefined;
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

function getAxisFromLine(line: string): BVCDecisionAxisId | undefined {
  for (const axis of BVC_DECISION_AXES) {
    for (const alias of axis.aliases) {
      const pattern = new RegExp(
        `^\\s*(?:[-*]|\\d+[.)])?\\s*(?:\\*\\*)?\\s*${alias}\\s*(?:\\*\\*)?\\s*[:\\-–—]\\s*(.*)$`,
        "i",
      );
      if (pattern.test(line)) return axis.id;
    }
  }
  return undefined;
}

function getAxisValueFromLine(line: string, axisId: BVCDecisionAxisId): string {
  const axis = BVC_DECISION_AXES.find((entry) => entry.id === axisId)!;
  for (const alias of axis.aliases) {
    const pattern = new RegExp(
      `^\\s*(?:[-*]|\\d+[.)])?\\s*(?:\\*\\*)?\\s*${alias}\\s*(?:\\*\\*)?\\s*[:\\-–—]\\s*(.*)$`,
      "i",
    );
    const match = line.match(pattern);
    if (match) return match[1].trim();
  }
  return "";
}

function looksLikeExtraDecisionLine(line: string): boolean {
  return /^\s*(?:[-*]|\d+[.)])\s*(?:\*\*)?[^:\n]{2,80}(?:\*\*)?\s*[:\-–—]/.test(
    line,
  );
}

function extractBVCDecisions(
  content: string,
): Map<BVCDecisionAxisId, BVCDecisionValue> {
  const jsonDecisions = parseBVCDecisionsFromJson(content);
  if (jsonDecisions) return jsonDecisions;

  const decisions = createEmptyBVCDecisions();
  const duplicateAxes = new Set<BVCDecisionAxisId>();
  const seenAxes = new Set<BVCDecisionAxisId>();
  let hasExtraField = false;
  const block =
    content.match(/##\s*Key Decisions\s*\n([\s\S]*?)(?=\n##|\n---|$)/i)?.[1] ??
    "";

  let currentAxis: BVCDecisionAxisId | undefined;
  let currentValue = "";
  const flush = () => {
    if (!currentAxis) return;
    decisions.set(
      currentAxis,
      duplicateAxes.has(currentAxis)
        ? "bot"
        : normalizeDecisionValue(currentValue),
    );
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
    } else if (currentAxis && line.trim()) {
      currentValue += ` ${line.trim()}`;
    }
  }
  flush();

  return hasExtraField ? createEmptyBVCDecisions() : decisions;
}

function computeDisagreement(
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
      if (vote === "bot") continue;
      voteCounts[vote] = (voteCounts[vote] ?? 0) + 1;
    }

    const m = Object.values(voteCounts).reduce((sum, count) => sum + count, 0);
    totalValidVotes += m;
    const d_cov = 1 - m / R;
    let d_vote: number | undefined;
    if (m >= 2) {
      d_vote = (m - Math.max(...Object.values(voteCounts))) / (m - 1);
      voteDivergenceSum += d_vote;
      T_ge2.push(axis.id);
    }
    axisStats.push({ axis: axis.id, m, d_vote, d_cov, voteCounts });
  }

  return {
    D_vote: T_ge2.length > 0 ? voteDivergenceSum / T_ge2.length : undefined,
    D_cov: 1 - totalValidVotes / (BVC_DECISION_AXES.length * R),
    T_ge2,
    axisStats,
  };
}

function canCritique(
  disagreement: DisagreementResult,
  options: {
    tauCov: number;
    tauVote: number;
    k: number;
    kMax: number;
    b: number;
    reviewers: number;
    bRes: number;
    budget: number;
  },
): boolean {
  const { tauCov, tauVote, k, kMax, b, reviewers, bRes, budget } = options;
  return (
    disagreement.T_ge2.length > 0 &&
    disagreement.D_vote !== undefined &&
    disagreement.D_cov <= tauCov &&
    disagreement.D_vote > tauVote &&
    k < kMax &&
    b + reviewers + bRes <= budget
  );
}

function entry(
  agent: string,
  decisions: Partial<Record<BVCDecisionAxisId, string>>,
): HistoryEntry {
  const body = BVC_DECISION_AXES.map(
    (axis) => `- ${axis.id}: ${decisions[axis.id] ?? "[PARSE_FAILURE]"}`,
  ).join("\n");
  return {
    agent,
    content: `## Key Decisions\n${body}`,
    phase: "analysis",
    round: 0,
  };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`PASS ${message}`);
    passed++;
  } else {
    console.log(`FAIL ${message}`);
    failed++;
  }
}

function assertEq(actual: unknown, expected: unknown, message: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function assertClose(actual: number, expected: number, message: string) {
  assert(
    Math.abs(actual - expected) < 1e-9,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

function stat(
  result: DisagreementResult,
  axis: BVCDecisionAxisId,
): AxisDisagreementStats {
  const found = result.axisStats.find((item) => item.axis === axis);
  if (!found) throw new Error(`Missing stat for ${axis}`);
  return found;
}

test("BVC disagreement metric handles agreement, missing votes, clustering and malformed input", () => {
  console.log("BVC Disagreement tests");

  const allSame = computeDisagreement(
    ["A", "B", "C", "D"].map((agentName) =>
      entry(agentName, {
        root_cause_location: "src/app.ts",
        fix_strategy: "change parser",
        dependencies_to_update: "NA",
        test_coverage: "unit tests",
      }),
    ),
    4,
  );
  assertEq(allSame.T_ge2.length, 4, "all fixed axes enter T_ge2");
  assertClose(allSame.D_vote!, 0, "all same votes give D_vote=0");
  assertClose(allSame.D_cov, 0, "full coverage gives D_cov=0");

  const allBot = computeDisagreement([], 4);
  assertEq(allBot.T_ge2.length, 0, "all bot gives empty T_ge2");
  assertEq(allBot.D_vote, undefined, "all bot gives D_vote=undefined");
  assertClose(allBot.D_cov, 1, "all bot gives D_cov=1");

  const oneVotePerAxis = computeDisagreement(
    [
      entry("A", { root_cause_location: "A" }),
      entry("B", { fix_strategy: "B" }),
      entry("C", { dependencies_to_update: "C" }),
      entry("D", { test_coverage: "D" }),
    ],
    4,
  );
  assertEq(oneVotePerAxis.T_ge2.length, 0, "m_t=1 axes do not enter T_ge2");
  assertEq(
    oneVotePerAxis.D_vote,
    undefined,
    "empty T_ge2 keeps D_vote undefined",
  );
  assertClose(
    oneVotePerAxis.D_cov,
    0.75,
    "one valid vote per axis gives D_cov=0.75",
  );
  assert(
    !canCritique(oneVotePerAxis, {
      tauCov: 0.85,
      tauVote: 0.3,
      k: 0,
      kMax: 2,
      b: 4,
      reviewers: 4,
      bRes: 1,
      budget: 9,
    }),
    "empty T_ge2 disables critique",
  );

  const twoSame = computeDisagreement(
    [
      entry("A", { root_cause_location: "A" }),
      entry("B", { root_cause_location: "A" }),
    ],
    4,
  );
  assertClose(
    stat(twoSame, "root_cause_location").d_vote!,
    0,
    "m=2 same gives d_vote=0",
  );
  assertClose(
    stat(twoSame, "root_cause_location").d_cov,
    0.5,
    "m=2 with R=4 gives d_cov=0.5",
  );

  const twoDifferent = computeDisagreement(
    [
      entry("A", { root_cause_location: "A" }),
      entry("B", { root_cause_location: "B" }),
    ],
    4,
  );
  assertClose(
    stat(twoDifferent, "root_cause_location").d_vote!,
    1,
    "m=2 different gives d_vote=1",
  );

  const naAgreement = computeDisagreement(
    [
      entry("A", { dependencies_to_update: "NA" }),
      entry("B", { dependencies_to_update: "NA" }),
    ],
    4,
  );
  assertClose(
    stat(naAgreement, "dependencies_to_update").d_vote!,
    0,
    "NA agreement counts as valid agreement",
  );
  assertEq(
    stat(naAgreement, "dependencies_to_update").m,
    2,
    "NA contributes to m_t",
  );

  const naVsValue = computeDisagreement(
    [
      entry("A", { dependencies_to_update: "NA" }),
      entry("B", { dependencies_to_update: "package.json" }),
    ],
    4,
  );
  assertClose(
    stat(naVsValue, "dependencies_to_update").d_vote!,
    1,
    "NA vs concrete value disagrees",
  );

  const botExcluded = computeDisagreement(
    [
      entry("A", { test_coverage: "unit tests" }),
      entry("B", { test_coverage: "unit tests" }),
      entry("C", { test_coverage: "[PARSE_FAILURE]" }),
      entry("D", { test_coverage: "[PARSE_FAILURE]" }),
    ],
    4,
  );
  assertEq(
    stat(botExcluded, "test_coverage").m,
    2,
    "bot votes are excluded from m_t",
  );
  assertClose(
    stat(botExcluded, "test_coverage").d_vote!,
    0,
    "bot votes do not create disagreement",
  );

  const mixed = computeDisagreement(
    [
      entry("A", {
        fix_strategy: "A",
        dependencies_to_update: "A",
        test_coverage: "A",
      }),
      entry("B", {
        dependencies_to_update: "A",
        test_coverage: "B",
      }),
      entry("C", {
        test_coverage: "B",
      }),
    ],
    4,
  );
  assertEq(
    mixed.T_ge2,
    ["dependencies_to_update", "test_coverage"],
    "mixed fixture T_ge2",
  );
  assertClose(mixed.D_vote!, 0.25, "mixed fixture D_vote=(0+0.5)/2");
  assertClose(mixed.D_cov, 0.625, "mixed fixture D_cov=(1+0.75+0.5+0.25)/4");

  const duplicateMarkdown = computeDisagreement(
    [
      {
        agent: "A",
        content:
          "## Key Decisions\n- root_cause_location: A\n- root_cause_location: B\n- fix_strategy: A\n- dependencies_to_update: A\n- test_coverage: A",
        phase: "analysis",
        round: 0,
      },
    ],
    1,
  );
  assertEq(
    stat(duplicateMarkdown, "root_cause_location").m,
    0,
    "duplicate markdown axis becomes bot",
  );

  const jsonExtraField = computeDisagreement(
    [
      {
        agent: "A",
        content:
          '```json\n{"bvc_decisions":{"root_cause_location":"A","fix_strategy":"A","dependencies_to_update":"A","test_coverage":"A","extra":"no"}}\n```',
        phase: "analysis",
        round: 0,
      },
    ],
    1,
  );
  assertEq(
    jsonExtraField.T_ge2.length,
    0,
    "strict JSON with extra field is rejected",
  );
  assertClose(jsonExtraField.D_cov, 1, "rejected JSON becomes bot on all axes");

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`${failed} BVC metric assertions failed`);
  }
  expect(passed).toBeGreaterThanOrEqual(17);
});

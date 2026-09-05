import {
  BVC_DECISION_AXES,
  computeDisagreement,
} from "../../../../packages/bvc/src/decisions.js";
import type { BVCDecisionAxisId } from "../../../../packages/bvc/src/decisions.js";
import type {
  AxisDisagreementStats,
  DisagreementResult,
  HistoryEntry,
} from "../../../../packages/bvc/src/types.js";

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

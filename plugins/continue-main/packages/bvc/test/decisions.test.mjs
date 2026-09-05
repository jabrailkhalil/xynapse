import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeDisagreement,
  extractBVCDecisions,
  isValidPlanContent,
} from "../dist/index.js";

const decisions = (overrides = {}) => ({
  root_cause_location: "src/parser.ts",
  fix_strategy: "preserve empty values",
  dependencies_to_update: "NA",
  test_coverage: "unit tests",
  ...overrides,
});
const report = (values) => ({
  agent: "role",
  phase: "analysis",
  round: 0,
  content: JSON.stringify({ bvc_decisions: values }),
});
const axis = (left, right, name) =>
  computeDisagreement([
    report(decisions({ [name]: left })),
    report(decisions({ [name]: right })),
  ]).axisStats.find((entry) => entry.axis === name).d_vote;

test("missing output affects coverage, not substantive disagreement", () => {
  const result = computeDisagreement([report(decisions())], 4);
  assert.equal(result.D_vote, undefined);
  assert.equal(result.D_cov, 0.75);
  assert.deepEqual(result.T_ge2, []);
});

test("valid JSON preserves curly quotes and punctuation inside decisions", () => {
  const strategy = "preserve “empty” inputs and literal ,} tokens";
  const values = extractBVCDecisions(
    report(decisions({ fix_strategy: strategy })).content,
  );
  assert.equal(values.get("fix_strategy"), strategy);
  assert.equal(
    [...values.values()].filter((value) => value !== "bot").length,
    4,
  );
});

test("agreement and NA preserve the published metric", () => {
  const result = computeDisagreement(
    [report(decisions()), report(decisions())],
    2,
  );
  assert.equal(result.D_vote, 0);
  assert.equal(result.D_cov, 0);
  assert.equal(axis("NA", "package.json", "dependencies_to_update"), 1);
});

test("negation cannot disappear during vote clustering", () => {
  assert.equal(
    axis(
      "add validation before parsing",
      "do not add validation before parsing",
      "fix_strategy",
    ),
    1,
  );
});

test("different source files remain different root-cause hypotheses", () => {
  assert.equal(
    axis(
      "validation failure in the shared parser src/first.ts",
      "validation failure in the shared parser src/second.ts",
      "root_cause_location",
    ),
    1,
  );
});

test("unit and end-to-end coverage are not synonymous", () => {
  assert.equal(
    axis(
      "add unit tests for parsing",
      "add e2e tests for parsing",
      "test_coverage",
    ),
    1,
  );
});

test("cluster sizes do not depend on role order", () => {
  const variants = [
    "alpha beta gamma delta",
    "alpha beta gamma epsilon",
    "alpha beta epsilon zeta",
  ];
  const counts = [];
  for (const indices of [
    [0, 1, 2],
    [1, 0, 2],
    [2, 1, 0],
  ]) {
    const result = computeDisagreement(
      indices.map((i) =>
        report(decisions({ root_cause_location: variants[i] })),
      ),
    );
    counts.push(result.D_vote);
  }
  assert.equal(new Set(counts).size, 1);
});

test("unterminated decision text is not fabricated by JSON repair", () => {
  const content = JSON.stringify({ bvc_decisions: decisions() }).slice(0, -4);
  assert.equal(
    [...extractBVCDecisions(content).values()].filter(
      (value) => value !== "bot",
    ).length,
    0,
  );
});

test("non-string values and extra fields fail the fixed schema", () => {
  const parsed = extractBVCDecisions(
    JSON.stringify({
      bvc_decisions: decisions({ test_coverage: ["unit tests"] }),
    }),
  );
  assert.equal(parsed.get("test_coverage"), "bot");
  const extra = extractBVCDecisions(
    JSON.stringify({
      bvc_decisions: { ...decisions(), extra: "unrecognized" },
    }),
  );
  assert.equal(
    [...extra.values()].every((value) => value === "bot"),
    true,
  );
});

test("empty heading shells are not a valid plan", () => {
  assert.equal(
    isValidPlanContent(
      "# Project Plan\n## Description\n## Disputed Decisions\n## File Structure\n## File Descriptions\n## Implementation Order\n## Technologies",
    ),
    false,
  );
});

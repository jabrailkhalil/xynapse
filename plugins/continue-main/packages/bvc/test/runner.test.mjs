import assert from "node:assert/strict";
import { test } from "node:test";
import { runBvc } from "../dist/index.js";

const roles = ["Architect", "Developer", "Reviewer", "Tester"].map((name) => ({
  name,
  modelId: "test-model",
}));
const plan =
  "# Project Plan\n\n## Description\nPreserve empty inputs.\n\n## Disputed Decisions\nNo unresolved objections.\n\n## File Structure\nsrc/parser.ts\n\n## File Descriptions\nParser implementation.\n\n## Implementation Order\n1. Add a regression test, fix parsing and run tests.\n\n## Technologies\nTypeScript.\n";
const decisions = (strategy = "preserve empty inputs") =>
  JSON.stringify({
    bvc_decisions: {
      root_cause_location: "src/parser.ts",
      fix_strategy: strategy,
      dependencies_to_update: "NA",
      test_coverage: "add parser unit tests",
    },
  });

async function run(overrides = {}, handler) {
  const requests = [];
  const adapter = {
    async *stream(request) {
      requests.push(request);
      if (handler) {
        yield* handler(request);
        return;
      }
      yield {
        text: request.phase === "plan" ? plan : decisions(),
        finishReason: "stop",
      };
    },
  };
  const events = [];
  for await (const event of runBvc({
    task: "Fix empty inputs",
    roles,
    adapter,
    ...overrides,
  }))
    events.push(event);
  const result = events.at(-1).result;
  assert.equal(result.callsUsed, requests.length);
  assert.ok(result.callsUsed <= result.callLimit);
  return { result, requests, events };
}

test("explicit council honors user intent and uses 4 independent drafts plus synthesis", async () => {
  const { result, requests } = await run();
  assert.equal(result.status, "planned");
  assert.equal(result.verification, "not_run");
  assert.equal(result.callsUsed, 5);
  assert.equal(result.distinctModels, 1);
  assert.equal(result.usageComplete, false);
  assert.equal(result.critiqueRounds, 0);
  for (const request of requests.filter((r) => r.phase === "analysis")) {
    assert.equal(
      request.messages.some((message) =>
        message.content.includes("peer_reports"),
      ),
      false,
    );
  }
});

test("single and fixed baselines execute different declared schedules", async () => {
  const single = await run({ options: { mode: "single" } });
  const fixed = await run({ options: { mode: "fixed" } });
  assert.equal(single.result.callsUsed, 1);
  assert.equal(fixed.result.callsUsed, 9);
  assert.equal(fixed.result.critiqueRounds, 1);
});

test("heuristic routing is opt-in, not a hidden override of /bvc", async () => {
  const { result } = await run({ options: { mode: "adaptive" } });
  assert.equal(result.callsUsed, 1);
  assert.match(result.reason, /uncalibrated/);
});

test("insufficient council budget falls back without exceeding the cap", async () => {
  const { result } = await run({ options: { maxCalls: 3 } });
  assert.equal(result.callsUsed, 1);
  assert.equal(result.route, "single");
  assert.match(result.reason, /budget/);
});

test("non-improving critique stops and keeps independent minority reports for synthesis", async () => {
  const { result, requests } = await run(
    { options: { maxCalls: 13, maxCritiqueRounds: 2, lambdaCost: 0 } },
    async function* (request) {
      const strategy =
        request.role === "Tester"
          ? "reject empty inputs"
          : "preserve empty inputs";
      // Disagree across every axis to exercise the substantive gate.
      const content = JSON.stringify({
        bvc_decisions: {
          root_cause_location: strategy,
          fix_strategy: strategy,
          dependencies_to_update: strategy,
          test_coverage: strategy,
        },
      });
      yield {
        text: request.phase === "plan" ? plan : content,
        finishReason: "stop",
      };
    },
  );
  assert.equal(result.critiqueRounds, 1);
  assert.equal(result.callsUsed, 9);
  assert.equal(result.route, "council");
  const reports = JSON.parse(requests.at(-1).messages.at(-1).content);
  assert.equal(reports.independent_reports.length, 4);
  assert.match(
    reports.independent_reports.at(-1).content,
    /reject empty inputs/,
  );
});

test("structured recovery preserves the final synthesis call", async () => {
  const { result, requests } = await run({}, async function* (request) {
    yield {
      text:
        request.phase === "plan"
          ? plan
          : request.phase === "recovery"
            ? decisions()
            : "A report without structured decisions.",
      finishReason: "stop",
    };
  });
  assert.equal(result.callsUsed, 9);
  assert.equal(
    requests.filter((request) => request.phase === "recovery").length,
    4,
  );
  assert.equal(result.status, "planned");
});

test("formatting recovery preserves raw independent and latest objections", async () => {
  const { result, requests } = await run(
    { options: { mode: "fixed", maxCalls: 17 } },
    async function* (request) {
      yield {
        text:
          request.phase === "plan"
            ? plan
            : request.phase === "recovery"
              ? decisions()
              : `${request.phase}: reject untrusted paths before file access. Missing structured fields.`,
        finishReason: "stop",
      };
    },
  );
  assert.equal(result.status, "planned");
  assert.equal(result.callsUsed, 17);
  const critique = requests.find((request) => request.phase === "critique");
  const peers = JSON.parse(critique.messages.at(-1).content);
  assert.match(
    peers.peer_reports[0].content,
    /analysis: reject untrusted paths/,
  );
  assert.equal(peers.normalized_decisions.length, 4);
  const evidence = JSON.parse(requests.at(-1).messages.at(-1).content);
  assert.match(
    evidence.independent_reports[0].content,
    /analysis: reject untrusted paths/,
  );
  assert.match(
    evidence.current_reports[0].content,
    /critique: reject untrusted paths/,
  );
  assert.match(evidence.current_decisions[0].content, /bvc_decisions/);
});

test("recovery cannot replace already valid substantive decisions", async () => {
  const { result, requests } = await run({}, async function* (request) {
    const original = JSON.parse(decisions("never execute user input"));
    original.bvc_decisions.test_coverage = "[PARSE_FAILURE]";
    yield {
      text:
        request.phase === "plan"
          ? plan
          : request.phase === "recovery"
            ? decisions("execute user input directly")
            : JSON.stringify(original),
      finishReason: "stop",
    };
  });
  assert.equal(result.status, "planned");
  const evidence = JSON.parse(requests.at(-1).messages.at(-1).content);
  const normalized = JSON.parse(evidence.current_decisions[0].content);
  assert.equal(
    normalized.bvc_decisions.fix_strategy,
    "never execute user input",
  );
  assert.equal(normalized.bvc_decisions.test_coverage, "add parser unit tests");
});

test("single-agent fallback retains unverified objections from completed reports", async () => {
  const { result, requests } = await run(
    { options: { maxCalls: 5 } },
    async function* (request) {
      yield {
        text:
          request.phase === "plan"
            ? plan
            : "Reject untrusted paths before access. No structured decisions.",
        finishReason: "stop",
      };
    },
  );
  assert.equal(result.route, "single");
  const synthesis = requests.at(-1);
  assert.match(synthesis.messages[0].content, /unverified/);
  assert.match(synthesis.messages[0].content, /Do not claim council consensus/);
  const evidence = JSON.parse(synthesis.messages.at(-1).content);
  assert.match(
    evidence.independent_reports[0].content,
    /Reject untrusted paths/,
  );
});

test("unchanged 16k role reports are deduplicated before synthesis", async () => {
  const report = "Evidence ".repeat(1800) + "\n" + decisions();
  const { result, requests } = await run({}, async function* (request) {
    yield {
      text: request.phase === "plan" ? plan : report,
      finishReason: "stop",
    };
  });
  assert.equal(result.status, "planned");
  assert.equal(result.callsUsed, 5);
  const synthesis = requests.at(-1);
  assert.ok(
    synthesis.messages.reduce(
      (sum, message) => sum + message.content.length,
      0,
    ) <= 120_000,
  );
  const evidence = JSON.parse(synthesis.messages.at(-1).content);
  assert.equal(evidence.current_reports_reference, "independent_reports");
  assert.equal(evidence.current_reports, undefined);
  assert.equal(evidence.independent_reports[0].content, report);
  assert.equal(result.calls.at(-1).omittedEvidenceChars, 0);
});

test("long critique and synthesis excerpt evidence within the exact prompt limit", async () => {
  const maxPromptChars = 15_000;
  const context = "Preserve this selected user context exactly. ".repeat(20);
  const originalReports = new Map();
  const { result, requests } = await run(
    { context, options: { mode: "fixed", maxPromptChars } },
    async function* (request) {
      const report =
        `START ${request.role} ${request.phase}\n` +
        'Details: \\path "quoted"\n'.repeat(1200) +
        `\nEND ${request.role} ${request.phase}\n` +
        decisions();
      if (request.phase !== "plan")
        originalReports.set(`${request.role}:${request.phase}`, report);
      yield {
        text: request.phase === "plan" ? plan : report,
        finishReason: "stop",
      };
    },
  );
  assert.equal(result.status, "planned");
  assert.equal(result.callsUsed, 9);
  for (let index = 0; index < requests.length; index++) {
    const request = requests[index];
    const call = result.calls[index];
    const inputChars = request.messages.reduce(
      (sum, message) => sum + message.content.length,
      0,
    );
    assert.ok(inputChars <= maxPromptChars);
    assert.equal(call.inputChars, inputChars);
    assert.equal(
      JSON.parse(request.messages[1].content).repository_context,
      context,
    );
    if (request.phase === "analysis") {
      assert.equal(call.omittedEvidenceChars, 0);
      continue;
    }
    assert.ok(call.omittedEvidenceChars > 0);
    const evidence = JSON.parse(request.messages.at(-1).content);
    assert.equal(evidence.omitted_evidence_chars, call.omittedEvidenceChars);
    const reports =
      request.phase === "critique"
        ? evidence.peer_reports
        : [...evidence.independent_reports, ...evidence.current_reports];
    let omitted = 0;
    for (const report of reports) {
      assert.ok(
        report.content.startsWith(`START ${report.agent} ${report.phase}`),
      );
      assert.ok(report.content.includes(`END ${report.agent} ${report.phase}`));
      const marker = report.content.match(
        /BVC evidence omitted: (\d+) characters/,
      );
      assert.ok(marker);
      omitted += Number(marker[1]);
    }
    assert.equal(omitted, call.omittedEvidenceChars);
    const normalized =
      request.phase === "critique"
        ? evidence.normalized_decisions
        : evidence.current_decisions;
    assert.equal(normalized.length, 4);
    for (const entry of normalized)
      assert.deepEqual(JSON.parse(entry.content), JSON.parse(decisions()));
  }
  for (const report of result.history)
    assert.equal(
      report.content,
      originalReports.get(`${report.agent}:${report.phase}`),
    );
});

test("malformed outputs cannot spend the synthesis reserve", async () => {
  const { result, requests } = await run(
    { options: { maxCalls: 5 } },
    async function* (request) {
      yield {
        text: request.phase === "plan" ? plan : "Invalid report",
        finishReason: "stop",
      };
    },
  );
  assert.equal(
    requests.some((request) => request.phase === "recovery"),
    false,
  );
  assert.equal(result.callsUsed, 5);
  assert.equal(result.route, "single");
});

test("known truncated role output is never repaired into a vote", async () => {
  const { result, requests } = await run({}, async function* (request) {
    yield {
      text: request.phase === "plan" ? plan : decisions(),
      finishReason: request.phase === "plan" ? "stop" : "length",
    };
  });
  assert.equal(result.disagreement.D_cov, 1);
  assert.equal(result.disagreement.D_vote, undefined);
  assert.equal(
    requests.some((request) => request.phase === "recovery"),
    false,
  );
  assert.equal(result.route, "single");
});

test("a valid-looking partial plan followed by a transport error cannot be accepted", async () => {
  const { result } = await run(
    { options: { mode: "single" } },
    async function* () {
      yield { text: plan };
      throw new Error("Transport failed after a partial answer");
    },
  );
  assert.equal(result.status, "failed");
  assert.equal(result.plan, undefined);
  assert.match(result.reason, /error/);
});

for (const finishReason of ["length", "refusal"]) {
  test(`${finishReason} cannot be hidden by a later stop marker`, async () => {
    const { result } = await run(
      { options: { mode: "single" } },
      async function* () {
        yield { text: plan, finishReason };
        yield { finishReason: "stop" };
      },
    );
    assert.equal(result.status, "failed");
    assert.equal(result.plan, undefined);
  });
}

test("unknown provider completion metadata is exposed honestly", async () => {
  const { result } = await run(
    { options: { mode: "single" } },
    async function* () {
      yield { text: plan };
    },
  );
  assert.equal(result.status, "planned");
  assert.equal(result.calls[0].completionConfirmed, false);
  assert.equal(result.calls[0].finishReason, "unknown");
});

test("reported cumulative usage is counted once per request", async () => {
  const { result } = await run(
    { options: { mode: "single" } },
    async function* () {
      yield { text: plan, usage: { inputTokens: 10, outputTokens: 3 } };
      yield {
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 8 },
      };
    },
  );
  assert.equal(result.usageComplete, true);
  assert.deepEqual(result.reportedUsage, { inputTokens: 10, outputTokens: 8 });
});

test("a pre-cancelled run performs zero requests", async () => {
  const controller = new AbortController();
  controller.abort();
  const { result } = await run({ signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.equal(result.callsUsed, 0);
});

test("cancellation during output prevents every later role and synthesis", async () => {
  const controller = new AbortController();
  let requests = 0;
  const events = [];
  const adapter = {
    async *stream() {
      requests++;
      yield { text: decisions() };
    },
  };
  for await (const event of runBvc({
    task: "Fix parser",
    roles,
    adapter,
    signal: controller.signal,
  })) {
    events.push(event);
    if (event.type === "text") controller.abort();
  }
  assert.equal(events.at(-1).result.status, "cancelled");
  assert.equal(requests, 1);
});

test("a provider ignoring AbortSignal cannot hang the caller indefinitely", async () => {
  const adapter = {
    stream() {
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return new Promise(() => {});
            },
          };
        },
      };
    },
  };
  const events = [];
  for await (const event of runBvc({
    task: "Fix parser",
    roles,
    adapter,
    options: { mode: "single", callTimeoutMs: 10 },
  }))
    events.push(event);
  const result = events.at(-1).result;
  assert.equal(result.status, "failed");
  assert.equal(result.calls[0].status, "timeout");
});

test("timeout during event processing cannot accept an immediately completed iterator", async () => {
  let result;
  for await (const event of runBvc({
    task: "Fix parser",
    roles,
    options: { mode: "single", callTimeoutMs: 10 },
    adapter: {
      async *stream() {
        yield { text: plan, finishReason: "stop" };
      },
    },
  })) {
    if (event.type === "text")
      await new Promise((resolve) => setTimeout(resolve, 40));
    if (event.type === "complete") result = event.result;
  }
  assert.equal(result.status, "failed");
  assert.equal(result.calls[0].status, "timeout");
  assert.equal(result.plan, undefined);
});

test("oversized input is rejected before sending it to a model", async () => {
  const { result } = await run({
    context: "x".repeat(2000),
    options: { mode: "single", maxPromptChars: 1000 },
  });
  assert.equal(result.callsUsed, 0);
  assert.equal(result.status, "failed");
  assert.equal(result.calls[0].attempted, false);
});

test("oversized output cannot become a plan", async () => {
  const { result } = await run(
    { options: { mode: "single", maxResponseChars: 1000 } },
    async function* () {
      yield { text: plan + "x".repeat(1000), finishReason: "stop" };
    },
  );
  assert.equal(result.status, "failed");
  assert.equal(result.calls[0].status, "truncated");
});

for (const options of [
  { maxCalls: NaN },
  { maxCalls: Infinity },
  { maxCalls: -1 },
  { maxCalls: 1.5 },
  { tauVote: 0.8, tauCrit: 0.2 },
  { maxRecoveryAttempts: 100 },
  { mode: "invalid" },
]) {
  test(`invalid options fail before a request: ${JSON.stringify(options)}`, async () => {
    await assert.rejects(() => run({ options }), RangeError);
  });
}

test("duplicate role names are rejected rather than recovering with the wrong model", async () => {
  await assert.rejects(() => run({ roles: [roles[0], roles[0]] }), /unique/);
});

test("explicit synthesis model reaches the provider unchanged", async () => {
  const { requests } = await run({ synthesisModelId: "my-selected-model" });
  assert.equal(requests.at(-1).modelId, "my-selected-model");
});

test("production synthesis policy rejects unknown terminal metadata", async () => {
  const { result } = await run(
    { options: { mode: "single", requireConfirmedSynthesis: true } },
    async function* () {
      yield { text: plan };
    },
  );
  assert.equal(result.status, "failed");
  assert.equal(result.plan, undefined);
  assert.match(result.reason, /unconfirmed provider completion/);
});

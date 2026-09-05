import { runBvc } from "../dist/index.js";

const decisions = JSON.stringify({
  bvc_decisions: {
    root_cause_location: "src/parser.ts parseHeader",
    fix_strategy: "Preserve the delimiter while parsing quoted headers",
    dependencies_to_update: "NA",
    test_coverage: "Add a focused parser regression test",
  },
});

const plan = `# Project Plan

## Description
Correct quoted-header parsing without changing unrelated syntax.

## Disputed Decisions
No unresolved decisions. Agreement is still not test verification.

## File Structure
src/parser.ts and test/parser.test.ts

## File Descriptions
src/parser.ts contains the parser. test/parser.test.ts covers the regression.

## Implementation Order
1. Add a failing regression test. 2. Preserve the delimiter. 3. Run parser tests.

## Technologies
TypeScript and the repository's existing test runner.
`;

const adapter = {
  async *stream(request) {
    const text = request.phase === "plan" ? plan : decisions;
    yield { text };
    yield {
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: text.length },
    };
  },
};

let finalResult;
for await (const event of runBvc({
  task: "Fix quoted-header parsing",
  context: "src/parser.ts parses protocol headers",
  roles: ["Architect", "Developer", "Reviewer", "Tester"].map((name) => ({
    name,
    modelId: `offline-${name.toLowerCase()}`,
  })),
  adapter,
  options: { mode: "council", maxCalls: 9, maxCritiqueRounds: 1 },
})) {
  if (event.type === "complete") finalResult = event.result;
}

console.log(JSON.stringify(finalResult, null, 2));

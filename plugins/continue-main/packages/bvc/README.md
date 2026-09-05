# `@xynapse/bvc`

`@xynapse/bvc` is a provider-independent orchestration core for bounded, multi-role planning in coding assistants. A host supplies model access through one streaming adapter; the package owns routing, call budgets, structured decision extraction, critique stopping, cancellation, timeout handling, synthesis validation, and the audit trace.

The core does not read files, execute tools, access credentials, call a network, or collect telemetry. It produces a plan with `verification: "not_run"`; agreement between roles is reported as a decision diagnostic, not as proof that a change works.

## Use from a workspace

```json
{
  "dependencies": {
    "@xynapse/bvc": "file:../path/to/packages/bvc"
  }
}
```

The package can also be packed with `npm pack` and installed from the resulting archive. Node.js 20 or newer is required.

## Minimal integration

```ts
import { runBvc, type BvcModelAdapter } from "@xynapse/bvc";

const adapter: BvcModelAdapter = {
  async *stream(request) {
    for await (const event of yourProvider.stream({
      model: request.modelId,
      messages: request.messages,
      maxTokens: request.maxOutputTokens,
      signal: request.signal,
    })) {
      yield {
        text: event.text,
        usage: event.usage,
        finishReason: event.finishReason,
      };
    }
  },
};

for await (const event of runBvc({
  task: "Fix the parser regression and plan focused tests",
  context: repositoryContext,
  roles: [
    { name: "Architect", modelId: "model-a" },
    { name: "Developer", modelId: "model-b" },
    { name: "Reviewer", modelId: "model-c" },
    { name: "Tester", modelId: "model-d" },
  ],
  adapter,
  options: { mode: "council", maxCalls: 9, maxCritiqueRounds: 1 },
})) {
  if (event.type === "text") process.stdout.write(event.text);
  if (event.type === "complete") console.log(event.result);
}
```

Every adapter should forward the provider's terminal reason when it is available:

- `stop` means the response completed normally.
- `length` means the output hit a token or length limit.
- `refusal` means the provider refused or filtered the response.
- `unknown` means the host cannot confirm completion.

Known partial or refused responses are excluded from decisions and cannot be saved as the final plan. Unknown metadata remains visible in `completionConfirmed` and `usageComplete` instead of being presented as verified.

Set `options.requireConfirmedSynthesis: true` for production host integrations. This rejects the final plan unless the provider explicitly confirms normal completion. Xynapse Assistant enables this policy. The SDK keeps the option off by default for compatibility with adapters that do not expose terminal metadata; those results remain unconfirmed.

## Modes

| Mode       | Behavior                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| `council`  | Runs independent roles and bounded adaptive critique. This is the default.                                      |
| `adaptive` | Uses the package's uncalibrated, deterministic preflight heuristic and may choose one model. Hosts must opt in. |
| `single`   | Runs the synthesis role once as a declared baseline.                                                            |
| `fixed`    | Runs every configured critique round when the call budget allows.                                               |

An explicit council action should normally use `mode: "council"`. This preserves user intent and makes the more aggressive single-agent gate an explicit product choice.

## Operational bounds

`maxCalls`, `maxCritiqueRounds`, `maxRecoveryAttempts`, `callTimeoutMs`, `maxPromptChars`, `maxResponseChars`, and phase-specific token limits are validated before a request. One synthesis call is reserved while analysis and structured-output recovery run. Cancellation and timeout return without waiting forever for an adapter that ignores its `AbortSignal`.

The complete result includes the selected route, reason, call limit and actual count, per-call model/role/phase/status, finish reason, elapsed time, reported usage, critique rounds, decision diagnostics, and all reports used for synthesis. This trace is designed to be saved beside the plan for reproducible comparisons.

Repeated reports are deduplicated. When peer reports exceed the prompt limit, the core retains balanced beginning/end excerpts, keeps normalized decision fields intact, and records `omittedEvidenceChars` on the call. Full reports remain in `history`. Excerpting can omit a relevant objection, so the prompts explicitly prohibit treating omitted evidence as resolved. The core never silently shortens the task or host-provided context; oversized base input is rejected before calling a model.

`distinctModels` counts distinct adapter model identifiers. If a host assigns different aliases to the same underlying model, it must describe this as configuration diversity rather than independent model diversity.

The Xynapse extension integrates the source directly in `/bvc`; external consumers use the built package entry point. With four roles, text-command difficulty budgets default to 5, 9, and 13 calls for easy, medium, and hard. Actual usage may be lower when critique is unnecessary. Provider retries hidden inside a host adapter and monetary cost are not capped by this call counter.

## Development

```sh
npm test
npm run demo
npm pack --dry-run
```

See [RESEARCH.md](./RESEARCH.md) for the evidence and limits that shaped the defaults. The package is licensed under Apache-2.0.

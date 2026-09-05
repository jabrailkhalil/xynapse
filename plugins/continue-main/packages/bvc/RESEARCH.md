# Research basis and limits

BVC is designed around a narrow claim: bounded role diversity can improve the quality of a coding plan when the task has enough uncertainty, while coordination cost and incomplete model output must remain visible. It does not treat model agreement as correctness and does not claim that a plan has been executed.

## Local evaluation that informed the implementation

The accompanying Xynapse studies evaluated 60 SWE-bench tasks with a 6-or-10-call adaptive budget. Relative to a fixed council, the adaptive policy reduced calls by 21.3%, tokens by 22.2%, and cost by 23.5% in that sample.

Task outcomes did not establish model-independent superiority. DeepSeek produced 5/60 BVC successes versus 7/60 for the single-plan baseline. Qwen produced 7/60 versus 5/60, while 60.5% of provider-successful calls ended because of output length and 58/60 BVC tasks were affected. Those truncation rates are a confounder, so the implementation now excludes known partial responses and records provider finish reasons.

Three formal repeats at temperature zero produced different totals (0, 2, and 0 successes), with 13/15 task outcomes agreeing across all repeats. Temperature zero is therefore not presented as determinism. Reproducible evaluation requires repeated runs, pinned model identifiers, provider settings, prompts, budgets, raw traces, and executable test outcomes.

## External findings reflected in the design

- _Debate or Vote_ reports that majority voting explains much of the gain attributed to multi-agent debate, while debate alone does not reliably improve correctness. BVC begins with independent reports and only spends on targeted critique when its decision diagnostics justify it. <https://arxiv.org/abs/2508.17536>
- _Towards a Science of Scaling Agent Systems_ finds diminishing returns from coordination, especially when task structure and orchestration are mismatched. BVC caps calls, reserves synthesis, and supports declared single and fixed baselines. <https://arxiv.org/abs/2512.08296>
- Anthropic's multi-agent research engineering report describes strong results on breadth-first research tasks alongside high token cost and weaker fit for tightly coupled coding work. BVC keeps the host in control of when to invoke a council and exposes cost rather than hiding it. <https://www.anthropic.com/engineering/multi-agent-research-system>
- Gemini documents explicit thinking-budget controls, supporting the broader design principle that reasoning effort should scale with task complexity. <https://ai.google.dev/gemini-api/docs/thinking>
- DeepSeek documents `finish_reason: "length"` as potentially partial output. The portable adapter therefore has a normalized terminal reason and rejects known length-limited plans. <https://api-docs.deepseek.com/api/create-chat-completion/>
- Anthropic likewise documents that `max_tokens` may leave structured output incomplete. <https://platform.claude.com/docs/en/build-with-claude/structured-outputs>
- Ollama supports schema-constrained output through `format`, which a host adapter can use in addition to BVC's bounded repair pass. <https://docs.ollama.com/capabilities/structured-outputs>

## What the metrics mean

`D_vote` measures disagreement among valid stated decisions on four fixed axes. `D_cov` measures missing or invalid coverage of those axes. They are orchestration signals. They are not calibrated probabilities, benchmark scores, or evidence that a proposed patch passes tests.

The final result always reports `verification: "not_run"`. A host that implements the plan should record its own executable tests and artifacts as a separate stage.

# Xynapse Assistant

Xynapse Assistant provides chat, editing, autocomplete, and multi-role planning for coding projects. This build includes BVC 0.1.1, a reusable planning core with bounded model calls and an auditable discussion.

## BVC planning

Attach relevant files or select code, then run:

```text
/bvc easy Fix the parser regression
/bvc medium Plan the authentication refactor
/bvc hard Compare migration approaches across the affected services
```

You can also use the BVC button to choose roles, configured models, and the planning budget.

BVC collects independent proposals, measures disagreement on four decision axes, and spends remaining calls on critique when needed. It preserves unresolved objections and produces `bvc-plan.md`. When discussion saving is enabled, `bvc-discussion.md` includes the reports and a trace of calls, outcomes, usage, and context omissions.

With four roles, the text-command defaults allow at most 5, 9, or 13 model calls. Calls can end early when no critique is needed. Timeouts, cancellation, refusals, output truncation, and an unconfirmed final completion prevent a response from being saved as the final plan.

A plan still needs implementation and executable tests. BVC records this as `verification: "not_run"`. It does not assign a correctness score from model agreement.

## Native runtime updates in 1.0.1

The native coding runner preserves reasoning fields from DeepSeek, Qwen-compatible endpoints and Ollama. DeepSeek V4 receives its reasoning history again after tool execution, including when routed through a Yandex Cloud model URI. Reasoning remains hidden in terminal output and human-readable conversation exports.

Runtime settings accept object-style command hooks with tool matchers alongside legacy command strings. Malformed supported hooks still fail validation. Unknown configuration keys produce warnings. The Linux sandbox source includes the upstream launcher probe and user-mapping fallback; Linux execution is not qualified by this Windows build.

The selected changes come from the independent [Claw Code project](https://github.com/ultraworkers/claw-code). BVC remains at 0.1.1.

## Supported hosts

This preview targets Windows x64 desktop hosts with VS Code API 1.108 or newer. Xynapse and Microsoft VS Code are the validation targets. Other VS Code-derived editors require individual qualification. The archive is not a JetBrains plugin or a browser extension. Remote workspaces and other operating systems are not yet qualified.

The BVC package is independent of these host restrictions and can be integrated through a model adapter. No model-independent superiority over single-model planning is claimed.

## Installation

The Windows preview is distributed as a VSIX. In the editor's Extensions view, choose **Install from VSIX**, select the archive, then reload the window. Configure your model provider and credentials in the assistant settings before sending a task.

API keys must stay in local configuration or local secret references. Error diagnostics omit request bodies, credentials, and raw provider errors. The native runner uses the active resolved model configuration.

The extension is free and open source. Model-provider charges depend on the provider you configure; the BVC call counter does not cap provider retries or monetary cost.

## Integrate the core in another project

The `@xynapse/bvc` package has no runtime dependencies on this extension, VS Code, Continue, or a model SDK. A host supplies a small streaming adapter and retains control over credentials, model choice, tools, and saving files.

Open `README.md` in the `@xynapse/bvc` package archive for the adapter contract and integration example. The archive also contains research notes, TypeScript declarations, and an offline demo.

## Source and attribution

Developed as part of [Xynapse](https://github.com/jabrailkhalil/xynapse) by Dzhabrail Khalilov.

Xynapse Assistant is based on [Continue](https://github.com/continuedev/continue). The upstream copyright and license notices are retained. Distributed under [Apache-2.0](./LICENSE.txt).

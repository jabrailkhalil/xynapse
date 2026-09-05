# Xynapse Assistant

Xynapse Assistant provides chat, editing, autocomplete, and multi-role planning for coding projects. This build includes BVC 0.1.0, a reusable planning core with bounded model calls and an auditable discussion.

## BVC planning

Attach relevant files or select code, then run:

```text
/bvc easy Fix the parser regression
/bvc medium Plan the authentication refactor
/bvc hard Compare migration approaches across the affected services
```

You can also use the BVC button to choose roles, configured models, and the planning budget.

BVC collects independent proposals, measures disagreement on four decision axes, and spends remaining calls on critique when needed. It preserves unresolved objections and produces `bvc-plan.md`. When discussion saving is enabled, `bvc-discussion.md` includes the reports and a trace of calls, outcomes, usage, and context omissions.

With four roles, the text-command defaults allow at most 5, 9, or 13 model calls. Calls can end early when no critique is needed. Timeouts, cancellation, refusals, and known output truncation prevent partial responses from being accepted as the final plan.

A plan still needs implementation and executable tests. BVC records this as `verification: "not_run"`. It does not assign a correctness score from model agreement.

## Installation

The Windows preview is distributed as a VSIX. In the editor's Extensions view, choose **Install from VSIX**, select the archive, then reload the window. Configure your model provider and credentials in the assistant settings before sending a task.

The extension is free and open source. Model-provider charges depend on the provider you configure; the BVC call counter does not cap provider retries or monetary cost.

## Integrate the core in another project

The `@xynapse/bvc` package has no runtime dependencies on this extension, VS Code, Continue, or a model SDK. A host supplies a small streaming adapter and retains control over credentials, model choice, tools, and saving files.

Open `README.md` in the `@xynapse/bvc` package archive for the adapter contract and integration example. The archive also contains research notes, TypeScript declarations, and an offline demo.

## Source and attribution

Developed as part of [Xynapse](https://github.com/jabrailkhalil/xynapse) by Dzhabrail Khalilov.

Xynapse Assistant is based on [Continue](https://github.com/continuedev/continue). The upstream copyright and license notices are retained. Distributed under [Apache-2.0](./LICENSE.txt).

# BVC evaluation supplement

This archive accompanies three 2026 manuscripts about the same frozen
60-task, four-method evaluation matrix. It is intended for data audit and
recalculation of the reported tables and figures.

## Scope

- `results/main60-primary-v1/`: 240 evaluated primary rows and integrity data.
- `results/main60-stochasticity-audit-v1/`: 90 additional repeat rows.
- `results/main60-vibe-v1/`: 45 evaluated conversational-prompt rows.
- `results/robustness-analysis-v1.json`: frozen repeat/style analysis output.
- `results/global-cost-guard-audit.json`: audit of actual successful calls,
  tokens, and frozen-price cost across all stored artifacts.
- `data/selection_summary.json`, `FROZEN_MANIFEST.json`, and protocol Markdown
  files: selection, freeze, and deviation documentation.
- `scripts/`: analysis and figure-generation source.
- `articles/`: LaTeX, bibliography, derived metrics, and final PDFs.

The three manuscripts reuse the same 240-run primary matrix; they are not
independent replications. Their separate questions are adaptive budget,
auditable evaluation, and upfront/conversational prompting.

## Verification

`SHA256SUMS.txt` contains the SHA-256 of every other file in the archive.
Hashes establish byte-level identity of an obtained copy; they do not by
themselves provide access or guarantee future reproduction of hosted-model
tokens. The Xynapse project repository is
`https://github.com/jabrailkhalil/xynapse`; no archival DOI had been assigned
when this local supplement was built on 2026-08-03.

## Core statistical result

The preregistered primary contrast is BVC minus one structured plan:
5/60 versus 7/60, -3.3 percentage points, stratified paired-bootstrap 95%
interval [-10.0, +3.3], exact McNemar p=0.625. Superiority and noninferiority
at the -5 percentage-point margin were not established.

The directly demonstrated resource result compares BVC with its own
nonadaptive full-council version: 21.3% fewer accepted route calls, 22.2%
fewer tokens, and 23.5% lower frozen-price calculated cost in this matrix.

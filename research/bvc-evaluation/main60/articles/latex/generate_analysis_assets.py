from __future__ import annotations

import json
import hashlib
import math
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RESULTS = ROOT / "results"
DATA = ROOT / "data"
FIGURES = HERE / "figures"
DERIVED = HERE / "derived"

METHODS = ["direct", "single_plan", "bvc_upfront", "fixed_council"]
LABELS = {
    "direct": "Direct",
    "single_plan": "Один план",
    "bvc_upfront": "BVC",
    "fixed_council": "Полный совет",
}
COLORS = {
    "direct": "#64748B",
    "single_plan": "#0EA5E9",
    "bvc_upfront": "#7C3AED",
    "fixed_council": "#F59E0B",
}
TARIFF = {
    "uncached_input": 0.3,
    "cached_input": 0.075,
    "output": 0.5,
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def wilson_interval(successes: int, n: int, z: float = 1.959963984540054) -> tuple[float, float]:
    if n == 0:
        return 0.0, 0.0
    p = successes / n
    denominator = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denominator
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator
    return center - margin, center + margin


def task_cost(row: dict) -> float:
    usage = row["usage"]
    return (
        usage["uncached_input_tokens"] * TARIFF["uncached_input"]
        + usage["cached_input_tokens"] * TARIFF["cached_input"]
        + usage["output_tokens"] * TARIFF["output"]
    ) / 1000


def percentile(values: list[float], q: float) -> float:
    return float(np.percentile(np.asarray(values, dtype=float), q))


def stratified_paired_bootstrap(
    differences_by_stratum: dict[str, list[float]],
    seed_label: str,
    repetitions: int = 10_000,
) -> dict:
    """Describe paired differences and bootstrap them within frozen strata."""
    ordered_strata = ["medium", "hard", "very_hard"]
    observed = np.asarray(
        [
            value
            for stratum in ordered_strata
            for value in differences_by_stratum[stratum]
        ],
        dtype=float,
    )
    seed = int.from_bytes(
        hashlib.sha256(seed_label.encode("utf-8")).digest()[:8], "big"
    )
    rng = np.random.default_rng(seed)
    bootstrap_means = np.empty(repetitions, dtype=float)
    bootstrap_medians = np.empty(repetitions, dtype=float)
    stratum_arrays = {
        stratum: np.asarray(differences_by_stratum[stratum], dtype=float)
        for stratum in ordered_strata
    }
    for index in range(repetitions):
        resampled = np.concatenate(
            [
                rng.choice(values, size=len(values), replace=True)
                for values in stratum_arrays.values()
            ]
        )
        bootstrap_means[index] = np.mean(resampled)
        bootstrap_medians[index] = np.median(resampled)
    return {
        "direction": "fixed_council_minus_bvc_upfront",
        "n": int(observed.size),
        "mean": float(np.mean(observed)),
        "median": float(np.median(observed)),
        "p25": percentile(observed.tolist(), 25),
        "p75": percentile(observed.tolist(), 75),
        "min": float(np.min(observed)),
        "max": float(np.max(observed)),
        "stratified_bootstrap_repetitions": repetitions,
        "seed_label": seed_label,
        "mean_bootstrap_95": {
            "lower": percentile(bootstrap_means.tolist(), 2.5),
            "upper": percentile(bootstrap_means.tolist(), 97.5),
        },
        "median_bootstrap_95": {
            "lower": percentile(bootstrap_medians.tolist(), 2.5),
            "upper": percentile(bootstrap_medians.tolist(), 97.5),
        },
    }


def savefig(name: str) -> None:
    FIGURES.mkdir(parents=True, exist_ok=True)
    plt.savefig(FIGURES / f"{name}.pdf", bbox_inches="tight", pad_inches=0.05)
    plt.close()


def style() -> None:
    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 10,
            "axes.titlesize": 12,
            "axes.labelsize": 10,
            "axes.edgecolor": "#CBD5E1",
            "axes.linewidth": 0.8,
            "axes.grid": True,
            "grid.color": "#E2E8F0",
            "grid.linewidth": 0.8,
            "grid.alpha": 0.9,
            "axes.axisbelow": True,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
        }
    )


def add_bar_labels(ax, bars, fmt="{:.1f}", suffix="") -> None:
    for bar in bars:
        value = bar.get_height()
        ax.annotate(
            fmt.format(value) + suffix,
            (bar.get_x() + bar.get_width() / 2, value),
            xytext=(0, 4),
            textcoords="offset points",
            ha="center",
            va="bottom",
            fontsize=9,
            fontweight="bold",
            color="#0F172A",
        )


def main() -> None:
    style()
    FIGURES.mkdir(parents=True, exist_ok=True)
    DERIVED.mkdir(parents=True, exist_ok=True)

    primary = load_jsonl(RESULTS / "main60-primary-v1" / "evaluated.jsonl")
    repeat = load_jsonl(RESULTS / "main60-stochasticity-audit-v1" / "evaluated.jsonl")
    vibe = load_jsonl(RESULTS / "main60-vibe-v1" / "evaluated.jsonl")
    analysis = load_json(RESULTS / "main60-primary-v1" / "analysis.json")
    robustness = load_json(RESULTS / "robustness-analysis-v1.json")
    selection = load_json(DATA / "selection_summary.json")
    integrity_primary = load_json(RESULTS / "main60-primary-v1" / "integrity-final.json")
    integrity_repeat = load_json(
        RESULTS / "main60-stochasticity-audit-v1" / "integrity-final.json"
    )
    integrity_vibe = load_json(RESULTS / "main60-vibe-v1" / "integrity-final.json")
    global_cost = load_json(RESULTS / "global-cost-guard-audit.json")

    by_method: dict[str, list[dict]] = {
        method: [row for row in primary if row["method"] == method] for method in METHODS
    }

    method_metrics: dict[str, dict] = {}
    for method, rows in by_method.items():
        successes = sum(bool(row["resolved"]) for row in rows)
        tokens = [row["usage"]["total_tokens"] for row in rows]
        calls = [row["usage"]["successful_calls"] for row in rows]
        costs = [task_cost(row) for row in rows]
        ci = wilson_interval(successes, len(rows))
        parseable = sum(bool(row["patch_diagnostics"].get("parse_ok")) for row in rows)
        applied = sum(bool(row["patch_successfully_applied"]) for row in rows)
        method_metrics[method] = {
            "n": len(rows),
            "resolved": successes,
            "resolution_rate": successes / len(rows),
            "wilson_95": {"lower": ci[0], "upper": ci[1]},
            "parseable_patches": parseable,
            "applied_patches": applied,
            "calls_total": sum(calls),
            "calls_mean": float(np.mean(calls)),
            "calls_median": float(np.median(calls)),
            "tokens_total": sum(tokens),
            "tokens_mean": float(np.mean(tokens)),
            "tokens_median": float(np.median(tokens)),
            "tokens_p25": percentile(tokens, 25),
            "tokens_p75": percentile(tokens, 75),
            "cost_total": sum(costs),
            "cost_mean": float(np.mean(costs)),
            "cost_median": float(np.median(costs)),
            "cost_per_resolved": sum(costs) / successes if successes else None,
        }

    bvc_rows = by_method["bvc_upfront"]
    route_groups = {
        "short": [r for r in bvc_rows if r["method_diagnostics"]["critique_rounds"] == 0],
        "extended": [r for r in bvc_rows if r["method_diagnostics"]["critique_rounds"] == 1],
    }
    route_metrics = {}
    for route, rows in route_groups.items():
        tokens = [r["usage"]["total_tokens"] for r in rows]
        costs = [task_cost(r) for r in rows]
        route_metrics[route] = {
            "tasks": len(rows),
            "rate": len(rows) / len(bvc_rows),
            "resolved": sum(bool(r["resolved"]) for r in rows),
            "tokens_total": sum(tokens),
            "tokens_mean": float(np.mean(tokens)),
            "tokens_median": float(np.median(tokens)),
            "cost_total": sum(costs),
            "cost_mean": float(np.mean(costs)),
            "calls_total": sum(r["usage"]["successful_calls"] for r in rows),
        }

    gate_by_stratum = {}
    for stratum in ["medium", "hard", "very_hard"]:
        rows = [r for r in bvc_rows if r["selection_stratum"] == stratum]
        critique = sum(r["method_diagnostics"]["critique_rounds"] == 1 for r in rows)
        gate_by_stratum[stratum] = {
            "tasks": len(rows),
            "critique_tasks": critique,
            "critique_rate": critique / len(rows) if rows else None,
            "resolved": sum(bool(r["resolved"]) for r in rows),
        }

    fixed = method_metrics["fixed_council"]
    bvc = method_metrics["bvc_upfront"]
    efficiency = {
        "calls_saved": fixed["calls_total"] - bvc["calls_total"],
        "calls_saved_rate": 1 - bvc["calls_total"] / fixed["calls_total"],
        "tokens_saved": fixed["tokens_total"] - bvc["tokens_total"],
        "tokens_saved_rate": 1 - bvc["tokens_total"] / fixed["tokens_total"],
        "cost_saved": fixed["cost_total"] - bvc["cost_total"],
        "cost_saved_rate": 1 - bvc["cost_total"] / fixed["cost_total"],
        "calls_per_task_saved": (fixed["calls_total"] - bvc["calls_total"]) / 60,
        "tokens_per_task_saved": (fixed["tokens_total"] - bvc["tokens_total"]) / 60,
        "cost_per_task_saved": (fixed["cost_total"] - bvc["cost_total"]) / 60,
        "bvc_cost_per_resolved": bvc["cost_per_resolved"],
        "fixed_cost_per_resolved": fixed["cost_per_resolved"],
        "cost_per_resolved_saved_rate": 1
        - bvc["cost_per_resolved"] / fixed["cost_per_resolved"],
        "bvc_calls_per_resolved": bvc["calls_total"] / bvc["resolved"],
        "fixed_calls_per_resolved": fixed["calls_total"] / fixed["resolved"],
        "bvc_tokens_per_resolved": bvc["tokens_total"] / bvc["resolved"],
        "fixed_tokens_per_resolved": fixed["tokens_total"] / fixed["resolved"],
        "break_even_min_resolved_vs_fixed_cost_per_resolved": math.ceil(
            bvc["cost_total"] / fixed["cost_per_resolved"]
        ),
    }

    bvc_by_id = {row["instance_id"]: row for row in by_method["bvc_upfront"]}
    fixed_by_id = {
        row["instance_id"]: row for row in by_method["fixed_council"]
    }
    paired_task_rows = []
    for instance_id, bvc_row in bvc_by_id.items():
        fixed_row = fixed_by_id[instance_id]
        paired_task_rows.append(
            {
                "instance_id": instance_id,
                "selection_stratum": bvc_row["selection_stratum"],
                "route": (
                    "short"
                    if bvc_row["method_diagnostics"]["critique_rounds"] == 0
                    else "extended"
                ),
                "calls_saved": (
                    fixed_row["usage"]["successful_calls"]
                    - bvc_row["usage"]["successful_calls"]
                ),
                "tokens_saved": (
                    fixed_row["usage"]["total_tokens"]
                    - bvc_row["usage"]["total_tokens"]
                ),
                "cost_saved_rub": task_cost(fixed_row) - task_cost(bvc_row),
                "bvc_resolved": int(bool(bvc_row["resolved"])),
                "fixed_resolved": int(bool(fixed_row["resolved"])),
            }
        )

    paired_resource_savings = {}
    resource_extractors = {
        "calls": lambda row: float(row["usage"]["successful_calls"]),
        "tokens": lambda row: float(row["usage"]["total_tokens"]),
        "cost_rub": task_cost,
    }
    for metric, extractor in resource_extractors.items():
        differences_by_stratum = {
            stratum: [
                extractor(fixed_by_id[instance_id])
                - extractor(bvc_by_id[instance_id])
                for instance_id in bvc_by_id
                if bvc_by_id[instance_id]["selection_stratum"] == stratum
            ]
            for stratum in ["medium", "hard", "very_hard"]
        }
        paired_resource_savings[metric] = stratified_paired_bootstrap(
            differences_by_stratum,
            f"bvc-paired-resource-v1\0{metric}",
        )

    paired_task_summary = {
        "tokens_negative_tasks": sum(
            row["tokens_saved"] < 0 for row in paired_task_rows
        ),
        "tokens_min": min(row["tokens_saved"] for row in paired_task_rows),
        "tokens_max": max(row["tokens_saved"] for row in paired_task_rows),
        "cost_negative_tasks": sum(
            row["cost_saved_rub"] < 0 for row in paired_task_rows
        ),
        "cost_min_rub": min(row["cost_saved_rub"] for row in paired_task_rows),
        "cost_max_rub": max(row["cost_saved_rub"] for row in paired_task_rows),
    }
    route_outcomes = {}
    for route in ["short", "extended"]:
        rows = [row for row in paired_task_rows if row["route"] == route]
        route_outcomes[route] = {
            "tasks": len(rows),
            "bvc_resolved": sum(row["bvc_resolved"] for row in rows),
            "fixed_resolved": sum(row["fixed_resolved"] for row in rows),
            "discordant_tasks": [
                row["instance_id"]
                for row in rows
                if row["bvc_resolved"] != row["fixed_resolved"]
            ],
        }

    initial_gate_metrics = [
        row["method_diagnostics"]["initial_metrics"] for row in bvc_rows
    ]
    valid_axis_counts = Counter(metric["T_ge2"] for metric in initial_gate_metrics)
    defined_vote_metrics = [
        metric for metric in initial_gate_metrics if metric["D_vote"] is not None
    ]
    gate_diagnostics = {
        "valid_axis_count_distribution": {
            str(count): valid_axis_counts.get(count, 0) for count in range(5)
        },
        "undefined_d_vote_tasks": sum(
            metric["D_vote"] is None for metric in initial_gate_metrics
        ),
        "pearson_d_vote_d_cov_defined": float(
            np.corrcoef(
                [metric["D_vote"] for metric in defined_vote_metrics],
                [metric["D_cov"] for metric in defined_vote_metrics],
            )[0, 1]
        ),
        "pearson_n": len(defined_vote_metrics),
    }

    component_costs = {}
    for method, rows in by_method.items():
        cached = sum(r["usage"]["cached_input_tokens"] for r in rows)
        uncached = sum(r["usage"]["uncached_input_tokens"] for r in rows)
        output = sum(r["usage"]["output_tokens"] for r in rows)
        component_costs[method] = {
            "cached_input_rub": cached * TARIFF["cached_input"] / 1000,
            "uncached_input_rub": uncached * TARIFF["uncached_input"] / 1000,
            "output_rub": output * TARIFF["output"] / 1000,
        }

    derived = {
        "sources": {
            "primary_sha256": analysis["source_sha256"],
            "repeat_sha256": robustness["source_sha256"]["repeat"],
            "vibe_sha256": robustness["source_sha256"]["vibe"],
            "analysis_script_sha256": analysis["analysis_script_sha256"],
        },
        "population": {
            "tasks": selection["selected_rows"],
            "repositories": len(selection["repository_counts"]),
            "difficulty_counts": selection["stratum_counts"],
            "repository_counts": selection["repository_counts"],
        },
        "method_metrics": method_metrics,
        "route_metrics": route_metrics,
        "gate_by_stratum": gate_by_stratum,
        "efficiency_bvc_vs_fixed": efficiency,
        "paired_resource_savings_bvc_vs_fixed": paired_resource_savings,
        "paired_task_summary_bvc_vs_fixed": paired_task_summary,
        "route_outcomes_bvc_vs_fixed": route_outcomes,
        "gate_diagnostics": gate_diagnostics,
        "cost_components": component_costs,
        "paired_comparisons": analysis["comparisons"],
        "repeatability": robustness["repeatability"],
        "style_shift": robustness["style_shift_by_method_vibe_minus_formal"],
        "integrity": {
            "primary": integrity_primary,
            "repeat": integrity_repeat,
            "vibe": integrity_vibe,
        },
        "total_experiment": {
            "official_evaluation_rows": len(primary) + len(repeat) + len(vibe),
            "primary_rows": len(primary),
            "repeat_rows": len(repeat),
            "vibe_rows": len(vibe),
            "successful_calls_all_artifacts": global_cost["successful_calls"],
            "total_tokens_all_artifacts": global_cost["total_tokens"],
            "estimated_rub_all_artifacts": global_cost["estimated_rub"],
            "cost_cap_rub": global_cost["stop_at_rub"],
        },
    }
    (DERIVED / "derived_metrics.json").write_text(
        json.dumps(derived, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    macro_values = {
        "NTasks": 60,
        "NRepos": len(selection["repository_counts"]),
        "NPrimaryRuns": len(primary),
        "NRepeatRuns": len(repeat),
        "NVibeRuns": len(vibe),
        "NAllRuns": len(primary) + len(repeat) + len(vibe),
        "DirectResolved": method_metrics["direct"]["resolved"],
        "SingleResolved": method_metrics["single_plan"]["resolved"],
        "BVCResolved": method_metrics["bvc_upfront"]["resolved"],
        "FixedResolved": method_metrics["fixed_council"]["resolved"],
        "DirectRate": f"{method_metrics['direct']['resolution_rate'] * 100:.1f}",
        "SingleRate": f"{method_metrics['single_plan']['resolution_rate'] * 100:.1f}",
        "BVCRate": f"{method_metrics['bvc_upfront']['resolution_rate'] * 100:.1f}",
        "FixedRate": f"{method_metrics['fixed_council']['resolution_rate'] * 100:.1f}",
        "DirectWilsonLow": f"{method_metrics['direct']['wilson_95']['lower'] * 100:.1f}",
        "DirectWilsonHigh": f"{method_metrics['direct']['wilson_95']['upper'] * 100:.1f}",
        "SingleWilsonLow": f"{method_metrics['single_plan']['wilson_95']['lower'] * 100:.1f}",
        "SingleWilsonHigh": f"{method_metrics['single_plan']['wilson_95']['upper'] * 100:.1f}",
        "BVCWilsonLow": f"{method_metrics['bvc_upfront']['wilson_95']['lower'] * 100:.1f}",
        "BVCWilsonHigh": f"{method_metrics['bvc_upfront']['wilson_95']['upper'] * 100:.1f}",
        "FixedWilsonLow": f"{method_metrics['fixed_council']['wilson_95']['lower'] * 100:.1f}",
        "FixedWilsonHigh": f"{method_metrics['fixed_council']['wilson_95']['upper'] * 100:.1f}",
        "BVCCalls": bvc["calls_total"],
        "FixedCalls": fixed["calls_total"],
        "DirectCalls": method_metrics["direct"]["calls_total"],
        "SingleCalls": method_metrics["single_plan"]["calls_total"],
        "BVCTokens": bvc["tokens_total"],
        "FixedTokens": fixed["tokens_total"],
        "DirectTokens": method_metrics["direct"]["tokens_total"],
        "SingleTokens": method_metrics["single_plan"]["tokens_total"],
        "BVCCost": f"{bvc['cost_total']:.2f}",
        "FixedCost": f"{fixed['cost_total']:.2f}",
        "DirectCost": f"{method_metrics['direct']['cost_total']:.2f}",
        "SingleCost": f"{method_metrics['single_plan']['cost_total']:.2f}",
        "BVCCostTask": f"{bvc['cost_mean']:.2f}",
        "FixedCostTask": f"{fixed['cost_mean']:.2f}",
        "DirectCostTask": f"{method_metrics['direct']['cost_mean']:.2f}",
        "SingleCostTask": f"{method_metrics['single_plan']['cost_mean']:.2f}",
        "BVCCostResolved": f"{bvc['cost_per_resolved']:.2f}",
        "FixedCostResolved": f"{fixed['cost_per_resolved']:.2f}",
        "DirectCostResolved": f"{method_metrics['direct']['cost_per_resolved']:.2f}",
        "SingleCostResolved": f"{method_metrics['single_plan']['cost_per_resolved']:.2f}",
        "CallsSaved": efficiency["calls_saved"],
        "CallsSavedPct": f"{efficiency['calls_saved_rate'] * 100:.1f}",
        "TokensSaved": efficiency["tokens_saved"],
        "TokensSavedPct": f"{efficiency['tokens_saved_rate'] * 100:.1f}",
        "CostSaved": f"{efficiency['cost_saved']:.2f}",
        "CostSavedPct": f"{efficiency['cost_saved_rate'] * 100:.1f}",
        "CostResolvedSavedPct": f"{efficiency['cost_per_resolved_saved_rate'] * 100:.1f}",
        "TokensSavedTask": f"{efficiency['tokens_per_task_saved']:.0f}",
        "CostSavedTask": f"{efficiency['cost_per_task_saved']:.2f}",
        "CallsSavedTaskMean": f"{paired_resource_savings['calls']['mean']:.2f}",
        "CallsSavedTaskMeanLow": f"{paired_resource_savings['calls']['mean_bootstrap_95']['lower']:.2f}",
        "CallsSavedTaskMeanHigh": f"{paired_resource_savings['calls']['mean_bootstrap_95']['upper']:.2f}",
        "CallsSavedTaskMedian": f"{paired_resource_savings['calls']['median']:.0f}",
        "TokensSavedTaskMeanLow": f"{paired_resource_savings['tokens']['mean_bootstrap_95']['lower']:.0f}",
        "TokensSavedTaskMeanHigh": f"{paired_resource_savings['tokens']['mean_bootstrap_95']['upper']:.0f}",
        "TokensSavedTaskMedian": f"{paired_resource_savings['tokens']['median']:.0f}",
        "CostSavedTaskMeanLow": f"{paired_resource_savings['cost_rub']['mean_bootstrap_95']['lower']:.2f}",
        "CostSavedTaskMeanHigh": f"{paired_resource_savings['cost_rub']['mean_bootstrap_95']['upper']:.2f}",
        "CostSavedTaskMedian": f"{paired_resource_savings['cost_rub']['median']:.2f}",
        "TokensOverrunTasks": paired_task_summary["tokens_negative_tasks"],
        "TokensOverrunMax": abs(paired_task_summary["tokens_min"]),
        "CostOverrunTasks": paired_task_summary["cost_negative_tasks"],
        "CostOverrunMax": f"{abs(paired_task_summary['cost_min_rub']):.2f}",
        "BVCShort": route_metrics["short"]["tasks"],
        "BVCExtended": route_metrics["extended"]["tasks"],
        "BVCShortResolved": route_metrics["short"]["resolved"],
        "BVCExtendedResolved": route_metrics["extended"]["resolved"],
        "BVCShortTokensMean": f"{route_metrics['short']['tokens_mean']:.0f}",
        "BVCExtendedTokensMean": f"{route_metrics['extended']['tokens_mean']:.0f}",
        "BVCShortCostMean": f"{route_metrics['short']['cost_mean']:.2f}",
        "BVCExtendedCostMean": f"{route_metrics['extended']['cost_mean']:.2f}",
        "FixedShortResolved": route_outcomes["short"]["fixed_resolved"],
        "FixedExtendedResolved": route_outcomes["extended"]["fixed_resolved"],
        "GateUndefinedVote": gate_diagnostics["undefined_d_vote_tasks"],
        "GateFourValidAxes": valid_axis_counts.get(4, 0),
        "GateThreeValidAxes": valid_axis_counts.get(3, 0),
        "GateZeroValidAxes": valid_axis_counts.get(0, 0),
        "GateMetricCorrelation": f"{gate_diagnostics['pearson_d_vote_d_cov_defined']:.3f}",
        "AllTokens": global_cost["total_tokens"],
        "AllCost": f"{global_cost['estimated_rub']:.2f}",
        "CostCap": global_cost["stop_at_rub"],
    }
    macro_lines = [
        "% Auto-generated by generate_analysis_assets.py. Do not edit by hand."
    ]
    for name, value in macro_values.items():
        macro_lines.append(f"\\newcommand{{\\{name}}}{{{value}}}")
    (DERIVED / "metrics.tex").write_text(
        "\n".join(macro_lines) + "\n", encoding="utf-8"
    )

    # 1. Resolution rates with Wilson confidence intervals.
    x = np.arange(len(METHODS))
    rates = np.array([method_metrics[m]["resolution_rate"] * 100 for m in METHODS])
    lower = rates - np.array(
        [method_metrics[m]["wilson_95"]["lower"] * 100 for m in METHODS]
    )
    upper = (
        np.array([method_metrics[m]["wilson_95"]["upper"] * 100 for m in METHODS])
        - rates
    )
    plt.figure(figsize=(7.1, 3.9))
    bars = plt.bar(
        x,
        rates,
        color=[COLORS[m] for m in METHODS],
        width=0.62,
        edgecolor="white",
    )
    plt.errorbar(x, rates, yerr=[lower, upper], fmt="none", ecolor="#0F172A", capsize=4)
    for bar, method, rate in zip(bars, METHODS, rates):
        plt.text(
            bar.get_x() + bar.get_width() / 2,
            rate + 0.55,
            f"{method_metrics[method]['resolved']}/60\n{rate:.1f}%",
            ha="center",
            va="bottom",
            fontsize=8.5,
            fontweight="bold",
        )
    plt.xticks(x, [LABELS[m] for m in METHODS])
    plt.ylabel("Решено задач, %")
    plt.title("Функциональный результат на 60 задачах SWE-bench Verified")
    plt.ylim(0, max((rates + upper) * 1.18))
    plt.figtext(
        0.5,
        -0.02,
        "Вертикальные интервалы: 95% Wilson CI для каждой доли; сравнение методов является парным.",
        ha="center",
        fontsize=8.5,
        color="#475569",
    )
    savefig("fig_success_wilson")

    # 2. Paired BVC effects with frozen stratified bootstrap intervals.
    comparison_keys = [
        "primary_bvc_vs_single",
        "secondary_bvc_vs_direct",
        "secondary_bvc_vs_fixed",
    ]
    comparison_labels = ["BVC − один план", "BVC − direct", "BVC − полный совет"]
    effects = np.array(
        [analysis["comparisons"][key]["difference"] * 100 for key in comparison_keys]
    )
    lowers = np.array(
        [
            analysis["comparisons"][key]["stratified_paired_bootstrap_95"]["lower_95"]
            * 100
            for key in comparison_keys
        ]
    )
    uppers = np.array(
        [
            analysis["comparisons"][key]["stratified_paired_bootstrap_95"]["upper_95"]
            * 100
            for key in comparison_keys
        ]
    )
    y = np.arange(len(comparison_keys))
    plt.figure(figsize=(7.1, 3.5))
    plt.axvline(0, color="#334155", lw=1)
    plt.errorbar(
        effects,
        y,
        xerr=[effects - lowers, uppers - effects],
        fmt="o",
        markersize=7,
        color=COLORS["bvc_upfront"],
        ecolor=COLORS["bvc_upfront"],
        capsize=4,
        lw=2,
    )
    for i, (effect, pvalue) in enumerate(
        [
            (
                analysis["comparisons"][key]["difference"] * 100,
                analysis["comparisons"][key]["mcnemar_exact_two_sided_p"],
            )
            for key in comparison_keys
        ]
    ):
        plt.text(
            uppers[i] + 0.35,
            i,
            f"{effect:+.1f} п.п.; p={pvalue:.3f}",
            va="center",
            fontsize=9,
        )
    plt.yticks(y, comparison_labels)
    plt.xlabel("Парная разность долей решённых задач, п.п.")
    plt.title("Эффекты BVC и 95% стратифицированные bootstrap-интервалы")
    plt.xlim(min(lowers) - 2, max(uppers) + 7)
    plt.gca().invert_yaxis()
    savefig("fig_paired_effects")

    # 3. Normalized resource use, BVC versus the fixed council.
    resource_names = ["Вызовы", "Токены", "Стоимость"]
    bvc_relative = [
        bvc["calls_total"] / fixed["calls_total"] * 100,
        bvc["tokens_total"] / fixed["tokens_total"] * 100,
        bvc["cost_total"] / fixed["cost_total"] * 100,
    ]
    plt.figure(figsize=(7.1, 3.8))
    y = np.arange(3)
    bars = plt.barh(
        y,
        bvc_relative,
        color=COLORS["bvc_upfront"],
        height=0.58,
        label="Использовано BVC",
    )
    saved_bars = plt.barh(
        y,
        [100 - value for value in bvc_relative],
        left=bvc_relative,
        color="#14B8A6",
        height=0.58,
        label="Сэкономлено",
    )
    for i, (bar, saved_bar) in enumerate(zip(bars, saved_bars)):
        savings = 100 - bvc_relative[i]
        plt.text(
            bar.get_width() / 2,
            bar.get_y() + bar.get_height() / 2,
            f"BVC\n{bar.get_width():.1f}%",
            ha="center",
            va="center",
            color="white",
            fontweight="bold",
        )
        plt.text(
            saved_bar.get_x() + saved_bar.get_width() / 2,
            saved_bar.get_y() + saved_bar.get_height() / 2,
            f"−{savings:.1f}%",
            ha="center",
            va="center",
            color="white",
            fontsize=8.5,
            fontweight="bold",
        )
    plt.yticks(y, resource_names)
    plt.xlabel("Ресурс относительно полного совета, %")
    plt.title("Ресурс BVC относительно обязательного полного совета")
    plt.xlim(0, 100)
    plt.gca().invert_yaxis()
    plt.legend(frameon=False, ncol=2, loc="lower center", bbox_to_anchor=(0.5, -0.28))
    savefig("fig_resource_normalized")

    # 4. BVC routing mix.
    short_n = route_metrics["short"]["tasks"]
    extended_n = route_metrics["extended"]["tasks"]
    plt.figure(figsize=(6.3, 3.6))
    bars = plt.barh(
        [0],
        [short_n],
        color="#14B8A6",
        height=0.58,
        label="Короткий маршрут: 6 вызовов",
    )
    plt.barh(
        [0],
        [extended_n],
        left=[short_n],
        color=COLORS["bvc_upfront"],
        height=0.58,
        label="Критика: 10 вызовов",
    )
    plt.text(short_n / 2, 0, f"{short_n}/60\n53,3%", ha="center", va="center", color="white", fontweight="bold")
    plt.text(
        short_n + extended_n / 2,
        0,
        f"{extended_n}/60\n46,7%",
        ha="center",
        va="center",
        color="white",
        fontweight="bold",
    )
    plt.xlim(0, 60)
    plt.yticks([])
    plt.xlabel("Число задач")
    plt.title("Фактическое распределение маршрутов BVC")
    plt.legend(loc="lower center", bbox_to_anchor=(0.5, -0.32), ncol=2, frameon=False)
    savefig("fig_bvc_routes")

    # 5. Per-task token distributions. A deterministic strip plot exposes the
    # two BVC routes instead of connecting their modes with a box.
    plt.figure(figsize=(7.1, 4.2))
    jitter = np.linspace(-0.16, 0.16, 60)
    for index, method in enumerate(METHODS):
        rows = sorted(by_method[method], key=lambda row: row["instance_id"])
        values = np.asarray([row["usage"]["total_tokens"] / 1000 for row in rows])
        if method == "bvc_upfront":
            short = np.asarray(
                [row["method_diagnostics"]["critique_rounds"] == 0 for row in rows]
            )
            plt.scatter(
                index + jitter[short], values[short], s=18, alpha=0.78,
                color="#14B8A6", edgecolor="white", linewidth=0.35,
                label="BVC: короткий" if index == 2 else None,
            )
            plt.scatter(
                index + jitter[~short], values[~short], s=18, alpha=0.78,
                color=COLORS[method], edgecolor="white", linewidth=0.35,
                label="BVC: расширенный" if index == 2 else None,
            )
        else:
            plt.scatter(
                index + jitter, values, s=18, alpha=0.65,
                color=COLORS[method], edgecolor="white", linewidth=0.35,
            )
        median = float(np.median(values))
        plt.plot([index - 0.22, index + 0.22], [median, median], color="#0F172A", lw=2.0)
    plt.xticks(np.arange(len(METHODS)), [LABELS[m] for m in METHODS])
    plt.ylabel("Токены на задачу, тыс.")
    plt.title("Каждая задача и медиана фактического объёма токенов")
    plt.legend(frameon=False, ncol=2, fontsize=8, loc="upper left")
    savefig("fig_tokens_boxplot")

    # 6. BVC gate in the frozen D_vote/D_cov plane. Undefined D_vote is shown
    # on a separate categorical axis rather than inserted into a numeric scale.
    fig, (axis_none, axis_num) = plt.subplots(
        1, 2, figsize=(7.1, 4.6), sharey=True,
        gridspec_kw={"width_ratios": [1.0, 6.2], "wspace": 0.06},
    )
    for route, rows in route_groups.items():
        aggregates: dict[tuple[float | None, float], dict[str, int]] = defaultdict(
            lambda: {"tasks": 0, "resolved": 0}
        )
        for row in rows:
            metrics = row["method_diagnostics"]["initial_metrics"]
            key = (metrics["D_vote"], metrics["D_cov"])
            aggregates[key]["tasks"] += 1
            aggregates[key]["resolved"] += int(bool(row["resolved"]))
        color = COLORS["bvc_upfront"] if route == "extended" else "#14B8A6"
        label = "Критика" if route == "extended" else "Без критики"
        for axis, undefined in [(axis_none, True), (axis_num, False)]:
            coordinates = [key for key in aggregates if (key[0] is None) == undefined]
            if not coordinates:
                continue
            xvals = [0.0 if key[0] is None else key[0] for key in coordinates]
            yvals = [key[1] for key in coordinates]
            sizes = [48 + 22 * (aggregates[key]["tasks"] - 1) for key in coordinates]
            axis.scatter(
                xvals, yvals, s=sizes, alpha=0.78,
                label=label if axis is axis_num else None,
                color=color, edgecolor="white", linewidth=0.6,
            )
            for key, x_value in zip(coordinates, xvals):
                total = aggregates[key]["tasks"]
                if total > 1:
                    axis.text(
                        x_value, key[1], str(total), ha="center", va="center",
                        fontsize=7, color="white", fontweight="bold",
                    )
    for axis, undefined in [(axis_none, True), (axis_num, False)]:
        resolved_coordinates = [
            (
                row["method_diagnostics"]["initial_metrics"]["D_vote"],
                row["method_diagnostics"]["initial_metrics"]["D_cov"],
            )
            for row in bvc_rows
            if row["resolved"]
            and (row["method_diagnostics"]["initial_metrics"]["D_vote"] is None)
            == undefined
        ]
        if resolved_coordinates:
            axis.scatter(
                [0.0 if point[0] is None else point[0] for point in resolved_coordinates],
                [point[1] for point in resolved_coordinates],
                s=125, facecolor="none", edgecolor="#0F172A", linewidth=1.6,
                label="Есть решённая задача" if axis is axis_num else None,
            )
        axis.axhline(0.25, color="#DC2626", ls="--", lw=1.2)
        axis.set_ylim(-0.03, 1.04)
    axis_num.axvline(
        0.30, color="#F97316", ls="--", lw=1.2,
        label=r"$\tau_{vote}=0{,}30$",
    )
    axis_none.set_xlim(-0.32, 0.32)
    axis_none.set_xticks([0.0], ["∅"])
    axis_none.set_xlabel(r"$D_{vote}$")
    axis_none.set_ylabel(r"Доля пропусков $D_{cov}$")
    axis_none.spines["right"].set_visible(False)
    axis_num.spines["left"].set_visible(False)
    axis_num.tick_params(axis="y", left=False, labelleft=False)
    axis_num.set_xlim(-0.01, max(0.36, axis_num.get_xlim()[1]))
    axis_num.set_xlabel(r"Определённое начальное расхождение $D_{vote}$")
    axis_num.legend(frameon=False, ncol=2, fontsize=8, loc="upper right")
    fig.suptitle("Замороженный gate: размер точки = число задач", y=0.99)
    fig.text(
        0.5, -0.01,
        r"$\varnothing$: нет оси с двумя валидными голосами; пунктир: строгие пороги $>$.",
        ha="center", fontsize=8, color="#475569",
    )
    fig.subplots_adjust(left=0.10, right=0.98, bottom=0.17, top=0.88, wspace=0.06)
    savefig("fig_gate_scatter")

    # 7. Outcome funnel.
    stages = ["Синтаксически\nкорректный diff", "Patch применён", "Тесты пройдены"]
    plt.figure(figsize=(7.1, 4.1))
    width = 0.18
    x = np.arange(len(stages))
    for i, method in enumerate(METHODS):
        values = [
            method_metrics[method]["parseable_patches"],
            method_metrics[method]["applied_patches"],
            method_metrics[method]["resolved"],
        ]
        bars = plt.bar(
            x + (i - 1.5) * width,
            values,
            width=width,
            color=COLORS[method],
            label=LABELS[method],
        )
        for bar, value in zip(bars, values):
            plt.text(
                bar.get_x() + bar.get_width() / 2,
                value + 0.8,
                str(value),
                ha="center",
                va="bottom",
                fontsize=8,
            )
    plt.xticks(x, stages)
    plt.ylabel("Задач из 60")
    plt.title("Переход от сгенерированного patch к функциональному успеху")
    plt.ylim(0, 68)
    plt.legend(frameon=False, ncol=2)
    savefig("fig_evaluation_funnel")

    # 8. Task population across repositories.
    repos = list(selection["repository_counts"].keys())
    counts = list(selection["repository_counts"].values())
    order = np.argsort(counts)
    repos_sorted = [repos[i] for i in order]
    counts_sorted = [counts[i] for i in order]
    plt.figure(figsize=(7.1, 5.0))
    bars = plt.barh(repos_sorted, counts_sorted, color="#0EA5E9")
    for bar, value in zip(bars, counts_sorted):
        plt.text(value + 0.2, bar.get_y() + bar.get_height() / 2, str(value), va="center", fontsize=8.5)
    plt.xlabel("Число задач")
    plt.title("Состав выборки: 60 задач из 11 Python-репозиториев")
    plt.xlim(0, max(counts_sorted) + 2.3)
    savefig("fig_repository_distribution")

    # 9. Evaluation layers.
    layer_names = ["Основная матрица", "Повторы", "Vibe-постановка"]
    layer_values = [len(primary), len(repeat), len(vibe)]
    plt.figure(figsize=(6.6, 3.7))
    bars = plt.bar(layer_names, layer_values, color=["#0EA5E9", "#7C3AED", "#14B8A6"])
    add_bar_labels(plt.gca(), bars, "{:.0f}", "")
    plt.ylabel("Официально оценённых строк")
    plt.title(f"Полный объём оценки: {sum(layer_values)} запусков")
    plt.ylim(0, max(layer_values) * 1.18)
    savefig("fig_evaluation_layers")

    # 10. Repeatability.
    repeat_methods = ["direct", "single_plan", "bvc_upfront"]
    repetitions = [1, 2, 3]
    plt.figure(figsize=(7.1, 4.0))
    x = np.arange(3)
    width = 0.24
    for i, method in enumerate(repeat_methods):
        values = [
            robustness["repeatability"][method]["repetition_resolved_rates"][str(rep)]
            * 15
            for rep in repetitions
        ]
        bars = plt.bar(
            x + (i - 1) * width,
            values,
            width=width,
            color=COLORS[method],
            label=LABELS[method],
        )
        for bar, value in zip(bars, values):
            plt.text(
                bar.get_x() + bar.get_width() / 2,
                value + 0.05,
                f"{int(value)}",
                ha="center",
                va="bottom",
                fontsize=8.5,
            )
    plt.xticks(x, ["Повтор 1", "Повтор 2", "Повтор 3"])
    plt.ylabel("Решено задач из 15")
    plt.title("Повторные запуски при temperature = 0")
    plt.ylim(0, 3.0)
    plt.yticks([0, 1, 2, 3])
    plt.legend(frameon=False, ncol=3)
    savefig("fig_repeatability")

    # 11. Formal versus vibe wording. Counts are clearer than percentages for n=15.
    style_methods = ["direct", "single_plan", "bvc_upfront"]
    formal = [
        int(robustness["style_shift_by_method_vibe_minus_formal"][m]["right_resolved"])
        for m in style_methods
    ]
    vibe_counts = [
        int(robustness["style_shift_by_method_vibe_minus_formal"][m]["left_resolved"])
        for m in style_methods
    ]
    x = np.arange(len(style_methods))
    plt.figure(figsize=(7.1, 4.0))
    bars1 = plt.bar(x - 0.18, formal, width=0.36, color="#94A3B8", label="Формальная")
    bars2 = plt.bar(
        x + 0.18,
        vibe_counts,
        width=0.36,
        color=COLORS["bvc_upfront"],
        label="Разговорная",
    )
    for bars_group, values_group in [(bars1, formal), (bars2, vibe_counts)]:
        for bar, value in zip(bars_group, values_group):
            plt.text(
                bar.get_x() + bar.get_width() / 2,
                value + 0.08,
                f"{value}/15",
                ha="center",
                va="bottom",
                fontsize=8.5,
                fontweight="bold",
            )
    plt.xticks(x, [LABELS[m] for m in style_methods])
    plt.ylabel("Решено задач из 15")
    plt.title("Исходы на 15 задачах при смене формулировки")
    plt.ylim(0, 2.7)
    plt.yticks([0, 1, 2])
    plt.legend(frameon=False)
    savefig("fig_formal_vibe")

    # 12. Cost-quality map.
    plt.figure(figsize=(7.1, 4.3))
    for method in METHODS:
        xval = method_metrics[method]["cost_mean"]
        yval = method_metrics[method]["resolution_rate"] * 100
        plt.scatter(xval, yval, s=120, color=COLORS[method], edgecolor="white", linewidth=1)
        dx, dy = {
            "direct": (0.8, -0.8),
            "single_plan": (0.8, 0.4),
            "bvc_upfront": (0.8, -0.8),
            "fixed_council": (-8.8, 0.45),
        }[method]
        plt.text(xval + dx, yval + dy, LABELS[method], fontsize=9, fontweight="bold")
    plt.xlabel("Расчётная стоимость на задачу, ₽")
    plt.ylabel("Решено задач, %")
    plt.title("Наблюдаемое соотношение стоимости и функционального результата")
    plt.xlim(0, 44)
    plt.ylim(4.5, 13)
    savefig("fig_cost_quality")

    # 13. Per-task paired token savings, BVC versus full council.
    bvc_by_id = {r["instance_id"]: r for r in by_method["bvc_upfront"]}
    fixed_by_id = {r["instance_id"]: r for r in by_method["fixed_council"]}
    savings = sorted(
        (
            fixed_by_id[instance]["usage"]["total_tokens"]
            - bvc_by_id[instance]["usage"]["total_tokens"]
        )
        / 1000
        for instance in bvc_by_id
    )
    plt.figure(figsize=(7.1, 4.0))
    colors = ["#EF4444" if value < 0 else COLORS["bvc_upfront"] for value in savings]
    plt.bar(np.arange(1, 61), savings, color=colors, width=0.82)
    plt.axhline(0, color="#334155", lw=1)
    plt.xlabel("Задачи, отсортированные по разности токенов")
    plt.ylabel("Экономия токенов на задаче, тыс.")
    plt.title("Парная разность: токены полного совета минус токены BVC")
    plt.figtext(
        0.5,
        -0.02,
        f"Суммарная экономия: {efficiency['tokens_saved']/1_000_000:.2f} млн токенов.",
        ha="center",
        fontsize=8.5,
        color="#475569",
    )
    from matplotlib.patches import Patch
    plt.legend(
        handles=[
            Patch(facecolor=COLORS["bvc_upfront"], label="Экономия на задаче"),
            Patch(facecolor="#EF4444", label="Перерасход BVC"),
        ],
        frameon=False,
        ncol=2,
        loc="upper left",
    )
    savefig("fig_task_token_savings")

    # 14. Cost composition by token category.
    plt.figure(figsize=(7.1, 4.1))
    x = np.arange(len(METHODS))
    cached = np.array([component_costs[m]["cached_input_rub"] for m in METHODS])
    uncached = np.array([component_costs[m]["uncached_input_rub"] for m in METHODS])
    output = np.array([component_costs[m]["output_rub"] for m in METHODS])
    plt.bar(x, cached, color="#38BDF8", label="Кэшированный вход")
    plt.bar(x, uncached, bottom=cached, color="#0EA5E9", label="Некэшированный вход")
    plt.bar(x, output, bottom=cached + uncached, color="#7C3AED", label="Выход")
    for i, method in enumerate(METHODS):
        total = cached[i] + uncached[i] + output[i]
        plt.text(i, total + 35, f"{total:.0f} ₽", ha="center", fontsize=8.5, fontweight="bold")
    plt.xticks(x, [LABELS[m] for m in METHODS])
    plt.ylabel("Расчётная стоимость, ₽")
    plt.title("Структура стоимости основной матрицы по категориям токенов")
    plt.ylim(0, max(cached + uncached + output) * 1.14)
    plt.legend(frameon=False, ncol=3, fontsize=8)
    savefig("fig_cost_components")

    # 15. Gate rate by difficulty stratum. A dot-and-interval plot avoids
    # visually giving the n=3 stratum the same weight as n=27-30 strata.
    strata = ["medium", "hard", "very_hard"]
    values = [gate_by_stratum[s]["critique_rate"] * 100 for s in strata]
    intervals = [
        wilson_interval(
            gate_by_stratum[stratum]["critique_tasks"],
            gate_by_stratum[stratum]["tasks"],
        )
        for stratum in strata
    ]
    lower_errors = [
        value - interval[0] * 100 for value, interval in zip(values, intervals)
    ]
    upper_errors = [
        interval[1] * 100 - value for value, interval in zip(values, intervals)
    ]
    labels = ["Средние (n=30)", "Сложные (n=27)", "Очень сложные (n=3)"]
    y = np.arange(len(strata))
    plt.figure(figsize=(6.8, 3.8))
    for index, stratum in enumerate(strata):
        plt.errorbar(
            values[index],
            y[index],
            xerr=[[lower_errors[index]], [upper_errors[index]]],
            fmt="o",
            markersize=6 + math.sqrt(gate_by_stratum[stratum]["tasks"]),
            color=["#14B8A6", "#7C3AED", "#F59E0B"][index],
            ecolor="#334155",
            capsize=4,
            linewidth=1.5,
        )
        plt.text(
            min(96, intervals[index][1] * 100 + 2),
            y[index],
            (
                f"{gate_by_stratum[stratum]['critique_tasks']}/"
                f"{gate_by_stratum[stratum]['tasks']} ({values[index]:.1f}%)"
            ),
            va="center",
            fontsize=8.5,
        )
    plt.yticks(y, labels)
    plt.xlabel("Доля задач с критикой, %")
    plt.title("Частота расширенного маршрута по стратам сложности")
    plt.xlim(0, 115)
    plt.gca().invert_yaxis()
    plt.figtext(
        0.5,
        -0.02,
        "Линии: 95% Wilson CI; площадь маркера отражает размер страты.",
        ha="center",
        fontsize=8.5,
        color="#475569",
    )
    savefig("fig_gate_by_difficulty")

    # 16. Post-hoc threshold sensitivity. Outcomes are not reinterpreted;
    # this figure only shows how the frozen diagnostics would change routing.
    threshold_grid = np.linspace(0.0, 1.0, 101)

    def routed_count(tau_vote: float, tau_cov: float) -> int:
        return sum(
            metric["D_vote"] is None
            or metric["D_vote"] > tau_vote
            or metric["D_cov"] > tau_cov
            for metric in initial_gate_metrics
        )

    vote_counts = np.asarray([routed_count(value, 0.25) for value in threshold_grid])
    cov_counts = np.asarray([routed_count(0.30, value) for value in threshold_grid])
    fig, axes = plt.subplots(1, 2, figsize=(7.1, 3.8), sharey=True)
    for axis, counts, frozen, title in [
        (axes[0], vote_counts, 0.30, r"Меняется $\tau_{vote}$; $\tau_{cov}=0{,}25$"),
        (axes[1], cov_counts, 0.25, r"Меняется $\tau_{cov}$; $\tau_{vote}=0{,}30$"),
    ]:
        critique_rate = counts / 60 * 100
        call_savings = 40 * (1 - counts / 60)
        axis.step(threshold_grid, critique_rate, where="post", color=COLORS["bvc_upfront"], lw=1.8, label="Критика")
        axis.step(threshold_grid, call_savings, where="post", color="#14B8A6", lw=1.8, label="Экономия вызовов")
        axis.axvline(frozen, color="#F97316", ls="--", lw=1.2, label="Замороженный порог")
        axis.set_title(title, fontsize=9.5)
        axis.set_xlabel("Значение порога")
        axis.set_xlim(0, 1)
        axis.set_ylim(0, 100)
    axes[0].set_ylabel("Доля задач / экономия вызовов, %")
    axes[1].legend(frameon=False, fontsize=7.7, loc="upper right")
    fig.suptitle("Чувствительность маршрутизации к порогам (post hoc)", y=0.99)
    fig.text(
        0.5, -0.01,
        "Меняются только маршруты и аналитическая цена; функциональные outcomes не пересчитываются.",
        ha="center", fontsize=8, color="#475569",
    )
    fig.tight_layout(rect=(0, 0.05, 1, 0.93))
    savefig("fig_gate_sensitivity")

    # 17. Relation between total-token and tariff-weighted monetary savings.
    plt.figure(figsize=(7.1, 4.1))
    for route, color, label in [
        ("short", "#14B8A6", "Короткий маршрут"),
        ("extended", COLORS["bvc_upfront"], "Расширенный маршрут"),
    ]:
        rows = [row for row in paired_task_rows if row["route"] == route]
        plt.scatter(
            [row["tokens_saved"] / 1000 for row in rows],
            [row["cost_saved_rub"] for row in rows],
            s=32, alpha=0.75, color=color, edgecolor="white", linewidth=0.5,
            label=label,
        )
    plt.axhline(0, color="#64748B", lw=1)
    plt.axvline(0, color="#64748B", lw=1)
    plt.xlabel("Парная экономия всех токенов, тыс.")
    plt.ylabel("Парная экономия расчётной стоимости, руб.")
    plt.title("Одинаковое число токенов имеет разную цену по составу usage")
    plt.text(
        0.02, 0.97,
        (
            f"медианы: {paired_resource_savings['tokens']['median']/1000:.2f} тыс. токенов; "
            f"{paired_resource_savings['cost_rub']['median']:.2f} руб."
        ),
        transform=plt.gca().transAxes, va="top", fontsize=8.3,
        bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.85},
    )
    plt.legend(frameon=False, fontsize=8.5)
    savefig("fig_tokens_cost_relation")

    # 18. Paired resource savings with deterministic stratified bootstrap CIs.
    panels = [
        ("calls", "calls_saved", "Вызовы", 1.0),
        ("tokens", "tokens_saved", "Токены, тыс.", 1000.0),
        ("cost_rub", "cost_saved_rub", "Стоимость, ₽", 1.0),
    ]
    fig, axes = plt.subplots(1, 3, figsize=(7.1, 3.55))
    for axis, (metric, task_key, title, scale) in zip(axes, panels):
        summary = paired_resource_savings[metric]
        mean = summary["mean"] / scale
        low = summary["mean_bootstrap_95"]["lower"] / scale
        high = summary["mean_bootstrap_95"]["upper"] / scale
        task_values = np.asarray([row[task_key] / scale for row in paired_task_rows])
        sorted_values = np.sort(task_values)
        x_jitter = np.linspace(-0.18, 0.18, len(sorted_values))
        axis.axhline(0, color="#64748B", linewidth=1)
        axis.scatter(
            x_jitter,
            sorted_values,
            s=13,
            alpha=0.45,
            color=["#EF4444" if value < 0 else "#A78BFA" for value in sorted_values],
            edgecolor="none",
            zorder=2,
        )
        axis.errorbar(
            [0],
            [mean],
            yerr=[[mean - low], [high - mean]],
            fmt="o",
            color=COLORS["bvc_upfront"],
            ecolor="#334155",
            markersize=8,
            capsize=5,
            linewidth=1.8,
            zorder=4,
        )
        axis.set_xlim(-0.32, 0.32)
        lower_limit = min(float(np.min(task_values)), low, 0.0)
        upper_limit = max(float(np.max(task_values)), high)
        padding = max((upper_limit - lower_limit) * 0.12, 0.2)
        axis.set_ylim(lower_limit - padding, upper_limit + padding)
        axis.set_xticks([])
        axis.set_title(title, fontsize=10, pad=8)
        axis.text(
            0.5,
            0.88,
            f"{mean:.2f}\n[{low:.2f}; {high:.2f}]",
            transform=axis.transAxes,
            ha="center",
            va="center",
            fontsize=8.5,
            fontweight="bold",
            bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.88, "pad": 1.5},
        )
        axis.text(
            0.5,
            0.03,
            f"медиана {summary['median'] / scale:.2f}",
            transform=axis.transAxes,
            ha="center",
            va="bottom",
            fontsize=8,
            color="#475569",
        )
    fig.suptitle(
        "Средняя парная экономия на задачу: полный совет − BVC",
        fontsize=12,
        y=0.99,
    )
    fig.text(
        0.5,
        -0.01,
        "Малые точки: 60 пар; крупная точка: среднее; линия: 95% стратифицированный bootstrap-интервал.",
        ha="center",
        fontsize=8.3,
        color="#475569",
    )
    fig.tight_layout(rect=(0, 0.05, 1, 0.88))
    savefig("fig_resource_paired_effects")

    print(f"Generated {len(list(FIGURES.glob('*.pdf')))} vector figures")
    print(f"Derived metrics: {DERIVED / 'derived_metrics.json'}")


if __name__ == "__main__":
    main()

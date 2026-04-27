#!/usr/bin/env python3
"""BVC runner - formal Budgeted Verified Council planning algorithm.

This runner is intentionally separate from council_runner.py. Council is a
free-form discussion. BVC uses fixed decision axes, parse validation,
disagreement metrics, budget guards, adaptive critique, and early-fail checks.
"""

import argparse
import asyncio
import json
import math
import os
import re
import sys
from collections import Counter
from typing import Any

from autogen_core.models import UserMessage

from bvc_agents import AGENT_PROMPTS, DEFAULT_MODELS, create_agents
from config import create_openrouter_client


AXES = [
    "root_cause_location",
    "fix_strategy",
    "dependencies_to_update",
    "test_coverage",
]

TAU_VOTE = 0.3
TAU_CRIT = 0.7
TAU_COV_BASE = 0.5
K_MAX_BY_DIFFICULTY = {"easy": 0, "medium": 1, "hard": 2}
BUDGET_MULTIPLIER = {"easy": 1, "medium": 2, "hard": 3}
B_RES = 1
BOT_MARKERS = {"", "bot", "[parse_failure]", "parse_failure", "[error]", "error"}


def emit(agent: str, content: str, phase: str = "discussion", **extra: Any) -> None:
    data = {"agent": agent, "content": content, "phase": phase}
    data.update(extra)
    print(json.dumps(data, ensure_ascii=False), flush=True)


def adaptive_tau_cov(num_agents: int) -> float:
    return min(TAU_COV_BASE + 0.12 * (num_agents - 2), 0.85)


def normalize_value(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    lower = trimmed.lower()
    if lower in BOT_MARKERS:
        return None
    if lower in {"na", "n/a", "not applicable"}:
        return "NA"
    if len(trimmed) > 240:
        return None
    return trimmed


def normalize_cluster(value: str) -> str:
    if value == "NA":
        return "NA"
    return re.sub(r"\s+", " ", value.lower().strip())


def parse_bvc_decisions(text: str) -> dict[str, str | None]:
    """Parse strict BVC decisions. None means bot/parse failure."""
    candidates = []
    for match in re.finditer(r"```(?:json)?\s*([\s\S]*?)```", text, re.I):
        candidates.append(match.group(1))
    candidates.append(text)

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue

        decisions = parsed.get("bvc_decisions") if isinstance(parsed, dict) else None
        if not isinstance(decisions, dict):
            decisions = parsed if isinstance(parsed, dict) else None
        if not isinstance(decisions, dict):
            continue

        if set(decisions.keys()) != set(AXES):
            continue

        return {axis: normalize_value(decisions.get(axis)) for axis in AXES}

    return {axis: None for axis in AXES}


def compute_disagreement(
    decisions_by_role: dict[str, dict[str, str | None]],
    roles: list[str],
) -> dict[str, Any]:
    """Compute BVC metrics using the thesis formulas.

    d_vote(t) = (m_t - max_c n_tc) / (m_t - 1), when m_t >= 2.
    D_vote is undefined when no axis has at least two valid votes.
    D_cov = 1 - sum_t m_t / (|T0| R).
    """
    R = max(len(roles), 1)
    axis_stats = {}
    t_ge2: list[str] = []
    d_votes: list[float] = []
    valid_vote_total = 0

    for axis in AXES:
        votes = [
            decisions_by_role.get(role, {}).get(axis)
            for role in roles
            if decisions_by_role.get(role, {}).get(axis) is not None
        ]
        m_t = len(votes)
        valid_vote_total += m_t

        counts = Counter(normalize_cluster(vote) for vote in votes if vote is not None)
        d_vote = None
        if m_t >= 2:
            t_ge2.append(axis)
            d_vote = (m_t - max(counts.values())) / (m_t - 1)
            d_votes.append(d_vote)

        axis_stats[axis] = {
            "m": m_t,
            "d_vote": None if d_vote is None else round(d_vote, 4),
            "d_cov": round(1 - m_t / R, 4),
            "vote_counts": dict(counts),
        }

    d_vote_total = None if not d_votes else sum(d_votes) / len(d_votes)
    d_cov_total = 1 - valid_vote_total / (len(AXES) * R)

    return {
        "D_vote": None if d_vote_total is None else round(d_vote_total, 4),
        "D_cov": round(d_cov_total, 4),
        "T_ge2": t_ge2,
        "axis_stats": axis_stats,
    }


def can_critique(
    metrics: dict[str, Any],
    tau_cov: float,
    k: int,
    k_max: int,
    b: int,
    R: int,
    B: int,
) -> bool:
    d_vote = metrics["D_vote"]
    return (
        bool(metrics["T_ge2"])
        and metrics["D_cov"] <= tau_cov
        and d_vote is not None
        and d_vote > TAU_VOTE
        and k < k_max
        and b + R + B_RES <= B
    )


async def call_model(api_key: str, model_id: str, prompt: str) -> str:
    client = create_openrouter_client(api_key, model_id)
    response = await client.create([UserMessage(content=prompt, source="user")])
    return response.content if isinstance(response.content, str) else str(response.content)


def analysis_prompt(role: str, task: str) -> str:
    return f"""{AGENT_PROMPTS[role]}

Задача: {task}

Ты работаешь в строгом BVC-режиме. Верни только эти четыре оси.
Если ось неприменима, используй "NA". Если значение невозможно получить, используй "[PARSE_FAILURE]".

Ответь strict JSON:
```json
{{
  "bvc_decisions": {{
    "root_cause_location": "value or NA",
    "fix_strategy": "value or NA",
    "dependencies_to_update": "value or NA",
    "test_coverage": "value or NA"
  }}
}}
```"""


def critique_prompt(role: str, task: str, snapshot: str, round_number: int) -> str:
    return f"""{AGENT_PROMPTS[role]}

Задача: {task}

BVC critique round {round_number}. Ниже snapshot решений всех ролей:
{snapshot}

Обнови свои решения по тем же четырем осям. Верни strict JSON:
```json
{{
  "bvc_decisions": {{
    "root_cause_location": "value, NA, or [PARSE_FAILURE]",
    "fix_strategy": "value, NA, or [PARSE_FAILURE]",
    "dependencies_to_update": "value, NA, or [PARSE_FAILURE]",
    "test_coverage": "value, NA, or [PARSE_FAILURE]"
  }}
}}
```"""


def synthesis_prompt(task: str, history: str, metrics: dict[str, Any]) -> str:
    return f"""Ты - синтезатор BVC. Составь финальный план по результатам строгого BVC.

Задача: {task}

История:
{history}

Метрики:
- D_vote: {metrics["D_vote"]}
- D_cov: {metrics["D_cov"]}
- T_ge2: {metrics["T_ge2"]}

Формат:
# BVC Project Plan

## Description

## Disputed Decisions

## File Structure

## File Descriptions

## Implementation Order

## Technologies
"""


def snapshot(decisions_by_role: dict[str, dict[str, str | None]], roles: list[str]) -> str:
    lines = []
    for role in roles:
        lines.append(f"### {role}")
        for axis in AXES:
            value = decisions_by_role.get(role, {}).get(axis)
            lines.append(f"- {axis}: {value if value is not None else '[PARSE_FAILURE]'}")
    return "\n".join(lines)


async def run_bvc(
    task: str,
    api_key: str,
    models: dict[str, str] | None = None,
    difficulty: str = "medium",
    save_discussion: bool = False,
    output_dir: str = ".",
) -> None:
    model_map = {**DEFAULT_MODELS, **(models or {})}
    agents = create_agents(api_key, model_map)
    roles = [agent.name for agent in agents]
    R = len(roles)
    k_max = K_MAX_BY_DIFFICULTY.get(difficulty, K_MAX_BY_DIFFICULTY["medium"])
    B = R * BUDGET_MULTIPLIER.get(difficulty, BUDGET_MULTIPLIER["medium"]) + B_RES
    tau_cov = adaptive_tau_cov(R)
    b = 0
    history: list[dict[str, str]] = []
    decisions_by_role: dict[str, dict[str, str | None]] = {}

    emit("system", f"BVC started. R={R}, B={B}, K_max={k_max}, tau_cov={tau_cov:.2f}", "metrics")

    if b + R > B:
        emit("system", "Budget too small for analysis.", "error")
        return

    b += R
    for role in roles:
        emit("system", f"Phase 1: {role} analyzing", "analysis")
        content = await call_model(api_key, model_map[role], analysis_prompt(role, task))
        decisions_by_role[role] = parse_bvc_decisions(content)
        history.append({"agent": role, "phase": "analysis", "content": content})
        emit(role, content, "analysis")

    metrics = compute_disagreement(decisions_by_role, roles)
    emit("system", "Initial disagreement computed", "metrics", metrics=metrics)

    k = 0
    while can_critique(metrics, tau_cov, k, k_max, b, R, B):
        current_snapshot = snapshot(decisions_by_role, roles)
        b += R
        k += 1
        for role in roles:
            emit("system", f"Phase 2: {role} critique round {k}", "critique")
            content = await call_model(
                api_key,
                model_map[role],
                critique_prompt(role, task, current_snapshot, k),
            )
            decisions_by_role[role] = parse_bvc_decisions(content)
            history.append({"agent": role, "phase": "critique", "content": content})
            emit(role, content, "critique")

        metrics = compute_disagreement(decisions_by_role, roles)
        emit("system", f"After critique round {k}", "metrics", metrics=metrics)

    d_vote = metrics["D_vote"]
    if not metrics["T_ge2"]:
        emit("system", "Early-fail: no axis has at least two valid votes.", "error", metrics=metrics)
        return
    if metrics["D_cov"] > tau_cov:
        emit("system", f"Early-fail: D_cov={metrics['D_cov']} > tau_cov={tau_cov:.2f}.", "error", metrics=metrics)
        return
    if d_vote is not None and d_vote > TAU_CRIT:
        emit("system", f"Early-fail: D_vote={d_vote} > tau_crit={TAU_CRIT}.", "error", metrics=metrics)
        return
    if b + B_RES > B:
        emit("system", f"Early-fail: no budget for synthesis, b={b}, B={B}.", "error", metrics=metrics)
        return

    b += B_RES
    full_history = "\n\n".join(
        f"## {item['phase']} - {item['agent']}\n{item['content']}" for item in history
    )
    plan = await call_model(api_key, model_map[roles[0]], synthesis_prompt(task, full_history, metrics))
    emit("system", plan, "plan", metrics=metrics, budget_used=b, budget=B)

    if save_discussion:
        os.makedirs(output_dir, exist_ok=True)
        with open(os.path.join(output_dir, "bvc-discussion.md"), "w", encoding="utf-8") as file:
            file.write(full_history)
        with open(os.path.join(output_dir, "bvc-plan.md"), "w", encoding="utf-8") as file:
            file.write(plan)


def main() -> None:
    parser = argparse.ArgumentParser(description="Xynapse BVC Runner")
    parser.add_argument("--task", required=True)
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--models", default="{}")
    parser.add_argument("--difficulty", choices=["easy", "medium", "hard"], default="medium")
    parser.add_argument("--save-discussion", action="store_true")
    parser.add_argument("--output-dir", default=".")
    args = parser.parse_args()

    try:
        models = json.loads(args.models)
    except json.JSONDecodeError:
        emit("system", "Invalid JSON in --models", "error")
        sys.exit(1)

    asyncio.run(
        run_bvc(
            task=args.task,
            api_key=args.api_key,
            models=models if models else None,
            difficulty=args.difficulty,
            save_discussion=args.save_discussion,
            output_dir=args.output_dir,
        )
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Council runner - AutoGen SelectorGroupChat for free-form project planning.

Usage:
    python council_runner.py --task "project description" --api-key "sk-..." \
        [--models '{"PM":"..."}'] [--max-messages 20]

Output: NDJSON lines to stdout:
    {"agent": "PM", "content": "...", "phase": "discussion"}
    {"agent": "system", "content": "...", "phase": "complete"}
"""

import argparse
import asyncio
import json
import sys

from autogen_agentchat.conditions import MaxMessageTermination, TextMentionTermination
from autogen_agentchat.teams import SelectorGroupChat

from agents import create_agents
from config import create_openrouter_client


SELECTOR_PROMPT = """You moderate a multi-agent project-planning discussion.
Participants: {participants}

Speaker selection rules:
1. PM starts by clarifying requirements.
2. Architect proposes architecture after requirements are clear.
3. Developer comments on feasibility and implementation details.
4. Reviewer critiques risks, edge cases, and quality gaps.
5. After critique, PM summarizes and guides the discussion.
6. Do not let one agent speak twice in a row.
7. When the discussion converges, give PM the turn to finalize the plan.

Based on the message history, choose the next speaker.
Reply ONLY with the agent name: PM, Architect, Developer, or Reviewer."""


def emit(agent: str, content: str, phase: str = "discussion") -> None:
    """Print a single NDJSON line to stdout."""
    print(
        json.dumps(
            {"agent": agent, "content": content, "phase": phase},
            ensure_ascii=False,
        ),
        flush=True,
    )


async def run_council(
    task: str,
    api_key: str,
    models: "dict[str, str] | None" = None,
    max_messages: int = 20,
) -> None:
    """Run the free-form Council discussion and stream results as NDJSON."""
    try:
        agents = create_agents(api_key, models)
    except Exception as exc:
        emit("system", f"Agent creation failed: {exc}", "error")
        return

    selector_model = create_openrouter_client(api_key, "openai/gpt-4o-mini")
    termination = MaxMessageTermination(max_messages) | TextMentionTermination(
        "PLAN_APPROVED"
    )

    team = SelectorGroupChat(
        agents,
        model_client=selector_model,
        termination_condition=termination,
        selector_prompt=SELECTOR_PROMPT,
    )

    emit("system", f"Council started. Task: {task}", "discussion")

    try:
        stream = team.run_stream(task=f"User task: {task}")
        async for message in stream:
            if hasattr(message, "messages"):
                continue

            agent_name = getattr(message, "source", "system")
            content = getattr(message, "content", str(message))
            if not content or not content.strip():
                continue

            phase = "plan" if "PLAN_APPROVED" in content else "discussion"
            emit(agent_name, content, phase)

    except Exception as exc:
        emit("system", f"Execution failed: {exc}", "error")
        return

    emit("system", "Discussion complete.", "complete")


def main() -> None:
    parser = argparse.ArgumentParser(description="Xynapse Council Runner")
    parser.add_argument("--task", required=True, help="Task description")
    parser.add_argument("--api-key", required=True, help="OpenRouter API key")
    parser.add_argument(
        "--models",
        default="{}",
        help="JSON dict mapping role to model ID",
    )
    parser.add_argument(
        "--max-messages",
        type=int,
        default=20,
        help="Max messages before termination",
    )
    args = parser.parse_args()

    try:
        models = json.loads(args.models)
    except json.JSONDecodeError:
        emit("system", "Invalid JSON in --models", "error")
        sys.exit(1)

    asyncio.run(
        run_council(
            task=args.task,
            api_key=args.api_key,
            models=models if models else None,
            max_messages=args.max_messages,
        )
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Council runner — AutoGen SelectorGroupChat for multi-agent project planning.

Usage:
    python council_runner.py --task "описание проекта" --api-key "sk-..." [--models '{"PM":"..."}'] [--max-messages 20]

Output: NDJSON lines to stdout with format:
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


SELECTOR_PROMPT = """Ты модератор мульти-агентной дискуссии по планированию проекта.
Участники: {participants}

Правила выбора следующего спикера:
1. PM начинает обсуждение, уточняя требования.
2. Architect предлагает архитектуру после уточнения требований.
3. Developer комментирует реализуемость архитектуры.
4. Reviewer критикует и предлагает улучшения.
5. После критики PM суммирует и направляет обсуждение.
6. Не давай одному агенту говорить два раза подряд.
7. Когда дискуссия сходится, дай слово PM для финализации плана.

На основе истории сообщений, выбери кто должен говорить следующим.
Ответь ТОЛЬКО именем агента: PM, Architect, Developer или Reviewer."""


def emit(agent: str, content: str, phase: str = "discussion") -> None:
    """Print a single NDJSON line to stdout."""
    line = json.dumps(
        {"agent": agent, "content": content, "phase": phase},
        ensure_ascii=False,
    )
    print(line, flush=True)


async def run_council(
    task: str,
    api_key: str,
    models: "dict[str, str] | None" = None,
    max_messages: int = 20,
) -> None:
    """Run the council discussion and stream results as NDJSON."""
    try:
        agents = create_agents(api_key, models)
    except Exception as e:
        emit("system", f"Ошибка создания агентов: {e}", "error")
        return

    # Selector model — lightweight model for choosing next speaker
    selector_model = create_openrouter_client(api_key, "openai/gpt-4o-mini")

    # Termination conditions
    termination = MaxMessageTermination(max_messages) | TextMentionTermination(
        "PLAN_APPROVED"
    )

    team = SelectorGroupChat(
        agents,
        model_client=selector_model,
        termination_condition=termination,
        selector_prompt=SELECTOR_PROMPT,
    )

    emit("system", f"Council запущен. Задача: {task}", "discussion")

    try:
        stream = team.run_stream(task=f"Задача от пользователя: {task}")
        async for message in stream:
            # TaskResult is the final summary — skip it
            if hasattr(message, "messages"):
                continue
            # Regular agent messages
            agent_name = getattr(message, "source", "system")
            content = getattr(message, "content", str(message))
            if not content or not content.strip():
                continue

            phase = "discussion"
            if "PLAN_APPROVED" in content:
                phase = "plan"

            emit(agent_name, content, phase)

    except Exception as e:
        emit("system", f"Ошибка выполнения: {e}", "error")
        return

    emit("system", "Дискуссия завершена.", "complete")


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
        emit("system", "Невалидный JSON в --models", "error")
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

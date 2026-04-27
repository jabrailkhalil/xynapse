"""BVC agent definitions - fixed roles for the formal BVC algorithm."""

from autogen_agentchat.agents import AssistantAgent

from config import create_openrouter_client

AGENT_PROMPTS = {
    "Architect": (
        "Ты - Software Architect в команде BVC.\n"
        "Смотри на локализацию причины, архитектурные контракты, структуру файлов "
        "и технические риски. Возвращай решения по фиксированным осям BVC."
    ),
    "Developer": (
        "Ты - Senior Developer в команде BVC.\n"
        "Смотри на стратегию исправления, сложность реализации, зависимости "
        "и конкретные изменения в коде. Возвращай решения по фиксированным осям BVC."
    ),
    "Reviewer": (
        "Ты - Code Reviewer в команде BVC.\n"
        "Смотри на дефекты, безопасность, edge cases и проверяемость решения. "
        "Возвращай решения по фиксированным осям BVC."
    ),
    "Tester": (
        "Ты - QA Engineer в команде BVC.\n"
        "Смотри на тестовое покрытие, smoke/regression сценарии и критерии приемки. "
        "Возвращай решения по фиксированным осям BVC."
    ),
}

DEFAULT_MODELS = {
    "Architect": "anthropic/claude-sonnet-4-20250514",
    "Developer": "deepseek/deepseek-chat",
    "Reviewer": "anthropic/claude-sonnet-4-20250514",
    "Tester": "openai/gpt-4o-mini",
}


def create_agents(
    api_key: str,
    models: "dict[str, str] | None" = None,
) -> "list[AssistantAgent]":
    """Create the fixed-role BVC agents."""
    model_map = {**DEFAULT_MODELS, **(models or {})}

    agents = []
    for role, prompt in AGENT_PROMPTS.items():
        model_id = model_map.get(role, DEFAULT_MODELS[role])
        client = create_openrouter_client(api_key, model_id)
        agents.append(
            AssistantAgent(
                name=role,
                model_client=client,
                system_message=prompt,
            )
        )

    return agents

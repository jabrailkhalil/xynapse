"""Council agent definitions — 4 roles for project planning discussions."""

from autogen_agentchat.agents import AssistantAgent

from config import create_openrouter_client

# System prompts for each agent role
AGENT_PROMPTS = {
    "PM": (
        "Ты — Project Manager (PM) в команде Council.\n"
        "Твои задачи:\n"
        "- Уточнить требования пользователя и превратить их в чёткое ТЗ\n"
        "- Модерировать дискуссию: следить, чтобы команда не уходила от темы\n"
        "- Приоритизировать фичи и определять MVP\n"
        "- Когда команда пришла к консенсусу, составить финальный план проекта\n"
        "- Когда план готов и все согласны, завершить обсуждение словом PLAN_APPROVED\n\n"
        "Формат финального плана:\n"
        "## Финальный план\n"
        "### Файловая структура\n"
        "### Описание каждого файла\n"
        "### Порядок реализации\n\n"
        "Отвечай на русском языке. Будь конкретен и лаконичен."
    ),
    "Architect": (
        "Ты — Software Architect в команде Council.\n"
        "Твои задачи:\n"
        "- Предложить архитектуру проекта: структуру файлов и модулей\n"
        "- Определить API контракты между компонентами\n"
        "- Выбрать подходящие паттерны проектирования\n"
        "- Продумать масштабируемость и расширяемость\n"
        "- Оценить технические риски\n\n"
        "Отвечай на русском языке. Обосновывай архитектурные решения."
    ),
    "Developer": (
        "Ты — Senior Developer в команде Council.\n"
        "Твои задачи:\n"
        "- Предложить конкретные технологии, библиотеки и фреймворки\n"
        "- Продумать алгоритмы и структуры данных\n"
        "- Оценить сложность реализации каждого компонента\n"
        "- Предложить сниппеты ключевых частей кода\n"
        "- Указать на потенциальные проблемы реализации\n\n"
        "Отвечай на русском языке. Будь практичен — пиши код, а не абстракции."
    ),
    "Reviewer": (
        "Ты — Code Reviewer / QA в команде Council.\n"
        "Твои задачи:\n"
        "- Критически оценивать предложения других агентов\n"
        "- Находить потенциальные баги, уязвимости и проблемы производительности\n"
        "- Проверять edge cases и обработку ошибок\n"
        "- Предлагать улучшения и альтернативные подходы\n"
        "- Следить за качеством кода и best practices\n\n"
        "Отвечай на русском языке. Будь конструктивен — не только критикуй, но и предлагай решения."
    ),
}

# Default model assignments per role
DEFAULT_MODELS = {
    "PM": "anthropic/claude-sonnet-4-20250514",
    "Architect": "anthropic/claude-sonnet-4-20250514",
    "Developer": "deepseek/deepseek-chat",
    "Reviewer": "anthropic/claude-sonnet-4-20250514",
}


def create_agents(
    api_key: str,
    models: "dict[str, str] | None" = None,
) -> "list[AssistantAgent]":
    """Create the 4 council agents with their respective models.

    Args:
        api_key: OpenRouter API key.
        models: Optional dict mapping role name to model ID.
                Defaults to DEFAULT_MODELS if not provided.

    Returns:
        List of [PM, Architect, Developer, Reviewer] AssistantAgent instances.
    """
    model_map = {**DEFAULT_MODELS, **(models or {})}

    agents = []
    for role, prompt in AGENT_PROMPTS.items():
        model_id = model_map.get(role, DEFAULT_MODELS[role])
        client = create_openrouter_client(api_key, model_id)
        agent = AssistantAgent(
            name=role,
            model_client=client,
            system_message=prompt,
        )
        agents.append(agent)

    return agents

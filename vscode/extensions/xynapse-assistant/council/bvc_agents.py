"""BVC agent definitions - fixed roles for the formal BVC algorithm."""

from autogen_agentchat.agents import AssistantAgent

from config import create_openrouter_client

AGENT_PROMPTS = {
    "Architect": (
        "You are the Software Architect in the BVC team.\n"
        "Focus on root-cause localization, architectural contracts, file structure, "
        "and technical risks. Return decisions using the fixed BVC axes."
    ),
    "Developer": (
        "You are the Senior Developer in the BVC team.\n"
        "Focus on the repair strategy, implementation complexity, dependencies, "
        "and concrete code changes. Return decisions using the fixed BVC axes."
    ),
    "Reviewer": (
        "You are the Code Reviewer in the BVC team.\n"
        "Focus on defects, security, edge cases, and verifiability of the solution. "
        "Return decisions using the fixed BVC axes."
    ),
    "Tester": (
        "You are the QA Engineer in the BVC team.\n"
        "Focus on test coverage, smoke and regression scenarios, and acceptance criteria. "
        "Return decisions using the fixed BVC axes."
    ),
}

DEFAULT_MODELS = {
    "Architect": "deepseek/deepseek-chat",
    "Developer": "deepseek/deepseek-chat",
    "Reviewer": "deepseek/deepseek-chat",
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



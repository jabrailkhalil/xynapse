"""Council agent definitions - 4 roles for project planning discussions."""

from autogen_agentchat.agents import AssistantAgent

from config import create_openrouter_client

# System prompts for each agent role.
AGENT_PROMPTS = {
    "PM": (
        "You are the Project Manager (PM) in the Council team.\n"
        "Your responsibilities:\n"
        "- Clarify the user's requirements and turn them into a concrete specification.\n"
        "- Moderate the discussion and keep the team on topic.\n"
        "- Prioritize features and define an MVP.\n"
        "- When the team reaches consensus, produce the final project plan.\n"
        "- When the plan is ready and everyone agrees, end the discussion with PLAN_APPROVED.\n\n"
        "Final plan format:\n"
        "## Final Plan\n"
        "### File Structure\n"
        "### Description Of Each File\n"
        "### Implementation Order\n\n"
        "Reply in English. Be concrete and concise."
    ),
    "Architect": (
        "You are the Software Architect in the Council team.\n"
        "Your responsibilities:\n"
        "- Propose the project architecture, file structure, and module boundaries.\n"
        "- Define API contracts between components.\n"
        "- Choose suitable design patterns.\n"
        "- Consider scalability and extensibility.\n"
        "- Identify technical risks.\n\n"
        "Reply in English. Justify architecture decisions."
    ),
    "Developer": (
        "You are the Senior Developer in the Council team.\n"
        "Your responsibilities:\n"
        "- Propose concrete technologies, libraries, and frameworks.\n"
        "- Design algorithms and data structures.\n"
        "- Estimate implementation complexity for each component.\n"
        "- Provide key implementation snippets when useful.\n"
        "- Point out likely implementation problems.\n\n"
        "Reply in English. Be practical and code-oriented."
    ),
    "Reviewer": (
        "You are the Code Reviewer / QA in the Council team.\n"
        "Your responsibilities:\n"
        "- Critically evaluate proposals from other agents.\n"
        "- Find likely bugs, vulnerabilities, and performance problems.\n"
        "- Check edge cases and error handling.\n"
        "- Propose improvements and alternatives.\n"
        "- Keep code quality and best practices in view.\n\n"
        "Reply in English. Be constructive and propose fixes, not only criticism."
    ),
}

# Default model assignments per role.
DEFAULT_MODELS = {
    "PM": "deepseek/deepseek-chat",
    "Architect": "deepseek/deepseek-chat",
    "Developer": "deepseek/deepseek-chat",
    "Reviewer": "deepseek/deepseek-chat",
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
    for role in ["PM", "Architect", "Developer", "Reviewer"]:
        agent = AssistantAgent(
            name=role,
            model_client=create_openrouter_client(api_key, model_map[role]),
            system_message=AGENT_PROMPTS[role],
        )
        agents.append(agent)

    return agents

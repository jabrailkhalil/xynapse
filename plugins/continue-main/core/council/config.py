"""OpenRouter client factory for AutoGen agents."""

from autogen_ext.models.openai import OpenAIChatCompletionClient


def create_openrouter_client(api_key: str, model: str) -> OpenAIChatCompletionClient:
    """Create an OpenAIChatCompletionClient configured for OpenRouter.

    Uses base model names to work around AutoGen issue #6502
    where model_info lookup fails for provider-prefixed names.
    """
    # Map OpenRouter model IDs to base names for model_info compatibility
    base_model_map = {
        "anthropic/claude-sonnet-4-20250514": "claude-sonnet-4-20250514",
        "anthropic/claude-sonnet-4": "claude-sonnet-4-20250514",
        "deepseek/deepseek-chat": "deepseek-chat",
        "google/gemini-2.0-flash-001": "gemini-2.0-flash",
        "openai/gpt-4o": "gpt-4o",
        "openai/gpt-4o-mini": "gpt-4o-mini",
    }

    # Use base name for model_info, but pass actual model to API
    base_name = base_model_map.get(model, model)

    return OpenAIChatCompletionClient(
        model=model,
        api_key=api_key,
        base_url="https://openrouter.ai/api/v1",
        model_info={
            "vision": False,
            "function_calling": True,
            "json_output": True,
            "family": base_name,
        },
    )

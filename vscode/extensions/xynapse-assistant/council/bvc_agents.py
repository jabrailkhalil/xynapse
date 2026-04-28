"""BVC agent definitions - fixed roles for the formal BVC algorithm."""

from autogen_agentchat.agents import AssistantAgent

from config import create_openrouter_client

AGENT_PROMPTS = {
    "Architect": (
        "РўС‹ - Software Architect РІ РєРѕРјР°РЅРґРµ BVC.\n"
        "РЎРјРѕС‚СЂРё РЅР° Р»РѕРєР°Р»РёР·Р°С†РёСЋ РїСЂРёС‡РёРЅС‹, Р°СЂС…РёС‚РµРєС‚СѓСЂРЅС‹Рµ РєРѕРЅС‚СЂР°РєС‚С‹, СЃС‚СЂСѓРєС‚СѓСЂСѓ С„Р°Р№Р»РѕРІ "
        "Рё С‚РµС…РЅРёС‡РµСЃРєРёРµ СЂРёСЃРєРё. Р’РѕР·РІСЂР°С‰Р°Р№ СЂРµС€РµРЅРёСЏ РїРѕ С„РёРєСЃРёСЂРѕРІР°РЅРЅС‹Рј РѕСЃСЏРј BVC."
    ),
    "Developer": (
        "РўС‹ - Senior Developer РІ РєРѕРјР°РЅРґРµ BVC.\n"
        "РЎРјРѕС‚СЂРё РЅР° СЃС‚СЂР°С‚РµРіРёСЋ РёСЃРїСЂР°РІР»РµРЅРёСЏ, СЃР»РѕР¶РЅРѕСЃС‚СЊ СЂРµР°Р»РёР·Р°С†РёРё, Р·Р°РІРёСЃРёРјРѕСЃС‚Рё "
        "Рё РєРѕРЅРєСЂРµС‚РЅС‹Рµ РёР·РјРµРЅРµРЅРёСЏ РІ РєРѕРґРµ. Р’РѕР·РІСЂР°С‰Р°Р№ СЂРµС€РµРЅРёСЏ РїРѕ С„РёРєСЃРёСЂРѕРІР°РЅРЅС‹Рј РѕСЃСЏРј BVC."
    ),
    "Reviewer": (
        "РўС‹ - Code Reviewer РІ РєРѕРјР°РЅРґРµ BVC.\n"
        "РЎРјРѕС‚СЂРё РЅР° РґРµС„РµРєС‚С‹, Р±РµР·РѕРїР°СЃРЅРѕСЃС‚СЊ, edge cases Рё РїСЂРѕРІРµСЂСЏРµРјРѕСЃС‚СЊ СЂРµС€РµРЅРёСЏ. "
        "Р’РѕР·РІСЂР°С‰Р°Р№ СЂРµС€РµРЅРёСЏ РїРѕ С„РёРєСЃРёСЂРѕРІР°РЅРЅС‹Рј РѕСЃСЏРј BVC."
    ),
    "Tester": (
        "РўС‹ - QA Engineer РІ РєРѕРјР°РЅРґРµ BVC.\n"
        "РЎРјРѕС‚СЂРё РЅР° С‚РµСЃС‚РѕРІРѕРµ РїРѕРєСЂС‹С‚РёРµ, smoke/regression СЃС†РµРЅР°СЂРёРё Рё РєСЂРёС‚РµСЂРёРё РїСЂРёРµРјРєРё. "
        "Р’РѕР·РІСЂР°С‰Р°Р№ СЂРµС€РµРЅРёСЏ РїРѕ С„РёРєСЃРёСЂРѕРІР°РЅРЅС‹Рј РѕСЃСЏРј BVC."
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



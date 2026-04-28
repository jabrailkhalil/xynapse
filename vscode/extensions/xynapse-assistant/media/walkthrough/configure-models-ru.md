# РќР°СЃС‚СЂРѕР№С‚Рµ AI-РјРѕРґРµР»Рё

Xynapse РїРѕРґРґРµСЂР¶РёРІР°РµС‚ Р»СЋР±С‹Рµ OpenAI-СЃРѕРІРјРµСЃС‚РёРјС‹Рµ РїСЂРѕРІР°Р№РґРµСЂС‹, Р° С‚Р°РєР¶Рµ YandexGPT Рё GigaChat.

## Р¤Р°Р№Р» РєРѕРЅС„РёРіСѓСЂР°С†РёРё

РћС‚РєСЂРѕР№С‚Рµ `~/.xynapse/config.yaml` Рё РґРѕР±Р°РІСЊС‚Рµ РјРѕРґРµР»Рё:

```yaml
models:
  - title: GPT-4o
    provider: openai
    model: gpt-4o
    apiKey: sk-...
    roles: [chat, edit]

  - title: YandexGPT Pro
    provider: yandex
    model: yandexgpt/latest
    folderId: b1g...
    apiKey: РІР°С€-РєР»СЋС‡
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: РІР°С€-id
    clientSecret: РІР°С€-СЃРµРєСЂРµС‚
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## Р РѕР»Рё РјРѕРґРµР»РµР№

РљР°Р¶РґР°СЏ РјРѕРґРµР»СЊ РЅР°Р·РЅР°С‡Р°РµС‚СЃСЏ РЅР° СЂРѕР»Рё:
- **chat** вЂ” РґРёР°Р»РѕРі СЃ Р°СЃСЃРёСЃС‚РµРЅС‚РѕРј
- **edit** вЂ” РіРµРЅРµСЂР°С†РёСЏ РёРЅСЃС‚СЂСѓРєС†РёР№ СЂРµРґР°РєС‚РёСЂРѕРІР°РЅРёСЏ
- **apply** вЂ” РїСЂРёРјРµРЅРµРЅРёРµ РёР·РјРµРЅРµРЅРёР№ Рє РєРѕРґСѓ
- **autocomplete** вЂ” РїРѕРґСЃРєР°Р·РєРё РїСЂРё РІРІРѕРґРµ (Tab)
- **summarize** вЂ” СЃР¶Р°С‚РёРµ РєРѕРЅС‚РµРєСЃС‚Р°

## РЎРѕРІРµС‚

РСЃРїРѕР»СЊР·СѓР№С‚Рµ Р±С‹СЃС‚СЂСѓСЋ РјРѕРґРµР»СЊ РґР»СЏ `autocomplete` (GPT-4o-mini, Р»РѕРєР°Р»СЊРЅР°СЏ РјРѕРґРµР»СЊ) Рё РјРѕС‰РЅСѓСЋ РґР»СЏ `chat` Рё `edit` (GPT-4o, YandexGPT Pro).


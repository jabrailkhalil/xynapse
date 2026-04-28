# РќР°Р»Р°С€С‚СѓР№С‚Рµ AI-РјРѕРґРµР»i

Xynapse РїiРґС‚СЂРёРјСѓС” Р±СѓРґСЊ-СЏРєi OpenAI-СЃСѓРјiСЃРЅi РїСЂРѕРІР°Р№РґРµСЂРё, Р° С‚Р°РєРѕР¶ YandexGPT С‚Р° GigaChat.

## Р¤Р°Р№Р» РєРѕРЅС„iРіСѓСЂР°С†iС—

Р’iРґРєСЂРёР№С‚Рµ `~/.xynapse/config.yaml` С‚Р° РґРѕРґР°Р№С‚Рµ РјРѕРґРµР»i:

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

## Р РѕР»i РјРѕРґРµР»РµР№

РљРѕР¶РЅР° РјРѕРґРµР»СЊ РїСЂРёР·РЅР°С‡Р°С”С‚СЊСЃСЏ РЅР° СЂРѕР»i:
- **chat** вЂ” РґiР°Р»РѕРі Р· Р°СЃРёСЃС‚РµРЅС‚РѕРј
- **edit** вЂ” РіРµРЅРµСЂР°С†iСЏ iРЅСЃС‚СЂСѓРєС†iР№ СЂРµРґР°РіСѓРІР°РЅРЅСЏ
- **apply** вЂ” Р·Р°СЃС‚РѕСЃСѓРІР°РЅРЅСЏ Р·РјiРЅ РґРѕ РєРѕРґСѓ
- **autocomplete** вЂ” РїiРґРєР°Р·РєРё РїСЂРё РІРІРµРґРµРЅРЅi (Tab)
- **summarize** вЂ” СЃС‚РёСЃРЅРµРЅРЅСЏ РєРѕРЅС‚РµРєСЃС‚Сѓ

## РџРѕСЂР°РґР°

Р’РёРєРѕСЂРёСЃС‚РѕРІСѓР№С‚Рµ С€РІРёРґРєСѓ РјРѕРґРµР»СЊ РґР»СЏ `autocomplete` (GPT-4o-mini, Р»РѕРєР°Р»СЊРЅР° РјРѕРґРµР»СЊ) С‚Р° РїРѕС‚СѓР¶РЅСѓ РґР»СЏ `chat` С‚Р° `edit` (GPT-4o, YandexGPT Pro).


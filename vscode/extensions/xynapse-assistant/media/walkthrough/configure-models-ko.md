# AI лЄЁлЌё кµ¬м„±

XynapseлЉ” лЄЁл“  OpenAI нён™ кіµкё‰мћђм™Ђ YandexGPT, GigaChatмќ„ м§Ђм›ђн•©л‹€л‹¤.

## кµ¬м„± нЊЊмќј

`~/.xynapse/config.yaml`мќ„ м—ґкі  лЄЁлЌёмќ„ м¶”к°Ђн•м„ёмљ”:

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
    apiKey: к·Ђн•мќ-н‚¤
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: к·Ђн•мќ-id
    clientSecret: к·Ђн•мќ-м‹њнЃ¬л¦ї
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## лЄЁлЌё м—­н• 

к°Ѓ лЄЁлЌёмќЂ м—­н• м—ђ н• л‹№лђ©л‹€л‹¤:
- **chat** вЂ” м–ґм‹њмЉ¤н„ґнЉём™Ђмќ лЊЂн™”
- **edit** вЂ” нЋём§‘ м§Ђм‹њ мѓќм„±
- **apply** вЂ” мЅ”л“њм—ђ ліЂкІЅ м Ѓмљ©
- **autocomplete** вЂ” мќёлќјмќё м њм•€ (Tab)
- **summarize** вЂ” м»Ён…ЌмЉ¤нЉё м••м¶•

## нЊЃ

`autocomplete`м—ђлЉ” л№ лҐё лЄЁлЌё(GPT-4o-mini, лЎњм»¬ лЄЁлЌё)мќ„, `chat`кіј `edit`м—ђлЉ” к°•л Ґн•њ лЄЁлЌё(GPT-4o, YandexGPT Pro)мќ„ м‚¬мљ©н•м„ёмљ”.


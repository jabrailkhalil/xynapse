# й…ЌзЅ® AI жЁЎећ‹

Xynapse ж”ЇжЊЃд»»дЅ• OpenAI е…је®№зљ„жЏђдѕ›е•†пјЊд»ҐеЏЉ YandexGPT е’Њ GigaChatгЂ‚

## й…ЌзЅ®ж–‡д»¶

ж‰“ејЂ `~/.xynapse/config.yaml` е№¶ж·»еЉ ж‚Ёзљ„жЁЎећ‹пјљ

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
    apiKey: ж‚Ёзљ„еЇ†й’Ґ
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: ж‚Ёзљ„ID
    clientSecret: ж‚Ёзљ„еЇ†й’Ґ
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## жЁЎећ‹и§’и‰І

жЇЏдёЄжЁЎећ‹иў«е€†й…Ќе€°и§’и‰Іпјљ
- **chat** вЂ” дёЋеЉ©ж‰‹еЇ№иЇќ
- **edit** вЂ” з”џж€ђзј–иѕ‘жЊ‡д»¤
- **apply** вЂ” е°†ж›ґж”№еє”з”Ёе€°д»Јз Ѓ
- **autocomplete** вЂ” е†…иЃ”е»єи®®пј€Tabпј‰
- **summarize** вЂ” дёЉдё‹ж–‡еЋ‹зј©

## жЏђз¤є

дЅїз”Ёеї«йЂџжЁЎећ‹з”ЁдєЋ `autocomplete`пј€GPT-4o-miniгЂЃжњ¬ењ°жЁЎећ‹пј‰пјЊдЅїз”Ёејєе¤§жЁЎећ‹з”ЁдєЋ `chat` е’Њ `edit`пј€GPT-4oгЂЃYandexGPT Proпј‰гЂ‚


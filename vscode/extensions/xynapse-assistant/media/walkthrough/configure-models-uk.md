# Налаштуйте AI-моделi

Xynapse пiдтримує будь-якi OpenAI-сумiснi провайдери, а також YandexGPT та GigaChat.

## Файл конфiгурацiї

Вiдкрийте `~/.xynapse/config.yaml` та додайте моделi:

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
    apiKey: ваш-ключ
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: ваш-id
    clientSecret: ваш-секрет
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## Ролi моделей

Кожна модель призначається на ролi:
- **chat** — дiалог з асистентом
- **edit** — генерацiя iнструкцiй редагування
- **apply** — застосування змiн до коду
- **autocomplete** — пiдказки при введеннi (Tab)
- **summarize** — стиснення контексту

## Порада

Використовуйте швидку модель для `autocomplete` (GPT-4o-mini, локальна модель) та потужну для `chat` та `edit` (GPT-4o, Claude, YandexGPT Pro).

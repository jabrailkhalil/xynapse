# Настройте AI-модели

Xynapse поддерживает любые OpenAI-совместимые провайдеры, а также YandexGPT и GigaChat.

## Файл конфигурации

Откройте `~/.xynapse/config.yaml` и добавьте модели:

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

## Роли моделей

Каждая модель назначается на роли:
- **chat** — диалог с ассистентом
- **edit** — генерация инструкций редактирования
- **apply** — применение изменений к коду
- **autocomplete** — подсказки при вводе (Tab)
- **summarize** — сжатие контекста

## Совет

Используйте быструю модель для `autocomplete` (GPT-4o-mini, локальная модель) и мощную для `chat` и `edit` (GPT-4o, Claude, YandexGPT Pro).

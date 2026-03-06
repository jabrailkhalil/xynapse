# Configure AI Models

Xynapse supports any OpenAI-compatible provider, as well as YandexGPT and GigaChat.

## Configuration File

Open `~/.xynapse/config.yaml` and add your models:

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
    apiKey: your-key
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: your-id
    clientSecret: your-secret
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## Model Roles

Each model is assigned to roles:
- **chat** — conversation with the assistant
- **edit** — generating edit instructions
- **apply** — applying changes to code
- **autocomplete** — inline suggestions (Tab)
- **summarize** — context compression

## Tip

Use a fast model for `autocomplete` (GPT-4o-mini, local model) and a powerful one for `chat` and `edit` (GPT-4o, Claude, YandexGPT Pro).

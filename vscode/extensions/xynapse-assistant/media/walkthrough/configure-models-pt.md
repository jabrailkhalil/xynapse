# Configure modelos de IA

Xynapse suporta qualquer provedor compativel com OpenAI, alem de YandexGPT e GigaChat.

## Arquivo de configuracao

Abra `~/.xynapse/config.yaml` e adicione seus modelos:

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
    apiKey: sua-chave
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: seu-id
    clientSecret: seu-segredo
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## Papeis dos modelos

Cada modelo e atribuido a papeis:
- **chat** — conversa com o assistente
- **edit** — gerar instrucoes de edicao
- **apply** — aplicar alteracoes ao codigo
- **autocomplete** — sugestoes em linha (Tab)
- **summarize** — compressao de contexto

## Dica

Use um modelo rapido para `autocomplete` (GPT-4o-mini, modelo local) e um poderoso para `chat` e `edit` (GPT-4o, Claude, YandexGPT Pro).

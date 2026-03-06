# Configure modelos de IA

Xynapse soporta cualquier proveedor compatible con OpenAI, asi como YandexGPT y GigaChat.

## Archivo de configuracion

Abra `~/.xynapse/config.yaml` y agregue sus modelos:

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
    apiKey: su-clave
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: su-id
    clientSecret: su-secreto
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## Roles de modelos

Cada modelo se asigna a roles:
- **chat** — conversacion con el asistente
- **edit** — generar instrucciones de edicion
- **apply** — aplicar cambios al codigo
- **autocomplete** — sugerencias en linea (Tab)
- **summarize** — compresion de contexto

## Consejo

Use un modelo rapido para `autocomplete` (GPT-4o-mini, modelo local) y uno potente para `chat` y `edit` (GPT-4o, Claude, YandexGPT Pro).

# KI-Modelle konfigurieren

Xynapse unterstutzt jeden OpenAI-kompatiblen Anbieter sowie YandexGPT und GigaChat.

## Konfigurationsdatei

Offnen Sie `~/.xynapse/config.yaml` und fugen Sie Ihre Modelle hinzu:

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
    apiKey: ihr-schlussel
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: ihre-id
    clientSecret: ihr-geheimnis
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## Modellrollen

Jedes Modell wird Rollen zugewiesen:
- **chat** — Gesprach mit dem Assistenten
- **edit** — Bearbeitungsanweisungen generieren
- **apply** — Anderungen auf Code anwenden
- **autocomplete** — Inline-Vorschlage (Tab)
- **summarize** — Kontextkomprimierung

## Tipp

Verwenden Sie ein schnelles Modell fur `autocomplete` (GPT-4o-mini, lokales Modell) und ein leistungsstarkes fur `chat` und `edit` (GPT-4o, Claude, YandexGPT Pro).

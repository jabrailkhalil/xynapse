# Configurez les modeles IA

Xynapse prend en charge tout fournisseur compatible OpenAI, ainsi que YandexGPT et GigaChat.

## Fichier de configuration

Ouvrez `~/.xynapse/config.yaml` et ajoutez vos modeles :

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
    apiKey: votre-cle
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: votre-id
    clientSecret: votre-secret
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## Roles des modeles

Chaque modele est assigne a des roles :
- **chat** — conversation avec l'assistant
- **edit** — generation d'instructions d'edition
- **apply** — application des changements au code
- **autocomplete** — suggestions en ligne (Tab)
- **summarize** — compression du contexte

## Astuce

Utilisez un modele rapide pour `autocomplete` (GPT-4o-mini, modele local) et un modele puissant pour `chat` et `edit` (GPT-4o, Claude, YandexGPT Pro).

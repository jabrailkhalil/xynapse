# AI Modellerini Yapilandirin

Xynapse, herhangi bir OpenAI uyumlu saglayiciyi, YandexGPT ve GigaChat'i destekler.

## Yapilandirma dosyasi

`~/.xynapse/config.yaml` dosyasini acin ve modellerinizi ekleyin:

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
    apiKey: anahtariniz
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: id-niz
    clientSecret: sirriniz
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## Model rolleri

Her model rollere atanir:
- **chat** — asistanla sohbet
- **edit** — duzenleme talimatlari olusturma
- **apply** — koda degisiklikleri uygulama
- **autocomplete** — satir ici oneriler (Tab)
- **summarize** — baglam sikistirma

## Ipucu

`autocomplete` icin hizli bir model (GPT-4o-mini, yerel model) ve `chat` ile `edit` icin guclu bir model (GPT-4o, Claude, YandexGPT Pro) kullanin.

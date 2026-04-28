# AI гѓўгѓ‡гѓ«г‚’иЁ­е®љ

Xynapse гЃЇ OpenAI дє’жЏ›гЃ®гѓ—гѓ­гѓђг‚¤гѓЂгѓјгЂЃYandexGPTгЂЃGigaChat г‚’г‚µгѓќгѓјгѓ€гЃ—гЃ¦гЃ„гЃѕгЃ™гЂ‚

## иЁ­е®љгѓ•г‚Ўг‚¤гѓ«

`~/.xynapse/config.yaml` г‚’й–‹гЃ„гЃ¦гѓўгѓ‡гѓ«г‚’иїЅеЉ пјљ

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
    apiKey: гЃ‚гЃЄгЃџгЃ®г‚­гѓј
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: гЃ‚гЃЄгЃџгЃ®ID
    clientSecret: гЃ‚гЃЄгЃџгЃ®г‚·гѓјг‚Їгѓ¬гѓѓгѓ€
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## гѓўгѓ‡гѓ«гЃ®еЅ№е‰І

еђ„гѓўгѓ‡гѓ«гЃЇеЅ№е‰ІгЃ«е‰Іг‚ЉеЅ“гЃ¦г‚‰г‚ЊгЃѕгЃ™пјљ
- **chat** вЂ” г‚ўг‚·г‚№г‚їгѓігѓ€гЃЁгЃ®дјљи©±
- **edit** вЂ” з·Ёй›†жЊ‡з¤єгЃ®з”џж€ђ
- **apply** вЂ” г‚ігѓјгѓ‰гЃёгЃ®е¤‰ж›ґйЃ©з”Ё
- **autocomplete** вЂ” г‚¤гѓігѓ©г‚¤гѓіжЏђжЎ€пј€Tabпј‰
- **summarize** вЂ” г‚ігѓігѓ†г‚­г‚№гѓ€ењ§зё®

## гѓ’гѓігѓ€

`autocomplete` гЃ«гЃЇй«йЂџгѓўгѓ‡гѓ«пј€GPT-4o-miniгЂЃгѓ­гѓјг‚«гѓ«гѓўгѓ‡гѓ«пј‰г‚’гЂЃ`chat` гЃЁ `edit` гЃ«гЃЇеј·еЉ›гЃЄгѓўгѓ‡гѓ«пј€GPT-4oгЂЃYandexGPT Proпј‰г‚’дЅїз”ЁгЃ—гЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚


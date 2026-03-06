# AI 모델 구성

Xynapse는 모든 OpenAI 호환 공급자와 YandexGPT, GigaChat을 지원합니다.

## 구성 파일

`~/.xynapse/config.yaml`을 열고 모델을 추가하세요:

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
    apiKey: 귀하의-키
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: 귀하의-id
    clientSecret: 귀하의-시크릿
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## 모델 역할

각 모델은 역할에 할당됩니다:
- **chat** — 어시스턴트와의 대화
- **edit** — 편집 지시 생성
- **apply** — 코드에 변경 적용
- **autocomplete** — 인라인 제안 (Tab)
- **summarize** — 컨텍스트 압축

## 팁

`autocomplete`에는 빠른 모델(GPT-4o-mini, 로컬 모델)을, `chat`과 `edit`에는 강력한 모델(GPT-4o, Claude, YandexGPT Pro)을 사용하세요.

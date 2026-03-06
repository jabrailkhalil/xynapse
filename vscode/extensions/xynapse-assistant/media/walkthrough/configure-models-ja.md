# AI モデルを設定

Xynapse は OpenAI 互換のプロバイダー、YandexGPT、GigaChat をサポートしています。

## 設定ファイル

`~/.xynapse/config.yaml` を開いてモデルを追加：

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
    apiKey: あなたのキー
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: あなたのID
    clientSecret: あなたのシークレット
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## モデルの役割

各モデルは役割に割り当てられます：
- **chat** — アシスタントとの会話
- **edit** — 編集指示の生成
- **apply** — コードへの変更適用
- **autocomplete** — インライン提案（Tab）
- **summarize** — コンテキスト圧縮

## ヒント

`autocomplete` には高速モデル（GPT-4o-mini、ローカルモデル）を、`chat` と `edit` には強力なモデル（GPT-4o、Claude、YandexGPT Pro）を使用してください。

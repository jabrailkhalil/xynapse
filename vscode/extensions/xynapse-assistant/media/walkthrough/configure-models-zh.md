# 配置 AI 模型

Xynapse 支持任何 OpenAI 兼容的提供商，以及 YandexGPT 和 GigaChat。

## 配置文件

打开 `~/.xynapse/config.yaml` 并添加您的模型：

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
    apiKey: 您的密钥
    roles: [chat]

  - title: GigaChat
    provider: gigachat
    clientId: 您的ID
    clientSecret: 您的密钥
    roles: [chat]

  - title: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    apiKey: sk-...
    roles: [autocomplete]
```

## 模型角色

每个模型被分配到角色：
- **chat** — 与助手对话
- **edit** — 生成编辑指令
- **apply** — 将更改应用到代码
- **autocomplete** — 内联建议（Tab）
- **summarize** — 上下文压缩

## 提示

使用快速模型用于 `autocomplete`（GPT-4o-mini、本地模型），使用强大模型用于 `chat` 和 `edit`（GPT-4o、Claude、YandexGPT Pro）。

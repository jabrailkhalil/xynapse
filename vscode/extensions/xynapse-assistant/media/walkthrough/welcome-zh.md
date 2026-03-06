# 欢迎使用 Xynapse IDE

Xynapse IDE 是一个集成了 AI 助手的开发环境。

## 功能特性

- **AI 对话** — 询问代码问题、获取解释和生成解决方案
- **自动补全** — 编辑器中的智能建议（Tab 接受）
- **内联编辑** — 选择代码并按 `Ctrl+I` 进行 AI 编辑
- **项目上下文** — 助手可以查看您的代码、diff、终端输出和错误
- **Council** — 多智能体架构决策讨论（`/council`）
- **俄罗斯模型** — 内置支持 YandexGPT 和 GigaChat

## 您的数据是安全的

Xynapse 不会将数据发送到 IDE 服务器。所有 API 密钥都**本地**存储在 `~/.xynapse/config.yaml` 中。遥测功能已完全禁用。

## 开始使用

1. 打开左侧的 **Xynapse** 面板
2. 在 `~/.xynapse/config.yaml` 中配置模型
3. 使用 `Ctrl+L` 聊天、`Ctrl+I` 编辑、`Tab` 自动补全

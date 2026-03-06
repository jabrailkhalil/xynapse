# 创建您的 Xynapse 个人资料

您的 Xynapse 个人资料是本地帐户。无需在第三方服务器上注册。

## 如何创建个人资料

1. 打开命令面板：`Ctrl+Shift+P`
2. 输入：**Xynapse: Set Up Profile**
3. 输入您的姓名和电子邮件

个人资料保存在 `~/.xynapse/profile.json` 中，用于 git 提交和助手日志中的身份识别。

## 加密备份

您可以将所有设置和 API 密钥导出为加密文件：

1. `Ctrl+Shift+P` → **Xynapse: Export Encrypted Config Backup**
2. 输入加密密码
3. 保存 `.enc` 文件

在另一台计算机上恢复：
1. `Ctrl+Shift+P` → **Xynapse: Import Encrypted Config Backup**
2. 选择文件并输入密码

## 通过 Git 同步

您可以将加密配置推送到自己的 git 仓库：
- **推送**：`Ctrl+Shift+P` → **Xynapse: Push Encrypted Config to Git**
- **拉取**：`Ctrl+Shift+P` → **Xynapse: Pull Encrypted Config from Git**

文件使用 AES-256-GCM 加密 — 即使在公共仓库中也是安全的。

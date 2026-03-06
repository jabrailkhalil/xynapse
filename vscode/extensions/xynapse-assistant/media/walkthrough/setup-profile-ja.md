# Xynapse プロフィールを作成

Xynapse プロフィールはローカルアカウントです。サードパーティサーバーへの登録は不要です。

## プロフィールの作成方法

1. コマンドパレットを開く：`Ctrl+Shift+P`
2. 入力：**Xynapse: Set Up Profile**
3. 名前とメールアドレスを入力

プロフィールは `~/.xynapse/profile.json` に保存され、git コミットとアシスタントログでの識別に使用されます。

## 暗号化バックアップ

すべての設定と API キーを暗号化ファイルにエクスポートできます：

1. `Ctrl+Shift+P` → **Xynapse: Export Encrypted Config Backup**
2. 暗号化パスワードを入力
3. `.enc` ファイルを保存

別のコンピューターで復元：
1. `Ctrl+Shift+P` → **Xynapse: Import Encrypted Config Backup**
2. ファイルを選択してパスワードを入力

## Git による同期

暗号化された設定を git リポジトリにプッシュできます：
- **プッシュ**：`Ctrl+Shift+P` → **Xynapse: Push Encrypted Config to Git**
- **プル**：`Ctrl+Shift+P` → **Xynapse: Pull Encrypted Config from Git**

ファイルは AES-256-GCM で暗号化されており、公開リポジトリでも安全です。

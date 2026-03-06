# Створiть свiй профiль Xynapse

Профiль Xynapse — це ваш локальний облiковий запис. Нiякої реєстрацiї на серверах третiх сторiн.

## Як створити профiль

1. Вiдкрийте палiтру команд: `Ctrl+Shift+P`
2. Введiть: **Xynapse: Set Up Profile**
3. Вкажiть ваше iм'я та email

Профiль зберiгається в `~/.xynapse/profile.json` та використовується для iдентифiкацiї в git-комiтах та логах асистента.

## Зашифрований бекап

Ви можете експортувати всi налаштування та API-ключi в зашифрований файл:

1. `Ctrl+Shift+P` → **Xynapse: Export Encrypted Config Backup**
2. Введiть пароль шифрування
3. Збережiть файл `.enc`

Для вiдновлення на iншому комп'ютерi:
1. `Ctrl+Shift+P` → **Xynapse: Import Encrypted Config Backup**
2. Оберiть файл та введiть пароль

## Синхронiзацiя через Git

Ви можете пушити зашифрований конфiг у свiй git-репозиторiй:
- **Push**: `Ctrl+Shift+P` → **Xynapse: Push Encrypted Config to Git**
- **Pull**: `Ctrl+Shift+P` → **Xynapse: Pull Encrypted Config from Git**

Файл шифрується AES-256-GCM — безпечно навiть у публiчному репозиторiї.

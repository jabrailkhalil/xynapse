<div align="center">

<img src="./Pics/Xynapse.png" alt="Xynapse IDE" width="320"/>

# Xynapse IDE

**Среда разработки с интегрированным ИИ**

</div>

---

## О проекте

Xynapse IDE — десктопная среда разработки с глубоко интегрированными AI-возможностями. Сочетает полнофункциональный редактор кода с интеллектуальным ассистентом, инлайн-автодополнением и мультиагентной системой планирования Council.

<div align="center">
<img src="./Pics/Assistants.png" alt="Xynapse Assistants" width="280"/>
</div>

## Возможности

### Xynapse Assistant

Встроенный AI-ассистент в боковой панели:

- **Чат** — задавайте вопросы, получайте объяснения, генерируйте код
- **Редактирование** — выделите код, опишите изменения, примените их напрямую
- **Slash-команды** — быстрые действия через `/команда`
- **Мульти-провайдер** — подключайте любых LLM-провайдеров (OpenAI, Anthropic, Google, YandexGPT, локальные модели и другие)
- **Роли моделей** — назначайте разные модели для чата, редактирования, применения, автодополнения и суммаризации
- **Контекст кодовой базы** — ассистент понимает структуру вашего проекта

### Xynapse Autocomplete

Инлайн-автодополнение кода:

- Подсказки в реальном времени по мере набора
- Работает с локальным или удаленным сервером автодополнения
- Настраиваемое поведение и выбор модели

### Xynapse Council

<div align="center">
<img src="./Pics/Council.png" alt="Xynapse Council" width="280"/>
</div>

Мультиагентная система планирования, где AI-эксперты совместно обсуждают задачу:

- **Настраиваемые роли** — Архитектор, Разработчик, Ревьюер, Тестировщик или свои роли
- **Выбор модели для каждой роли** — назначайте разные AI-модели каждому агенту
- **Уровни сложности** — Легкий (1 раунд), Средний (3 раунда), Сложный (5 раундов)
- **Структурированный результат** — генерирует `council-plan.md` с файловой структурой, шагами реализации и технологиями
- **Лог обсуждения** — опционально сохраняет полную дискуссию агентов в `council-discussion.md`

Использование: нажмите кнопку Council на панели ввода или введите `/council [задача]`

## Темы оформления

В комплекте 14 тем:

Lavender Dream, Grape Twilight, Deep Ocean, Cherry Blossom, Sunrise Glow, Frozen Mist, Silent Storm, Midnight Soul, Winter Frost, Shadow Realm, Tokyo Night, Tokyo Night Storm, Tokyo Night Light, Lunar Eclipse Dark

## Быстрый старт

### Требования

- Node.js 20.19.0+
- Python 3.10+
- Windows 10/11

### Запуск

```powershell
# Клонирование
git clone https://github.com/jabrailkhalil/Xynapse.git
cd Xynapse

# Через лаунчер
xynapse.bat
```

Лаунчер предоставляет меню для сборки, запуска, режима разработки, watch-режимов, релизной упаковки и других задач.

### Ручная сборка

```powershell
cd vscode
npm install
npm run compile
.\scripts\code.bat
```

## Конфигурация

Ассистент настраивается через `~/.xynapse/config.yaml`. Добавьте провайдеров и назначьте модели на роли:

```yaml
models:
  - name: my-model
    provider: openai
    model: gpt-4
    apiKey: YOUR_KEY
    roles:
      - chat
      - edit
```

Шаблон конфигурации: `vscode/extensions/xynapse-assistant/xynapse-config.yaml`

## Настройки редактора

- Размер табуляции: 2
- Плавная прокрутка
- Миникарта отключена
- Перенос строк на колонке 100
- Шрифт: JetBrains Mono, PragmataPro
- Шрифт терминала: PragmataPro Liga

## Структура проекта

```
Xynapse/
├── vscode/                     # Ядро IDE
│   ├── extensions/
│   │   ├── xynapse-assistant/  # Встроенное расширение ассистента
│   │   └── theme-xynapse-extras/ # Темы Xynapse
│   └── scripts/                # Скрипты запуска
├── plugins/
│   ├── continue-main/          # Исходный код ассистента
│   │   ├── core/               # Бэкенд, LLM-роутинг, команды
│   │   ├── gui/                # React/Vite webview UI
│   │   └── extensions/vscode/  # Мост к extension host
│   └── tabby-main/             # Движок автодополнения
├── Pics/                       # Изображения для документации
├── xynapse.bat                 # Windows-лаунчер
└── README.md
```

## Лицензия

MIT

<div align="center">
  <img src="./Pics/logo.png" alt="Xynapse IDE" width="320">

# Xynapse IDE

**Windows-IDE со встроенной системой AI-программирования, понимающей проект.**

[![Release](https://img.shields.io/github/v/release/jabrailkhalil/xynapse?display_name=tag)](https://github.com/jabrailkhalil/xynapse/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows)](https://github.com/jabrailkhalil/xynapse/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Скачать](https://github.com/jabrailkhalil/xynapse/releases/latest) · [Сайт](https://xynapse.online) · [English](./README.en.md)
</div>

Xynapse объединяет Code - OSS 1.108.0, терминал, Git, расширения и встроенного
AI-ассистента в одном приложении. Ассистент может объяснять репозиторий,
составлять план без изменения файлов, выполнять проверяемые правки, вызывать
совместимые инструменты и решать многошаговые задачи без отдельного окна чата.

![Xynapse Assistant](./Pics/Assistants.png)

## Чем полезен Xynapse

- **Четыре явных уровня автономности.** Chat отвечает без инструментов рабочей
  области; Plan только читает; Agent изменяет файлы внутри проекта; Full —
  отдельно включаемый режим неограниченных локальных действий.
- **Контекст репозитория.** К запросу можно приложить файлы, каталоги, diff,
  диагностику, выделенный код, вывод терминала и индекс кодовой базы.
- **Проверяемые изменения.** Inline Edit и действия агента создают реальные
  правки, видимые в редакторе и Source Control.
- **Отдельная модель автодополнения.** Быстрая модель может дописывать строки, а
  более сильная — отвечать в чате и редактировать код.
- **Инструменты и MCP.** Совместимые модели могут вызывать инструменты проекта и
  настроенные MCP-серверы.
- **Council/BVC.** Несколько ролей независимо анализируют задачу и критикуют
  план; адаптивный бюджет помогает не тратить одинаковый объём проверки на
  простые и сложные задачи.
- **Локальная конфигурация.** Ключи остаются в локальных файлах конфигурации и
  не дублируются в метаданных профиля. Резервные копии защищены AES-256-GCM.
  Телеметрия в этой сборке по умолчанию отключена.

## Модели Yandex AI Studio

В начальном шаблоне находятся десять идентификаторов Yandex, проверенных 16 августа 2026 года:

| Роль | Модели |
|---|---|
| Chat / Edit | `yandexgpt-5-pro`, `yandexgpt-5.1`, `deepseek-v4-flash`, `qwen3.6-35b-a3b` |
| Chat | `aliceai-llm`, `aliceai-llm-flash`, `qwen3-235b-a22b-fp8`, `gpt-oss-120b` |
| Автодополнение | `yandexgpt-5-lite`, `gpt-oss-20b` |

Все десять идентификаторов выполнили живой non-streaming запрос во время
проверки 16 августа 2026 года. Отдельно проверялись tool calling и streaming. Доступность,
квоты и оплата зависят от аккаунта пользователя в Yandex Cloud.

## Разрешения режимов

| Режим | Назначение | Профиль доступа |
|---|---|---|
| Chat | Вопросы, объяснение, ревью | Без инструментов рабочей области |
| Plan | Анализ и подготовка плана | `read-only` |
| Agent | Обычная реализация в репозитории | `workspace-write` |
| Full | Явно разрешённые системные действия | `danger-full-access` |

Это соответствие закреплено GUI-регрессионными тестами. Full следует включать
только тогда, когда задаче действительно нужен повышенный локальный доступ.

## Установка

1. Откройте [последний релиз](https://github.com/jabrailkhalil/xynapse/releases/latest).
2. Скачайте установщик Windows x64 или portable ZIP.
3. Запустите Xynapse и откройте проект.
4. Введите Yandex API key и folder ID, затем выберите модель.

Можно использовать `YANDEX_API_KEY` и `YANDEX_FOLDER_ID`. Встроенный пример
[`xynapse-config.yaml`](./vscode/extensions/xynapse-assistant/xynapse-config.yaml)
содержит только placeholders, без реальных ключей.

## Проверка и сборка

Кандидат в релиз проходит Vitest/Jest-наборы ассистента, GUI- и extension-тесты,
проверки конфигурации и транспорта, compile/type/layer/lint Code OSS, Windows-
упаковку, запуск с изолированным профилем, поиск ключей и повторную сверку
контрольных сумм после скачивания опубликованных файлов. Точные команды и
наблюдавшиеся числа находятся в
[`RELEASE-VERIFICATION.md`](./RELEASE-VERIFICATION.md).

Для сборки нужны Windows x64, Git LFS, Node.js 22.21.1, Python 3 и Visual Studio
2022 Build Tools с C++ workload. Для повторной сборки встроенного CLI также
нужен Rust; релиз проверен с Rust 1.95.0.

```powershell
git lfs pull
cd vscode
npm ci --legacy-peer-deps
npm run gulp compile-build-without-mangling
npm run gulp vscode-win32-x64
```

## Исследование

Репозиторий содержит оценку Council/BVC на 60 задачах и три статьи в LaTeX.
Каждая статья ссылается на диплом Джабраила Халилова:

- [Адаптивное распределение бюджета BVC](./research/bvc-evaluation/main60/articles/latex/01_adaptive_budget_bvc.tex)
- [Воспроизводимая оценка BVC](./research/bvc-evaluation/main60/articles/latex/02_reproducible_evaluation_bvc.tex)
- [Предварительный BVC для программирования и вайбкодинга](./research/bvc-evaluation/main60/articles/latex/03_upfront_bvc_vibecoding.tex)

Наблюдавшиеся эффекты относятся к исследованной выборке и не заявляются как
универсальная гарантия для любой задачи или модели.

![Xynapse Council](./Pics/Council.png)

## Автор и лицензии

Проект поддерживает **Dzhabrail Khalilov**, НИУ ВШЭ, Москва. Воспроизводимые
сообщения об ошибках принимаются в
[GitHub Issues](https://github.com/jabrailkhalil/xynapse/issues).

Код Xynapse распространяется по MIT. В состав входят модифицированный Code - OSS
(MIT), ассистент на основе Continue (Apache-2.0) и модифицированный Rust-runtime
Claw Code (MIT). Полная атрибуция находится в
[`NOTICE`](./NOTICE) и файлах лицензий компонентов.

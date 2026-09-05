<div align="center">

<img src="./Pics/logo.png" alt="Логотип Xynapse" width="120">

# Xynapse

**Редактор, терминал, Git и AI-ассистент — в одном рабочем пространстве.**

IDE для Windows на базе Code - OSS со встроенным Xynapse Assistant и планированием BVC.

[![IDE 1.108.0](https://img.shields.io/badge/IDE-1.108.0-6366f1?style=flat-square)](https://github.com/jabrailkhalil/xynapse/releases/tag/v1.108.0)
[![Assistant 1.0.0](https://img.shields.io/badge/Assistant-1.0.0-8b5cf6?style=flat-square)](https://github.com/jabrailkhalil/xynapse/releases/tag/assistant-v1.0.0-bvc.0.1.0)
[![BVC 0.1.0](https://img.shields.io/badge/BVC-0.1.0-0891b2?style=flat-square)](./plugins/continue-main/packages/bvc/README.md)
[![Windows x64](https://img.shields.io/badge/Windows-x64-0078d4?style=flat-square)](#скачать)

[Скачать](#скачать) · [Быстрый старт](#быстрый-старт) · [Планирование BVC](#планирование-bvc) · [English](./README.en.md)

</div>

## Скачать

Два релиза в одном проекте: готовая IDE или ассистент для совместимого редактора VS Code.

| Пакет | Что входит | Скачать · Windows x64 |
| --- | --- | --- |
| **Xynapse IDE 1.108.0** | Редактор + Assistant 1.0.0 + BVC 0.1.0 | [Установщик](https://github.com/jabrailkhalil/xynapse/releases/download/v1.108.0/XynapseSetup-x64-1.108.0.exe) · [Portable ZIP](https://github.com/jabrailkhalil/xynapse/releases/download/v1.108.0/Xynapse-portable-win32-x64-1.108.0.zip) |
| **Xynapse Assistant 1.0.0** | Отдельное расширение + BVC 0.1.0 | [VSIX](https://github.com/jabrailkhalil/xynapse/releases/download/assistant-v1.0.0-bvc.0.1.0/xynapse-assistant-bvc-0.1.0-win32-x64.vsix) |

В IDE ассистент уже установлен. В каждом релизе есть `SHA256SUMS.txt`; исполняемые файлы Windows пока без цифровой подписи.

## Быстрый старт

### Готовая IDE

1. Запустите установщик или распакуйте portable ZIP в новую папку и откройте `Xynapse.exe`.
2. Откройте папку своего проекта.
3. Подключите модель в Assistant. Для Yandex Cloud введите API-ключ и folder ID в начальной настройке, затем выберите модель.
4. Прикрепите файл или выделите код, выберите режим и опишите задачу.

### Отдельное расширение

1. Скачайте VSIX из таблицы выше.
2. В редакторе выберите **Extensions → Install from VSIX…**, укажите файл и перезагрузите окно.
3. Откройте Xynapse Assistant и настройте провайдера моделей.

Для Yandex также поддерживаются `YANDEX_API_KEY` и `YANDEX_FOLDER_ID`. Пример — во встроенном [шаблоне конфигурации](./vscode/extensions/xynapse-assistant/xynapse-config.yaml). Использование моделей оплачивается по тарифам выбранного провайдера.

## Работа с кодом

- **Добавляйте контекст проекта.** Прикрепляйте файлы, папки, diff, диагностику, выделенный код и вывод терминала; используйте поиск по индексу кодовой базы.
- **Проверяйте правки в редакторе.** Редактируйте выделенный фрагмент или поручайте задачу агенту и просматривайте изменения в Source Control.
- **Выбирайте модели по роли.** Настраивайте чат, редактирование и автодополнение независимо друг от друга.
- **Подключайте инструменты.** Используйте инструменты проекта и настроенные MCP-серверы с совместимыми моделями.
- **Рассматривайте разные решения.** Council и BVC собирают предложения и критику до начала реализации.

| Режим | Что делает | Доступ к проекту |
| --- | --- | --- |
| **Chat** | Объясняет код, отвечает на вопросы, разбирает приложенный контекст | Без инструментов проекта |
| **Plan** | Изучает проект и готовит план | Только чтение |
| **Agent** | Выполняет задачи внутри проекта | Чтение и запись |
| **Full** | Выполняет явно разрешённые системные задачи | Неограниченный локальный доступ |

## Планирование BVC

BVC 0.1.0 объединяет независимые предложения, критику и итоговый план в рамках заданного бюджета вызовов моделей. Прикрепите нужные файлы или выделите код и попробуйте:

```text
/bvc easy Исправить регрессию в парсере
/bvc medium Спланировать рефакторинг авторизации
/bvc hard Сравнить варианты миграции нескольких сервисов
```

Результат сохраняется в `bvc-plan.md`. Если включить сохранение обсуждения, появится `bvc-discussion.md` с предложениями, возражениями и журналом вызовов. Роли, модели и бюджет также можно выбрать через кнопку BVC.

Плану ещё нужны реализация и проверка тестами. Подробнее — в [руководстве Assistant](./plugins/continue-main/extensions/vscode/README.md) и документации [отдельного ядра BVC](./plugins/continue-main/packages/bvc/README.md).

## Проверка релиза

Для сборки от 5 сентября 2026 года проверены установка, запуск с изолированным профилем, активация расширения и удаление. Все **405 файлов расширения** совпадают с закреплённым VSIX в установленной IDE и portable-архиве. Пройдены TypeScript, целевой ESLint и **131 тест сборки**; все **8 опубликованных файлов** скачаны повторно — SHA-256 совпали.

Полный объём проверок и ограничения, включая отдельно датированные результаты браузерных тестов, — в [отчёте о проверке релиза](https://github.com/jabrailkhalil/xynapse/releases/download/v1.108.0/RELEASE-VERIFICATION.md).

## Разработка и исследование

<details>
<summary><strong>Сборка IDE для Windows из исходников</strong></summary>

Нужны Windows x64, Git с Git LFS, Node.js **22.21.1**, Python 3 и Visual Studio 2022 Build Tools с компонентами C++. Для пересборки встроенного CLI дополнительно нужен Rust; в релизе использован Rust 1.95.0.

Клонируйте репозиторий и загрузите файлы LFS:

```powershell
git clone https://github.com/jabrailkhalil/xynapse.git
cd xynapse
git lfs pull
```

Скачайте релизный VSIX в каталог, закреплённый в настройках упаковщика:

```powershell
$bundleDir = "artifacts/bvc-0.1.0-20260905"
New-Item -ItemType Directory -Force $bundleDir | Out-Null
$vsixName = "xynapse-assistant-bvc-0.1.0-win32-x64.vsix"
$releaseUrl = "https://github.com/jabrailkhalil/xynapse/releases/download/assistant-v1.0.0-bvc.0.1.0"
Invoke-WebRequest "$releaseUrl/$vsixName" -OutFile "$bundleDir/$vsixName"

cd vscode
npm ci
npm run gulp compile-build-without-mangling
npm run gulp vscode-win32-x64
```

Упаковщик проверяет VSIX по [`xynapse-assistant.json`](./vscode/build/xynapse-assistant.json) и копирует его содержимое без изменений в `resources/app/extensions/xynapse-assistant`. Если VSIX отсутствует или изменён, сборка останавливается с ошибкой. Другой локальный путь можно задать через `XYNAPSE_ASSISTANT_VSIX`; требуемая контрольная сумма остаётся прежней.

</details>

<details>
<summary><strong>Оценка BVC и научные статьи</strong></summary>

Репозиторий содержит оценку на 60 задачах и три исследовательские статьи:

- [Адаптивное распределение бюджета BVC](./research/bvc-evaluation/main60/articles/latex/01_adaptive_budget_bvc.tex)
- [Воспроизводимая оценка BVC](./research/bvc-evaluation/main60/articles/latex/02_reproducible_evaluation_bvc.tex)
- [Предварительный BVC для программирования и вайбкодинга](./research/bvc-evaluation/main60/articles/latex/03_upfront_bvc_vibecoding.tex)

Измеренные результаты относятся к исследованной выборке. В рамках релиза BVC 0.1.0 новый сравнительный прогон на платных моделях не проводился.

</details>

## О проекте

Автор — **Джабраил Халилов (Dzhabrail Khalilov)**. Об ошибках можно сообщить в [GitHub Issues](https://github.com/jabrailkhalil/xynapse/issues), указав шаги воспроизведения и версию IDE или расширения.

Код Xynapse распространяется по [MIT](./LICENSE). В состав входят Code - OSS (MIT), ассистент на основе Continue (Apache-2.0) и runtime Claw Code (MIT). Лицензии компонентов и уведомления об авторстве сохранены; подробнее — в [NOTICE](./NOTICE).

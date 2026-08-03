# LaTeX-версия трёх статей BVC

В каталоге находятся самостоятельные LaTeX-исходники трёх статей,
единая библиография и графики, построенные непосредственно из JSON/JSONL
эксперимента.

Проект Xynapse: <https://github.com/jabrailkhalil/xynapse>.

## Сборка

```powershell
$python = 'C:\Users\Home-PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $python .\build_latex_articles.py
```

Скрипт:

1. повторно рассчитывает производные метрики;
2. создаёт 18 векторных PDF-графиков;
3. собирает каждый документ LuaLaTeX + Biber;
4. проверяет отсутствие неопределённых ссылок, overfull-блоков и повреждённых
   Unicode-символов;
5. сохраняет финальные документы в `output/pdf/`.

## Источники данных

- `../../results/main60-primary-v1/evaluated.jsonl`
- `../../results/main60-primary-v1/analysis.json`
- `../../results/main60-stochasticity-audit-v1/evaluated.jsonl`
- `../../results/main60-vibe-v1/evaluated.jsonl`
- `../../results/robustness-analysis-v1.json`
- `../../data/selection_summary.json`

Производные значения сохраняются в `derived/derived_metrics.json`, а
LaTeX-макросы с ключевыми числами — в `derived/metrics.tex`.

## Готовые артефакты

- `output/pdf/` — три финальных PDF (15, 16 и 14 страниц);
- `output/bvc_latex_articles_package.zip` — LaTeX, библиография, метрики,
  графики и PDF;
- `output/bvc_reproducibility_supplement.zip` — JSONL/JSON, протоколы,
  integrity-отчёты, скрипты, статьи и `SHA256SUMS.txt`.

Три статьи используют одну основную матрицу 240 запусков и не являются
независимыми репликациями; различаются их исследовательские вопросы.

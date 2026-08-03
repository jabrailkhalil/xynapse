from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from pypdf import PdfReader


HERE = Path(__file__).resolve().parent
TMP_ROOT = HERE / "tmp" / "pdfs" / "build"
OUTPUT = HERE / "output" / "pdf"
ARTICLES = [
    "01_adaptive_budget_bvc",
    "02_reproducible_evaluation_bvc",
    "03_upfront_bvc_vibecoding",
]


def run(command: list[str], cwd: Path = HERE) -> subprocess.CompletedProcess[str]:
    print(">", " ".join(command), flush=True)
    result = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    if result.returncode:
        print(result.stdout)
        raise SystemExit(result.returncode)
    return result


def compile_article(stem: str) -> tuple[Path, str]:
    build_dir = TMP_ROOT / stem
    build_dir.mkdir(parents=True, exist_ok=True)
    tex = HERE / f"{stem}.tex"

    outputs: list[str] = []
    latex_command = [
        "lualatex",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        f"-output-directory={build_dir}",
        str(tex),
    ]
    outputs.append(run(latex_command).stdout)
    outputs.append(
        run(
            [
                "biber",
                "--input-directory",
                str(build_dir),
                "--output-directory",
                str(build_dir),
                stem,
            ]
        ).stdout
    )
    outputs.append(run(latex_command).stdout)
    outputs.append(run(latex_command).stdout)

    source_pdf = build_dir / f"{stem}.pdf"
    if not source_pdf.exists():
        raise FileNotFoundError(source_pdf)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    target_pdf = OUTPUT / f"{stem}.pdf"
    shutil.copy2(source_pdf, target_pdf)
    return target_pdf, outputs[-1]


def validate_pdf(pdf_path: Path, log: str) -> dict:
    reader = PdfReader(pdf_path)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    required = [
        "Халилов Джабраиль Эльнурович",
        "Интеллектуальная среда разработки",
        "SWE-bench",
        "Литература",
    ]
    missing = [needle for needle in required if needle not in text]
    bad_log_patterns = {
        "undefined citations": r"Citation '.+?' on page .+ undefined",
        "undefined references": r"There were undefined references",
        "empty bibliography": r"Empty bibliography",
        "overfull box": r"Overfull \\[hv]box",
    }
    log_issues = [
        label for label, pattern in bad_log_patterns.items() if re.search(pattern, log)
    ]
    replacement = "\ufffd" in text
    if missing or log_issues or replacement:
        raise RuntimeError(
            f"Validation failed for {pdf_path.name}: "
            f"missing={missing}, log_issues={log_issues}, replacement={replacement}"
        )
    return {
        "file": str(pdf_path),
        "pages": len(reader.pages),
        "characters_extracted": len(text),
        "size_bytes": pdf_path.stat().st_size,
    }


def main() -> None:
    python = sys.executable
    run([python, str(HERE / "generate_analysis_assets.py")])
    reports = []
    for stem in ARTICLES:
        pdf, log = compile_article(stem)
        report = validate_pdf(pdf, log)
        reports.append(report)
        print(
            f"OK {pdf.name}: {report['pages']} pages, "
            f"{report['characters_extracted']} extracted characters"
        )
    print(f"Final PDFs: {OUTPUT}")


if __name__ == "__main__":
    main()

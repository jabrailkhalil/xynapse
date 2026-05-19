"""Check Council/BVC prompt files for common mojibake fragments."""

from pathlib import Path

MOJIBAKE_MARKERS = tuple(
    chr(codepoint)
    for codepoint in (
        0x0420,  # Cyrillic capital Er
        0x045E,  # Cyrillic small short U
        0x0403,  # Cyrillic capital Gje
        0x0402,  # Cyrillic capital Dje
    )
)


def main() -> int:
    root = Path(__file__).resolve().parent
    failed = False

    for path in sorted(root.glob("*.py")):
        if path.name == Path(__file__).name:
            continue
        text = path.read_text(encoding="utf-8")
        hits = [marker for marker in MOJIBAKE_MARKERS if marker in text]
        if hits:
            failed = True
            print(f"{path.name}: mojibake markers found: {', '.join(hits)}")

    if not failed:
        print("Council/BVC prompt encoding check passed.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

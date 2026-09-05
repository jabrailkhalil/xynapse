"""Scan release inputs without printing credential values or matching text.

Known credentials are read locally and kept only in memory. ZIP/VSIX members
are scanned after decompression. Installers must also be scanned after install.
This is a release check, not a guarantee against every possible secret format.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

SECRET_NAME = re.compile(r"api.?key|access.?token|refresh.?token|auth.?token|password|client.?secret|credential", re.I)
ASSIGNMENT = re.compile(r'''(?im)["']?([\w.-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)[\w.-]*)["']?\s*[:=]\s*["']?([^\s"',;{}]+)''')
PATTERNS = {
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n){1,150}-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "github-token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    "provider-token": re.compile(rb"\b(?:sk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{32,}|gsk_[A-Za-z0-9]{32,}|AIza[A-Za-z0-9_-]{35})\b"),
    "aws-access-key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
}

# This exact fixture is deliberately invalid base64 in a certificate mock.
# A changed body, or a known local credential anywhere in the file, still fails.
REVIEWED_FIXTURES = {
    ('plugins/continue-main/packages/fetch/src/ssl-certificate.test.ts', 'private-key'):
        'b2f2a5d6c20d2914278b10604fe94ee9cd5fb609c31105ab873705a4f50135d1',
}


def plausible(value):
    return len(value) >= 10 and not re.search(r"\$|\{|\}|<|>|example|placeholder|your[_ -]|dummy|test[_ -]|process\.env|undefined|null", value, re.I)


def known_credentials(directory):
    values = set()
    def visit(obj):
        if isinstance(obj, dict):
            for key, value in obj.items():
                if SECRET_NAME.search(key) and isinstance(value, str) and plausible(value):
                    values.add(value)
                visit(value)
        elif isinstance(obj, list):
            for item in obj:
                visit(item)
    if directory:
        root = Path(directory)
        candidates = [root / name for name in ('config.yaml', 'config.yml', 'config.json', 'account.json', 'config.ts', 'environment.env')]
        candidates += [root / 'environment' / 'environment.env']
        for path in candidates:
            if not path.is_file():
                continue
            content = path.read_text(encoding='utf-8-sig', errors='replace')
            try:
                visit(json.loads(content))
            except (ValueError, TypeError):
                pass
            for match in ASSIGNMENT.finditer(content):
                value = match.group(2).strip('"\'')
                if plausible(value):
                    values.add(value)
    for key, value in os.environ.items():
        if SECRET_NAME.search(key) and plausible(value):
            values.add(value)
    encoded = set()
    for value in values:
        encoded.add(value.encode())
        encoded.add(value.encode('utf-16-le'))
        encoded.add(base64.b64encode(value.encode()))
    return encoded


def scan_stream(stream, label, known, findings):
    overlap = b''
    found = set()
    while True:
        chunk = stream.read(4 * 1024 * 1024)
        if not chunk:
            break
        data = overlap + chunk
        if 'known-local-credential' not in found and any(value in data for value in known):
            found.add('known-local-credential')
        for kind, pattern in PATTERNS.items():
            if kind not in found:
                expected = REVIEWED_FIXTURES.get((label.replace('\\', '/'), kind))
                for match in pattern.finditer(data):
                    if expected != hashlib.sha256(match.group(0)).hexdigest():
                        found.add(kind)
                        break
        overlap = data[-16384:]
    for kind in sorted(found):
        findings.append({'path': label, 'category': kind})


def scan_file(path, label, known, findings):
    if path.suffix.lower() in ('.zip', '.vsix', '.jar', '.whl') and zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            for member in archive.infolist():
                if not member.is_dir():
                    with archive.open(member) as stream:
                        scan_stream(stream, label + '!' + member.filename, known, findings)
    else:
        with path.open('rb') as stream:
            scan_stream(stream, label, known, findings)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--git', action='store_true', help='Only versioned and unignored source files')
    parser.add_argument('--known-dir', type=Path)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    known = known_credentials(args.known_dir)
    if args.git:
        output = subprocess.check_output(['git', 'ls-files', '-c', '-o', '--exclude-standard', '-z'], cwd=root)
        paths = [root / p.decode('utf-8') for p in output.split(b'\0') if p]
    elif root.is_file():
        paths = [root]
    else:
        paths = [p for p in root.rglob('*') if p.is_file()]
    findings = []
    count = 0
    for path in sorted(set(paths)):
        if not path.is_file():
            continue
        label = str(path.relative_to(root)) if path != root else path.name
        scan_file(path, label, known, findings)
        count += 1
    result = {'files_scanned': count, 'known_values_loaded': bool(known), 'findings': findings}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'files_scanned': count, 'findings': len(findings), 'report': str(args.report)}))
    return 1 if findings else 0


if __name__ == '__main__':
    raise SystemExit(main())

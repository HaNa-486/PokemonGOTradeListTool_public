"""Publication gate for known sensitive material and non-demo catalog content.

Heuristic checks complement human licensing review; they cannot prove authorship,
rights, or the absence of all secrets. Ignored local inputs are never inspected.
"""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import re
import stat
import sys

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location('repository_guard', pathlib.Path(__file__).with_name('check-repository-safety.py'))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)
_secret_content = base.inspect_bytes
_secret_path = base.sensitive_path

# Split test signatures avoid creating their own prohibited game fixture.
GAME_TERMS = ['Pika' + 'chu', 'Bulba' + 'saur', 'Gira' + 'tina', 'Ghold' + 'engo',
              '皮' + '卡丘', '妙蛙' + '種子', '桃' + '歹郎', '賽' + '富豪']
PATTERNS = {
    'known-game-content': re.compile('|'.join(map(re.escape, GAME_TERMS)), re.I),
    'embedded-game-metadata': re.compile(r'["\x27](?:familySource|goData)["\x27]\s*:\s*(?:["\x27]GO["\x27]|true)'),
    'automatic-game-source': re.compile(r'raw\.githubusercontent\.com/Poke' + r'Miners/', re.I),
    'live-project-binding': re.compile(r'\bappgprj_[0-9a-f]{20,}\b', re.I),
    'machine-private-path': re.compile(r'(?:[A-Z]:[\\/]+Users[\\/]+|/Users/|/home/)[A-Za-z0-9_.-]+', re.I),
    'private-sync-metadata': re.compile(r'["\x27](?:source_commit|private_commit|source_root)["\x27]\s*:\s*["\x27][^"\x27]+["\x27]'),
}
SITE_URL = re.compile(r'https://([a-z0-9.-]+)\.chatgpt\.site\b', re.I)
FORBIDDEN = {'data/catalog.json', 'data/catalog-sources.json', 'deployment_record.md'}


def path_is_forbidden(name):
    name = name.replace('\\', '/').lower()
    parts = name.split('/')
    return (_secret_path(name) or name in FORBIDDEN
            or name.startswith(('data/private/', '.git/', '.sync/', '/'))
            or ':' in name or any(part in ('', '.', '..', '.git') for part in parts))


def inspect_bytes(data):
    findings = _secret_content(data)
    if len(data) > base.MAX_BYTES:
        return findings
    text = data.decode('utf-8', errors='replace')
    for category, pattern in PATTERNS.items():
        findings.extend((category, text.count('\n', 0, m.start()) + 1) for m in pattern.finditer(text))
    for match in SITE_URL.finditer(text):
        if match.group(1).lower() not in ('your-site', 'example', 'test'):
            findings.append(('live-site-address', text.count('\n', 0, match.start()) + 1))
    # Recognize a catalog by structure, independently of its filename.
    try:
        value = json.loads(text)
        if isinstance(value, dict) and {'datasetId', 'items', 'schemaVersion'} <= value.keys():
            if value.get('kind') != 'synthetic':
                findings.append(('non-synthetic-catalog', 0))
            else:
                packed = json.dumps(value['items'], ensure_ascii=False, separators=(',', ':')).encode('utf-8')
                if hashlib.sha256(packed).hexdigest() != value.get('contentHash'):
                    findings.append(('catalog-content-hash', 0))
    except (ValueError, TypeError, UnicodeError):
        pass
    return findings


def inspect_file(name, data):
    findings = inspect_bytes(data)
    if path_is_forbidden(name):
        findings.append(('restricted-path', 0))
    return findings


def safe_path(root, name):
    """Reject traversal, symlinks, Windows junctions, and platform path aliases."""
    if not isinstance(name, str) or not name or '\\' in name or ':' in name:
        raise ValueError('Invalid relative path')
    parts = name.split('/')
    if any(part in ('', '.', '..') or part.rstrip(' .') != part for part in parts):
        raise ValueError('Invalid path component')
    root = root.resolve()
    current = root
    for part in parts:
        current = current / part
        if current.exists() or current.is_symlink():
            info = current.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 1024):
                raise ValueError('Links require separate review')
    if not current.resolve().is_relative_to(root):
        raise ValueError('Path leaves repository')
    return current


def inspect_snapshot(files):
    return [{'path': name, 'category': category, 'line': line}
            for name, data in sorted(files.items()) for category, line in inspect_file(name, data)]


def scan_repository(root, history=False):
    root = root.resolve()
    names = base.git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')
    for name in names.split(b'\x00'):
        if name:
            safe_path(root, name.decode('utf-8'))
    # Reuse the independently tested index/history traversal, including tags
    # and merge snapshots. The saved functions above avoid recursive calls.
    base.inspect_bytes = inspect_bytes
    base.sensitive_path = path_is_forbidden
    findings, files, blobs = base.scan(root, history)
    entries = [('index', base.git(root, 'ls-files', '--stage', '-z'))]
    if history:
        for tree_id in set(base.git(root, 'log', '--all', '--format=%T').splitlines()):
            entries.append(('history', base.git(root, 'ls-tree', '-rz', tree_id.decode())))
    for scope, output in entries:
        for entry in output.split(b'\x00'):
            if not entry:
                continue
            metadata, name = entry.split(b'\t', 1)
            mode = metadata.split()[0]
            if mode in (b'120000', b'160000'):
                findings.append((scope, name.decode('utf-8'), 'linked-source-requires-review', 0))
    return sorted(set(findings)), files, blobs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent.parent)
    parser.add_argument('--history', action='store_true')
    args = parser.parse_args()
    try:
        findings, files, blobs = scan_repository(args.root, args.history)
    except (OSError, RuntimeError, ValueError):
        print('Publication check could not complete. Check paths, checkout access, and full history.', file=sys.stderr)
        return 2
    for scope, path, category, line in findings:
        print(json.dumps({'scope': scope, 'path': path, 'category': category, 'line': line}, ensure_ascii=True))
    print(json.dumps({'result': 'FAIL' if findings else 'PASS', 'findings': len(findings),
                      'working_files': files, 'git_blobs': blobs, 'history': args.history}))
    return 1 if findings else 0


if __name__ == '__main__':
    sys.exit(main())

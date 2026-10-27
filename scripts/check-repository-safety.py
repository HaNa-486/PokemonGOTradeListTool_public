"""Conservative secret/file guard; not a complete secret scanner or security audit.

Scans working files eligible for Git, the index, and optionally all locally
reachable Git history. It never prints matching values. Ignored local files,
remote-only refs, GitHub discussions, logs and artifacts are outside its scope.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys


RULES = {
    'private-key': re.compile(r'-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----'),
    'github-token': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b'),
    'google-secret': re.compile(r'\b(?:AIza[A-Za-z0-9_-]{35}|GOCSPX-[A-Za-z0-9_-]{20,})\b'),
    'aws-access-key': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'openai-key': re.compile(r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b'),
    'bearer-literal': re.compile(r'\bBearer\s+[A-Za-z0-9_.~+/-]{24,}={0,2}', re.I),
    'credential-url': re.compile(r'https?://[^\s/\x22\x27<>:]+:[^\s/\x22\x27<>@]+@', re.I),
    'secret-literal': re.compile(
        r'''\b(?:GOOGLE_CLIENT_SECRET|CLOUDFLARE_API_TOKEN|OPENAI_API_KEY|GITHUB_TOKEN|'''
        r'''CLIENT_SECRET|API_SECRET|PRIVATE_KEY)\b[\x22\x27]?\s*[:=]\s*[\x22\x27]'''
        r'''[A-Za-z0-9_./+=-]{12,}[\x22\x27]''', re.I),
    'environment-secret': re.compile(
        r'^[ \t]*(?:GOOGLE_CLIENT_SECRET|CLOUDFLARE_API_TOKEN|OPENAI_API_KEY|GITHUB_TOKEN|'
        r'CLIENT_SECRET|API_SECRET|PRIVATE_KEY)[ \t]*=[ \t]*[A-Za-z0-9_./+=-]{12,}[ \t]*$', re.I | re.M),
}
MAX_BYTES = 20 * 1024 * 1024


def sensitive_path(name):
    name = name.replace('\\', '/').lower()
    base = name.rsplit('/', 1)[-1]
    return (
        (base.startswith('.env') and base != '.env.example')
        or base.startswith('.dev.vars')
        or bool(re.search(r'(^|/)(?:\.sites-runtime|\.wrangler|backups?|private-backups|test-results)(/|$)', name))
        or bool(re.search(r'(^|/)\.pdos/(?:local|private)(/|$)', name))
        or bool(re.search(r'\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$', base))
        or bool(re.search(r'\.(?:pem|key|p12|pfx)$', base))
        or bool(re.search(r'(?:^|[-_.])(?:backup|dump)(?:[-_.].*)?\.(?:json|sql|zip|gz)$', base))
        or base in ('qa-sessions.json', 'credentials.json', 'service-account.json')
    )


def inspect_bytes(data):
    if len(data) > MAX_BYTES:
        return [('oversize-requires-review', 0)]
    if data.startswith(b'SQLite format 3\x00'):
        return [('database-content', 0)]
    text = data.decode('utf-8', errors='replace')
    return [(category, text.count('\n', 0, match.start()) + 1)
            for category, pattern in RULES.items() for match in pattern.finditer(text)]


def git(root, *args, data=None):
    result = subprocess.run(['git', '-c', 'safe.directory=' + str(root), *args],
                            cwd=root, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Git errors can include user-controlled content: never echo raw stderr.
        raise RuntimeError('Git inspection failed; verify this is a readable Git checkout.')
    return result.stdout


def scan(root, history=False):
    root = root.resolve()
    findings = set()
    objects = {}
    current = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')
    names = set(n.decode('utf-8', errors='strict') for n in current.split(b'\x00') if n)

    def path_check(name, scope):
        if sensitive_path(name):
            findings.add((scope, name, 'sensitive-path', 0))

    def content_check(data, source):
        for category, line in inspect_bytes(data):
            findings.add((source, '', category, line))

    for name in sorted(names):
        path_check(name, 'working-tree')
        path = root / name
        if path.is_symlink():
            findings.add(('working-tree', name, 'symlink-requires-review', 0))
        elif path.is_file():
            if path.stat().st_size > MAX_BYTES:
                findings.add(('working-tree', name, 'oversize-requires-review', 0))
            else:
                for category, line in inspect_bytes(path.read_bytes()):
                    findings.add(('working-tree', name, category, line))

    for entry in git(root, 'ls-files', '--stage', '-z').split(b'\x00'):
        if not entry:
            continue
        metadata, name = entry.split(b'\t', 1)
        mode, oid, stage = metadata.split()
        name = name.decode('utf-8')
        path_check(name, 'index')
        if mode == b'160000':
            findings.add(('index', name, 'submodule-requires-review', 0))
        else:
            objects[oid.decode()] = 'index-blob'

    if history:
        if git(root, 'rev-parse', '--is-shallow-repository').strip() == b'true':
            raise RuntimeError('History scan requires a full clone (fetch-depth: 0).')
        # Inspect snapshots, not diffs: default git log omits merge diffs and
        # can miss sensitive paths introduced/resolved only in merge commits.
        # Deduplicate trees without losing same-blob renames to private paths.
        trees = set(git(root, 'log', '--all', '--format=%T').splitlines())
        for tree in trees:
            paths = git(root, 'ls-tree', '-r', '--name-only', '-z', tree.decode())
            for name in paths.split(b'\x00'):
                if name:
                    path_check(name.decode('utf-8', errors='strict'), 'history')
        for row in git(root, 'rev-list', '--objects', '--all').splitlines():
            objects[row.split(b' ', 1)[0].decode()] = 'history-object'
        content_check(git(root, 'log', '--all', '--format=%B'), 'commit-messages')

    blob_count = 0
    if objects:
        payload = ('\n'.join(objects) + '\n').encode()
        output = git(root, 'cat-file', '--batch', data=payload)
        offset = 0
        while offset < len(output):
            header_end = output.index(b'\n', offset)
            oid, kind, size = output[offset:header_end].split()
            offset = header_end + 1
            size = int(size)
            data = output[offset:offset + size]
            offset += size + 1
            if kind == b'blob':
                blob_count += 1
                content_check(data, 'blob:' + oid.decode()[:12])
            elif kind == b'tag':
                # Annotated release tags can contain credentials in messages.
                content_check(data, 'tag:' + oid.decode()[:12])

    return sorted(findings), len(names), blob_count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--history', action='store_true')
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    try:
        findings, files, blobs = scan(args.root, args.history)
    except (OSError, RuntimeError, ValueError):
        print('Repository safety check could not complete. Inspect checkout access and full history.', file=sys.stderr)
        return 2
    for scope, path, category, line in findings:
        print(json.dumps({'scope': scope, 'path': path, 'category': category, 'line': line}, ensure_ascii=True))
    print(json.dumps({'working_files': files, 'git_blobs': blobs, 'history': args.history,
                      'findings': len(findings), 'result': 'FAIL' if findings else 'PASS'}))
    return 1 if findings else 0


if __name__ == '__main__':
    sys.exit(main())

"""Prepare reviewed exports from a separate canonical checkout; never apply or push."""
import argparse
import difflib
import hashlib
import importlib.util
import json
import pathlib
import re
import subprocess
import sys
import uuid

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location('public_guard', pathlib.Path(__file__).with_name('check-public-content.py'))
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)
STATE = '.sites-runtime/sync/state.json'


def git(root, *args):
    result = subprocess.run(['git', '--no-optional-locks', '-c', 'safe.directory=' + str(root),
                             '-c', 'core.fsmonitor=false', *args],
                            cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise ValueError('Git inspection failed')
    return result.stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def clean(root):
    if git(root, 'status', '--porcelain', '--untracked-files=normal').strip():
        raise ValueError('Commit or set aside working changes before synchronization')
    git(root, 'rev-parse', '--verify', 'HEAD')


def tree(root):
    entries = {}
    for entry in git(root, 'ls-tree', '-rz', 'HEAD').split(b'\x00'):
        if not entry:
            continue
        metadata, name = entry.split(b'\t', 1)
        mode, kind, oid = metadata.split()
        name = name.decode('utf-8')
        guard.safe_path(root, name)
        if mode not in (b'100644', b'100755') or kind != b'blob':
            raise ValueError('Symlinks and submodules require separate review')
        entries[name] = oid.decode()
    return entries


def contents(root, entries):
    return {name: git(root, 'cat-file', 'blob', oid) for name, oid in entries.items()}


def local_path(root, name):
    path = guard.safe_path(root, name)
    # No local receipts or source identities may be staged into public history.
    result = subprocess.run(['git', '--no-optional-locks', '-c', 'safe.directory=' + str(root),
                             'check-ignore', '--quiet', '--', name],
                            cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise ValueError('Synchronization state must be ignored')
    return path


def read_json(root, name):
    return json.loads(local_path(root, name).read_text(encoding='utf-8'))


def write_json(root, name, value):
    path = local_path(root, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + '\n', encoding='utf-8')


def policy(root):
    raw = guard.safe_path(root, 'scripts/sync-policy.json').read_bytes()
    value = json.loads(raw)
    managed = value.get('managed', [])
    if value.get('schema_version') != 1 or not managed or len(managed) != len(set(managed)):
        raise ValueError('Invalid sync policy')
    for name in managed:
        guard.safe_path(root, name)
        if (any(char in name for char in '*?[') or guard.path_is_forbidden(name)
                or not name.startswith(('core/', 'server/', 'components/', 'hooks/', 'lib/'))):
            raise ValueError('Only explicit reviewed library paths are eligible')
    return set(managed), digest(raw)


def roots(root, source):
    root, source = root.resolve(), source.resolve()
    if root == source or root.is_relative_to(source) or source.is_relative_to(root):
        raise ValueError('Use independent source and public checkouts')
    clean(root)
    clean(source)
    return root, source


def validate_state(root, source, policy_hash):
    state = read_json(root, STATE)
    if (state.get('schema_version') != 1 or state.get('source_root') != str(source)
            or state.get('policy_hash') != policy_hash):
        raise ValueError('Source or policy changed; review baseline explicitly')
    return state


def initialize(root, source):
    root, source = roots(root, source)
    managed, policy_hash = policy(root)
    state_path = local_path(root, STATE)
    if state_path.exists():
        raise ValueError('Baseline already exists')
    source_tree, public_tree = tree(source), tree(root)
    for name in managed:
        if name not in source_tree or name not in public_tree or source_tree[name] != public_tree[name]:
            raise ValueError('Managed paths must start identical in both committed checkouts')
    if guard.inspect_snapshot(contents(root, public_tree)):
        raise ValueError('Publication check failed')
    write_json(root, STATE, {
        'schema_version': 1, 'source_root': str(source), 'policy_hash': policy_hash,
        'generation': uuid.uuid4().hex,
        'source_commit': git(source, 'rev-parse', 'HEAD').decode().strip(),
        'public_commit': git(root, 'rev-parse', 'HEAD').decode().strip(),
        'source_tree': source_tree, 'public_tree': public_tree,
    })
    return {'result': 'BASELINE_RECORDED', 'managed_files': len(managed)}


def prepare(root, source):
    root, source = roots(root, source)
    managed, policy_hash = policy(root)
    state = validate_state(root, source, policy_hash)
    source_tree, public_tree = tree(source), tree(root)
    snapshot = contents(root, public_tree)
    changes, manual, conflicts, patches = [], [], [], []
    for name in sorted(set(source_tree) | set(state['source_tree'])):
        if source_tree.get(name) == state['source_tree'].get(name):
            continue
        if name not in managed:
            # Metadata only: never copy or print arbitrary private file contents.
            manual.append({'path': name, 'reason': 'curated-or-unapproved-source-path'})
            continue
        if (public_tree.get(name) != state['public_tree'].get(name)
                or state['public_tree'].get(name) != state['source_tree'].get(name)):
            conflicts.append({'path': name, 'reason': 'public-contribution-or-curated-change'})
            continue
        before = snapshot.get(name, b'')
        after = git(source, 'cat-file', 'blob', source_tree[name]) if name in source_tree else None
        if after is not None and guard.inspect_file(name, after):
            raise ValueError('Proposed managed content failed publication check')
        old_text = before.decode('utf-8')
        new_text = after.decode('utf-8') if after is not None else ''
        if after is None:
            snapshot.pop(name, None)
        else:
            snapshot[name] = after
        changes.append({'path': name, 'action': 'delete' if after is None else 'update'})
        patches.extend(difflib.unified_diff(old_text.splitlines(keepends=True), new_text.splitlines(keepends=True),
                                            fromfile='a/' + name, tofile='b/' + name))
    if guard.inspect_snapshot(snapshot):
        raise ValueError('Full candidate failed publication check')
    proposal = uuid.uuid4().hex
    prefix = '.sites-runtime/sync/proposals/' + proposal
    candidate = local_path(root, prefix + '/candidate')
    candidate.mkdir(parents=True, exist_ok=False)
    for name, data in snapshot.items():
        path = guard.safe_path(candidate, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    report = {'schema_version': 1, 'proposal': proposal, 'changes': changes,
              'manual_review': manual, 'conflicts': conflicts,
              'applied': False, 'publication_guard': 'PASS'}
    write_json(root, prefix + '/report.json', report)
    local_path(root, prefix + '/changes.diff').write_text(''.join(patches), encoding='utf-8')
    write_json(root, prefix + '/local-state.json', {
        'source_commit': git(source, 'rev-parse', 'HEAD').decode().strip(),
        'public_commit': git(root, 'rev-parse', 'HEAD').decode().strip(),
        'source_tree': source_tree, 'policy_hash': policy_hash, 'generation': state['generation'],
        'candidate_hashes': {name: digest(data) for name, data in snapshot.items()},
        'baseline_public_tree': public_tree,
    })
    return {'result': 'PROPOSAL_READY', 'proposal': proposal, 'changes': len(changes),
            'manual_review': len(manual), 'conflicts': len(conflicts), 'applied': False}


def record(root, source, proposal, acknowledge=False):
    if not re.fullmatch(r'[a-f0-9]{32}', proposal or ''):
        raise ValueError('Invalid proposal ID')
    root, source = roots(root, source)
    managed, policy_hash = policy(root)
    state = validate_state(root, source, policy_hash)
    prefix = '.sites-runtime/sync/proposals/' + proposal
    report = read_json(root, prefix + '/report.json')
    proposed = read_json(root, prefix + '/local-state.json')
    if (git(source, 'rev-parse', 'HEAD').decode().strip() != proposed['source_commit']
            or policy_hash != proposed['policy_hash'] or state['generation'] != proposed['generation']):
        raise ValueError('Source or policy changed after proposal')
    if (report['manual_review'] or report['conflicts']) and not acknowledge:
        raise ValueError('Manual source changes and conflicts require explicit review')
    public_tree = tree(root)
    snapshot = contents(root, public_tree)
    if guard.inspect_snapshot(snapshot):
        raise ValueError('Reviewed public tree failed publication check')
    planned = {change['path'] for change in report['changes']}
    conflicted = {change['path'] for change in report['conflicts']}
    for change in report['changes']:
        name = change['path']
        if change['action'] == 'delete':
            if name in snapshot:
                raise ValueError('Proposed deletion was not applied')
        elif name not in snapshot or digest(snapshot[name]) != proposed['candidate_hashes'][name]:
            raise ValueError('Proposed update was not applied exactly')
    for name in managed - planned - conflicted:
        if public_tree.get(name) != proposed['baseline_public_tree'].get(name):
            raise ValueError('Unrelated managed edits require a new proposal')
    # The acknowledgement means each excluded change was adapted or deliberately
    # declined. Conflict resolutions are human-authored and must already be committed.
    state.update({
        'generation': uuid.uuid4().hex, 'source_commit': proposed['source_commit'],
        'public_commit': git(root, 'rev-parse', 'HEAD').decode().strip(),
        'source_tree': proposed['source_tree'], 'public_tree': public_tree,
    })
    write_json(root, STATE, state)
    receipt = {'result': 'REVIEW_RECORDED', 'proposal': proposal,
               'changes': len(report['changes']), 'manual_review_acknowledged': bool(acknowledge),
               'publication_guard': 'PASS'}
    write_json(root, prefix + '/review-receipt.json', receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('init', 'propose', 'record'))
    parser.add_argument('--source', required=True, type=pathlib.Path)
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent.parent)
    parser.add_argument('--proposal')
    parser.add_argument('--acknowledge-manual-review', action='store_true')
    args = parser.parse_args()
    try:
        if args.command == 'init':
            result = initialize(args.root, args.source)
        elif args.command == 'propose':
            result = prepare(args.root, args.source)
        else:
            result = record(args.root, args.source, args.proposal, args.acknowledge_manual_review)
        print(json.dumps(result, ensure_ascii=True))
        return 0
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        # Do not echo source filenames, private commit IDs, or raw Git errors.
        print('Synchronization refused. Check clean commits, policy, content checks, and review requirements.', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())

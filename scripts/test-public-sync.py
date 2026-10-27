"""Offline regression tests for export isolation and publication boundaries."""
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location('sync_upstream', pathlib.Path(__file__).with_name('sync-upstream.py'))
sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name)
        self.source, self.public = self.base / 'source', self.base / 'public'
        for root in (self.source, self.public):
            root.mkdir()
            self.run_git(root, 'init', '-b', 'main')
            self.run_git(root, 'config', 'user.name', 'Fixture')
            self.run_git(root, 'config', 'user.email', 'fixture@example.invalid')
            self.run_git(root, 'config', 'core.autocrlf', 'false')
            self.write(root, '.gitignore', '.sites-runtime/\n')
            self.write(root, 'core/model.ts', 'export const count = 1;\n')
            self.write(root, 'core/curated.ts', 'export const edition = "demo";\n')
        self.write(self.public, 'scripts/sync-policy.json', json.dumps({
            'schema_version': 1, 'managed': ['core/model.ts']}))
        for root in (self.source, self.public):
            self.commit(root)
        sync.initialize(self.public, self.source)

    def run_git(self, root, *args):
        result = subprocess.run(['git', '-c', 'safe.directory=' + str(root), *args],
                                cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(result.returncode, 0, 'Fixture Git operation failed')
        return result.stdout

    def write(self, root, name, data):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data, encoding='utf-8', newline='\n')

    def commit(self, root):
        self.run_git(root, 'add', '-A')
        self.run_git(root, 'commit', '-m', 'Synthetic test change')

    def update(self, name='core/model.ts', content='export const count = 2;\n'):
        self.write(self.source, name, content)
        self.commit(self.source)

    def proposal(self):
        before = self.run_git(self.source, 'rev-parse', 'HEAD')
        result = sync.prepare(self.public, self.source)
        self.assertEqual(before, self.run_git(self.source, 'rev-parse', 'HEAD'))
        self.assertEqual(b'', self.run_git(self.source, 'status', '--porcelain'))
        self.assertEqual(b'', self.run_git(self.public, 'status', '--porcelain'))
        prefix = self.public / '.sites-runtime/sync/proposals' / result['proposal']
        return result, prefix, json.loads((prefix / 'report.json').read_text())

    def test_incremental_update_never_applies_and_receipt_is_sanitized(self):
        self.update()
        result, prefix, report = self.proposal()
        self.assertEqual(report['changes'], [{'path': 'core/model.ts', 'action': 'update'}])
        self.assertIn('count = 1', (self.public / 'core/model.ts').read_text())
        proposed = (prefix / 'candidate/core/model.ts').read_text()
        self.write(self.public, 'core/model.ts', proposed)
        self.commit(self.public)
        receipt = sync.record(self.public, self.source, result['proposal'])
        receipt_text = json.dumps(receipt)
        self.assertNotIn(str(self.source), receipt_text)
        self.assertNotIn(self.run_git(self.source, 'rev-parse', 'HEAD').decode().strip(), receipt_text)
        self.assertEqual(sync.prepare(self.public, self.source)['changes'], 0)

    def test_curated_restricted_and_new_paths_are_manual_only(self):
        self.write(self.source, 'core/curated.ts', 'private adaptation\n')
        self.write(self.source, 'core/new.ts', 'new source file\n')
        # A private source file is only mentioned locally, never copied.
        self.write(self.source, 'data/catalog.json', '{"private":true}\n')
        self.commit(self.source)
        result, prefix, report = self.proposal()
        self.assertEqual(result['manual_review'], 3)
        self.assertFalse((prefix / 'candidate/data/catalog.json').exists())
        self.assertFalse((prefix / 'candidate/core/new.ts').exists())
        self.assertEqual((prefix / 'candidate/core/curated.ts').read_text(), 'export const edition = "demo";\n')
        with self.assertRaises(ValueError):
            sync.record(self.public, self.source, result['proposal'])
        sync.record(self.public, self.source, result['proposal'], True)
        self.assertEqual(sync.prepare(self.public, self.source)['manual_review'], 0)

    def test_deletion_is_only_proposed_then_explicitly_recorded(self):
        (self.source / 'core/model.ts').unlink()
        self.commit(self.source)
        result, prefix, report = self.proposal()
        self.assertEqual(report['changes'][0]['action'], 'delete')
        self.assertTrue((self.public / 'core/model.ts').exists())
        self.assertFalse((prefix / 'candidate/core/model.ts').exists())
        with self.assertRaises(ValueError):
            sync.record(self.public, self.source, result['proposal'])
        (self.public / 'core/model.ts').unlink()
        self.commit(self.public)
        sync.record(self.public, self.source, result['proposal'])

    def test_community_changes_produce_conflicts(self):
        self.write(self.public, 'core/model.ts', 'export const community = true;\n')
        self.commit(self.public)
        self.update()
        result, prefix, report = self.proposal()
        self.assertEqual(result['conflicts'], 1)
        self.assertEqual(report['changes'], [])
        self.assertIn('community', (prefix / 'candidate/core/model.ts').read_text())
        with self.assertRaises(ValueError):
            sync.record(self.public, self.source, result['proposal'])
        # Deliberately retaining the community change is a reviewed resolution.
        sync.record(self.public, self.source, result['proposal'], True)

    def test_preserved_community_changes_remain_protected_after_record(self):
        self.write(self.public, 'core/model.ts', 'export const community = true;\n')
        self.commit(self.public)
        # An unrelated source update must not bless the divergent file for overwrite.
        self.update(name='core/curated.ts', content='source-only curated change\n')
        first, _, _ = self.proposal()
        sync.record(self.public, self.source, first['proposal'], True)
        self.update(content='export const count = 4;\n')
        second, _, _ = self.proposal()
        self.assertEqual(second['conflicts'], 1)
        self.assertEqual(second['changes'], 0)

    def test_recorded_proposal_cannot_be_replayed(self):
        result, _, _ = self.proposal()
        sync.record(self.public, self.source, result['proposal'])
        with self.assertRaises(ValueError):
            sync.record(self.public, self.source, result['proposal'])

    def test_dirty_source_and_public_are_refused(self):
        for root in (self.source, self.public):
            self.write(root, 'uncommitted.txt', 'local change')
            with self.assertRaises(ValueError):
                sync.prepare(self.public, self.source)
            (root / 'uncommitted.txt').unlink()

    def test_unsafe_managed_content_has_no_candidate(self):
        token = 'gh' + 'p_' + 'A' * 36
        self.update(content='export const credential = "' + token + '";\n')
        with self.assertRaises(ValueError):
            sync.prepare(self.public, self.source)
        self.assertFalse((self.public / '.sites-runtime/sync/proposals').exists())

    def test_stale_source_cannot_advance_baseline(self):
        self.update()
        result, _, _ = self.proposal()
        self.update(content='export const count = 3;\n')
        with self.assertRaises(ValueError):
            sync.record(self.public, self.source, result['proposal'])

    def test_unapplied_update_cannot_advance_baseline(self):
        self.update()
        result, _, _ = self.proposal()
        with self.assertRaises(ValueError):
            sync.record(self.public, self.source, result['proposal'])

    def test_traversal_and_policy_expansion_are_refused(self):
        for name in ('../outside.ts', '/outside.ts', 'core/../../outside.ts', 'core\\model.ts',
                     'core/model.ts:stream', 'core/model.ts ', 'core/*'):
            with self.subTest(name=name):
                if '*' not in name:
                    with self.assertRaises(ValueError):
                        sync.guard.safe_path(self.public, name)
                self.write(self.public, 'scripts/sync-policy.json',
                           json.dumps({'schema_version': 1, 'managed': [name]}))
                with self.assertRaises(ValueError):
                    sync.policy(self.public)

    def test_changed_policy_requires_new_review(self):
        self.write(self.public, 'scripts/sync-policy.json', json.dumps({
            'schema_version': 1, 'managed': ['core/model.ts', 'core/curated.ts']}))
        self.commit(self.public)
        with self.assertRaises(ValueError):
            sync.prepare(self.public, self.source)

    def test_symlink_and_junction_paths_are_refused(self):
        outside = self.base / 'outside'
        outside.mkdir()
        self.write(outside, 'payload.ts', 'outside\n')
        link = self.public / 'linked'
        if os.name == 'nt':
            # Junction creation needs no symlink privilege on Windows.
            result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(link), str(outside)],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if result.returncode:
                self.skipTest('OS refused test junction creation')
            self.addCleanup(lambda: os.rmdir(link) if link.exists() else None)
        else:
            link.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            sync.guard.safe_path(self.public, 'linked/payload.ts')

    def test_index_symlink_is_refused_even_without_os_symlink_support(self):
        # Git mode alone is enough to reject a tracked symlink.
        result = subprocess.run(['git', '-C', str(self.source), 'hash-object', '-w', '--stdin'],
                                input=b'core/model.ts', stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(result.returncode, 0)
        self.run_git(self.source, 'update-index', '--add', '--cacheinfo',
                     '120000,' + result.stdout.decode().strip() + ',link')
        self.run_git(self.source, 'commit', '-m', 'Synthetic link fixture')
        with self.assertRaises(ValueError):
            sync.tree(self.source)
        findings, _, _ = sync.guard.scan_repository(self.source, True)
        self.assertTrue(any(row[2] == 'linked-source-requires-review' for row in findings))

    def test_source_index_is_not_refreshed_by_read_only_status(self):
        path = self.source / 'core/model.ts'
        info = path.stat()
        os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns + 2000000000))
        index = self.source / '.git/index'
        before = index.read_bytes()
        sync.prepare(self.public, self.source)
        self.assertEqual(index.read_bytes(), before)

    def test_source_and_public_cannot_overlap(self):
        with self.assertRaises(ValueError):
            sync.roots(self.public, self.public)
        with self.assertRaises(ValueError):
            sync.roots(self.public, self.public / 'nested')

    def test_personal_content_in_public_tree_is_rejected(self):
        self.write(self.public, 'core/curated.ts', 'https://' + 'private-site' + '.chatgpt.site/\n')
        self.commit(self.public)
        with self.assertRaises(ValueError):
            sync.prepare(self.public, self.source)


class PublicationTests(unittest.TestCase):
    def test_game_signatures_and_private_paths(self):
        for value in ('Pika' + 'chu', '皮' + '卡丘', 'appgprj_' + 'a' * 24,
                      'C:' + '/Users/' + 'someone/project'):
            self.assertTrue(sync.guard.inspect_bytes(value.encode()))
        self.assertTrue(sync.guard.path_is_forbidden('data/catalog.json'))
        self.assertFalse(sync.guard.inspect_bytes(b'CLIENT_SECRET=\nhttps://your-site.chatgpt.site/'))
        self.assertFalse(sync.guard.path_is_forbidden('data/demo-catalog.json'))

    def test_catalog_kind_and_hash(self):
        pack = {'schemaVersion': 1, 'datasetId': 'fixture', 'kind': 'synthetic', 'items': []}
        pack['contentHash'] = hashlib.sha256(b'[]').hexdigest()
        self.assertFalse(sync.guard.inspect_bytes(json.dumps(pack).encode()))
        pack['kind'] = 'external'
        self.assertIn(('non-synthetic-catalog', 0), sync.guard.inspect_bytes(json.dumps(pack).encode()))
        pack['kind'] = 'synthetic'
        pack['contentHash'] = '0' * 64
        self.assertIn(('catalog-content-hash', 0), sync.guard.inspect_bytes(json.dumps(pack).encode()))

    def test_history_catches_removed_game_content_and_tag_messages(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            def git(*args):
                result = subprocess.run(['git', '-C', folder, *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                self.assertEqual(result.returncode, 0, 'History fixture command failed')
            git('init', '-b', 'main')
            git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            (root / 'old.txt').write_text('Pika' + 'chu')
            git('add', '.')
            git('commit', '-m', 'Synthetic history fixture')
            (root / 'old.txt').write_text('Fictional fixture')
            git('commit', '-am', 'Remove fixture signature')
            git('tag', '-a', 'fixture', '-m', 'Bulba' + 'saur')
            findings, _, _ = sync.guard.scan_repository(root, True)
            self.assertTrue(any(row[0].startswith('blob:') and row[2] == 'known-game-content' for row in findings))
            self.assertTrue(any(row[0].startswith('tag:') and row[2] == 'known-game-content' for row in findings))


if __name__ == '__main__':
    unittest.main()

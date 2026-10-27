"""Synthetic temporary-repository tests: no real credentials or customer data."""
import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name('check-repository-safety.py')
spec = importlib.util.spec_from_file_location('repository_safety', SCRIPT)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class RepositorySafetyTests(unittest.TestCase):
    def setUp(self):
        # Keep synthetic repositories inside the ignored, writable local runtime.
        runtime = SCRIPT.resolve().parent.parent / '.sites-runtime' / 'safety-tests'
        runtime.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=runtime)
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Synthetic tester')
        self.git('config', 'user.email', 'test@example.invalid')

    def git(self, *args):
        return guard.git(self.root, *args)

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'Synthetic test')

    def test_safe_examples_and_nonsecret_identifiers(self):
        self.write('.env.example', 'GOOGLE_CLIENT_SECRET=\nSITES_CHATGPT_AUTH=disabled\n')
        self.write('auth.test.ts', "const headers = {'Authorization':'Bearer not-a-user'};")
        self.write('.openai/hosting.json', '{"project_id":"appgprj_example"}')
        self.commit()
        self.assertEqual(guard.scan(self.root, True)[0], [])

    def test_ignored_secrets_stay_local_but_force_added_files_fail(self):
        self.write('.gitignore', '.env*\n')
        self.write('.env.local', 'local-only-placeholder')
        self.commit()
        self.assertEqual(guard.scan(self.root, True)[0], [])
        self.git('add', '-f', '.env.local')
        self.assertTrue(any(f[2] == 'sensitive-path' for f in guard.scan(self.root)[0]))

    def test_deleted_secret_remains_detectable_in_history_and_is_redacted(self):
        secret = 'gh' + 'p_' + 'A' * 36
        self.write('ordinary.txt', secret)
        self.commit()
        self.write('ordinary.txt', 'removed')
        self.commit()
        self.assertEqual(guard.scan(self.root)[0], [])
        report = subprocess.run([sys.executable, str(SCRIPT), '--root', str(self.root), '--history'], capture_output=True)
        self.assertEqual(report.returncode, 1)
        self.assertIn(b'github-token', report.stdout)
        self.assertNotIn(secret.encode(), report.stdout + report.stderr)

    def test_staged_secret_detected_after_worktree_overwrite(self):
        self.write('config.txt', 'GOC' + 'SPX-' + 'x' * 30)
        self.git('add', '.')
        self.write('config.txt', 'clean worktree')
        self.assertTrue(any(f[2] == 'google-secret' for f in guard.scan(self.root)[0]))

    def test_annotated_tag_message_is_scanned_without_printing_value(self):
        self.write('ordinary.txt', 'safe')
        self.commit()
        secret = 'gh' + 'p_' + 'B' * 36
        self.git('tag', '-a', 'synthetic-tag', '-m', secret)
        report = subprocess.run([sys.executable, str(SCRIPT), '--root', str(self.root), '--history'], capture_output=True)
        self.assertEqual(report.returncode, 1)
        self.assertIn(b'github-token', report.stdout)
        self.assertNotIn(secret.encode(), report.stdout + report.stderr)

    def test_sensitive_path_only_in_merge_snapshot_is_scanned(self):
        self.write('ordinary.txt', 'safe')
        self.commit()
        base = self.git('rev-parse', 'HEAD').strip().decode()
        clean_tree = self.git('rev-parse', 'HEAD^{tree}').strip().decode()
        side = self.git('commit-tree', clean_tree, '-p', base, '-m', 'Synthetic side').strip().decode()
        self.write('.env.local', 'not-a-real-secret')
        self.git('add', '.env.local')
        private_tree = self.git('write-tree').strip().decode()
        merge = self.git('commit-tree', private_tree, '-p', base, '-p', side, '-m', 'Synthetic merge').strip().decode()
        # Remove it in another merge, so ordinary log --name-only sees neither.
        clean = self.git('commit-tree', clean_tree, '-p', merge, '-p', side, '-m', 'Synthetic resolution').strip().decode()
        self.git('reset', '--hard', clean)
        self.assertFalse(any(f[0] == 'working-tree' for f in guard.scan(self.root)[0]))
        self.assertTrue(any(f[0] == 'history' and f[1] == '.env.local'
                            for f in guard.scan(self.root, True)[0]))

    def test_sensitive_paths_include_same_blob_renamed_then_deleted(self):
        self.write('sample.txt', '{}')
        self.commit()
        self.write('backup.json', '{}')
        self.commit()
        self.git('rm', 'backup.json')
        self.git('commit', '-qm', 'Remove fixture')
        self.assertTrue(any(f[1] == 'backup.json' and f[0] == 'history'
                            for f in guard.scan(self.root, True)[0]))

    def test_key_database_and_auth_patterns_without_test_directory_exemption(self):
        samples = ['-----BEGIN ' + 'PRIVATE KEY-----',
                   'Bearer ' + 'a' * 40,
                   'GOOGLE_CLIENT_SECRET="' + 'value' * 5 + '"',
                   'CLOUDFLARE_API_TOKEN=' + 'value' * 5,
                   'https://user:' + 'password' + '@example.invalid']
        for sample in samples:
            with self.subTest(sample_type=samples.index(sample)):
                self.assertTrue(guard.inspect_bytes(sample.encode()))
        self.assertEqual(guard.inspect_bytes(b'SQLite format 3\x00fixture')[0][0], 'database-content')
        for name in ['restored.sqlite-wal', 'prod/backup-2026.json', 'deployment-backup.json',
                     'dump.sql', '.pdos/private/data.txt', '.sites-runtime/session.json']:
            self.assertTrue(guard.sensitive_path(name), name)
        self.assertFalse(guard.sensitive_path('migrations/0000.sql'))


if __name__ == '__main__':
    unittest.main()

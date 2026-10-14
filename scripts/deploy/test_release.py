import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('install-release.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def test_success_migrates_initial_directory_and_keeps_previous(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            runtime, candidate = root / 'runtime', root / 'release'
            runtime.mkdir(); candidate.mkdir()
            (runtime / 'old.txt').write_text('original')
            calls = []
            deploy.activate(candidate, runtime, calls.append, lambda: True)
            self.assertEqual(runtime.resolve(), candidate.resolve())
            self.assertEqual(calls, ['stop', 'start'])
            self.assertEqual(len(list(root.glob('runtime-backup-*/old.txt'))), 1)

    def test_failed_health_restores_previous_symlink_and_first_directory(self):
        for symlink in [False, True]:
            with self.subTest(symlink=symlink), tempfile.TemporaryDirectory() as root:
                root = Path(root)
                runtime, candidate, old = root / 'runtime', root / 'release', root / 'old'
                candidate.mkdir()
                if symlink:
                    old.mkdir(); runtime.symlink_to(old)
                else:
                    runtime.mkdir()
                (runtime / 'old.txt').write_text('original')
                calls = []
                with self.assertRaises(RuntimeError):
                    deploy.activate(candidate, runtime, calls.append, lambda: False)
                self.assertEqual((runtime / 'old.txt').read_text(), 'original')
                self.assertEqual(calls, ['stop', 'start', 'stop', 'start'])

    def test_start_failure_also_rolls_back(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            runtime, candidate = root / 'runtime', root / 'release'
            runtime.mkdir(); candidate.mkdir()
            (runtime / 'old.txt').write_text('original')
            calls = []
            def run(action):
                calls.append(action)
                if len(calls) == 2: raise RuntimeError('start failed')
            with self.assertRaises(RuntimeError):
                deploy.activate(candidate, runtime, run, lambda: True)
            self.assertTrue((runtime / 'old.txt').exists())
            self.assertEqual(calls[-1], 'start')

    def test_rejects_archive_escape_and_outside_symlink(self):
        for symlink in [False, True]:
            with self.subTest(symlink=symlink), tempfile.TemporaryDirectory() as root:
                root = Path(root)
                target = root / 'release'; target.mkdir()
                data = io.BytesIO()
                with tarfile.open(fileobj=data, mode='w:gz') as bundle:
                    member = tarfile.TarInfo('escape' if symlink else '../escape')
                    if symlink:
                        member.type = tarfile.SYMTYPE
                        member.linkname = '../escape'
                    bundle.addfile(member)
                data.seek(0)
                with self.assertRaises(tarfile.FilterError):
                    deploy.extract_release(data, target)
                self.assertFalse((root / 'escape').exists())

import base64
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).parents[1] / 'tools/prepare_runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)

class PackagingTests(unittest.TestCase):
    def test_archive_integrity_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'runtime.tgz'
            path.write_bytes(b'approved archive')
            integrity = 'sha512-' + base64.b64encode(hashlib.sha512(path.read_bytes()).digest()).decode()
            runtime.verify(path, integrity)
            path.write_bytes(b'changed archive')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                runtime.verify(path, integrity)

    def test_transient_runtime_gateway_errors_retry_pinned_download(self):
        import io
        import urllib.error
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / 'runtime.tgz'
            payload = b'verified runtime archive'
            integrity = 'sha512-' + base64.b64encode(hashlib.sha512(payload).digest()).decode()
            transient = urllib.error.HTTPError('https://example.test/runtime.tgz', 504, 'Gateway Timeout', {}, None)
            with patch.object(runtime.urllib.request, 'urlopen', side_effect=[transient, io.BytesIO(payload)]) as fetch, \
                 patch.object(runtime.time, 'sleep') as sleep:
                runtime.download_runtime('https://example.test/runtime.tgz', destination, integrity)
            self.assertEqual(destination.read_bytes(), payload)
            self.assertFalse(destination.with_suffix('.partial').exists())
            self.assertEqual(fetch.call_count, 2)
            sleep.assert_called_once_with(5)

    def test_host_patch_preserves_offsets_and_refuses_new_layouts(self):
        original = b'ELFprefix\0codex-code-mode-host\0padding\0codex-code-mode-host\0suffix'
        patched = runtime.patch_host_name(original)
        self.assertEqual(len(original), len(patched))
        self.assertEqual(original, patched.replace(b'libcodexmodehostx.so', b'codex-code-mode-host'))
        with self.assertRaises(ValueError):
            runtime.patch_host_name(b'new unknown binary')

    def test_reviewed_0162_layout_requires_three_fixed_width_replacements(self):
        original = b'ELF\0' + b'codex-code-mode-host\0' * 3
        with self.assertRaises(ValueError):
            runtime.patch_host_name(original)
        patched = runtime.patch_host_name(original, expected_occurrences=3)
        self.assertEqual(len(original), len(patched))
        self.assertEqual(patched.count(b'libcodexmodehostx.so'), 3)

if __name__ == '__main__':
    unittest.main()

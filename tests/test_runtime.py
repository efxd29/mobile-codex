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

    def test_ndk_libcxx_override_requires_and_copies_arm64_elf(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'ndk' / 'libc++_shared.so'
            target = Path(root) / 'app' / 'libc++_shared.so'
            source.parent.mkdir(parents=True)
            header = bytearray(20)
            header[:6] = b'\x7fELF\x02\x01'
            header[18:20] = (183).to_bytes(2, 'little')
            source.write_bytes(bytes(header) + b'NDK r30 libc++ runtime')
            runtime.copy_ndk_libcxx(source, target)
            self.assertEqual(target.read_bytes(), source.read_bytes())
            self.assertTrue(target.stat().st_mode & 0o111)

            header[18:20] = (62).to_bytes(2, 'little')
            source.write_bytes(bytes(header) + b'wrong architecture')
            with self.assertRaisesRegex(ValueError, 'Not an ARM64 ELF'):
                runtime.copy_ndk_libcxx(source, target)

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

"""Verifier regressions; pass a real VSIX to enable executable artifact controls."""
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location(
    "verifier", Path(__file__).resolve().parents[1]/"scripts/verify-vsix.py")
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)
CANDIDATE = Path(sys.argv.pop(1)).resolve() if len(sys.argv) > 1 else None


def archive(members, compression=zipfile.ZIP_DEFLATED):
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", compression=compression) as z:
        for name, content in members:
            z.writestr(name, content)
    result.seek(0)
    return result


class ExtractionTests(unittest.TestCase):
    def test_unsupported_compression_rejected_before_extraction(self):
        for method in (zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA):
            with self.subTest(method=method), patch.object(verifier, "extract") as extract:
                with self.assertRaisesRegex(ValueError, "compression"):
                    verifier.verify(archive([("extension/package.json", b"{}")], method))
                extract.assert_not_called()

    def test_spoofed_manifest_size_uses_bounded_reads(self):
        read = zipfile.ZipExtFile.read
        sizes = []

        def bounded(stream, size=-1):
            sizes.append(size)
            self.assertGreater(size, 0)
            self.assertLessEqual(size, verifier.CHUNK_BYTES)
            return read(stream, size)

        for width in (256 * 1024, 2 * 1024 * 1024):
            raw = bytearray(archive([("extension/package.json", b" " * width)]).getvalue())
            # Both directory and local headers understate the uncompressed size.
            struct.pack_into("<I", raw, raw.index(b"PK\x03\x04") + 22, 10)
            struct.pack_into("<I", raw, raw.index(b"PK\x01\x02") + 24, 10)
            with self.subTest(width=width), patch.object(zipfile.ZipExtFile, "read", bounded):
                with self.assertRaises(zipfile.BadZipFile):
                    verifier.verify(io.BytesIO(raw))
        self.assertTrue(sizes)

    def test_actual_byte_cap_is_enforced(self):
        source = archive([("one", b"12345"), ("two", b"67890")])
        with tempfile.TemporaryDirectory() as target, zipfile.ZipFile(source) as z:
            with patch.object(verifier, "MAX_BYTES", 9):
                with self.assertRaisesRegex(ValueError, "actual extracted"):
                    verifier.extract(z, z.infolist(), Path(target))
            self.assertEqual((Path(target)/"one").read_bytes(), b"12345")
            self.assertEqual((Path(target)/"two").stat().st_size, 0)

    def test_archive_header_limits_precede_extraction(self):
        with patch.object(verifier, "MAX_BYTES", 5), patch.object(verifier, "extract") as extract:
            with self.assertRaisesRegex(ValueError, "archive limits"):
                verifier.verify(archive([("file", b"123456")]))
            extract.assert_not_called()

    def test_member_paths_and_duplicates_are_rejected(self):
        cases = [
            [("../escape", b"")], [("/absolute", b"")], [("C:/drive", b"")],
            [("extension\\escape", b"")], [("one/./file", b""), ("one/file", b"")],
        ]
        symlink = zipfile.ZipInfo("link")
        symlink.create_system = 3
        symlink.external_attr = 0o120777 << 16
        cases.append([(symlink, b"target")])
        for members in cases:
            with self.subTest(members=members), patch.object(verifier, "extract") as extract:
                with self.assertRaises(ValueError):
                    verifier.verify(archive(members))
                extract.assert_not_called()

    def test_required_grammar_checks_do_not_rebuild_name_lists(self):
        for count in (500, 2000):
            manifest = {"main": "extension.js", "contributes": {
                "grammars": [{"path": "./grammar.json"}] * count + [{"path": "missing.json"}]}}
            members = [("extension/package.json", json.dumps(manifest)),
                       ("extension/extension.js", ""), ("extension/server/server.js", ""),
                       ("extension/server/language-service.js", ""), ("extension/grammar.json", "{}")]
            with self.subTest(count=count), patch.object(
                    zipfile.ZipFile, "namelist", side_effect=AssertionError("rebuild")):
                with self.assertRaisesRegex(ValueError, "Required artifact missing"):
                    verifier.verify(archive(members))


@unittest.skipUnless(CANDIDATE, "Pass a real VSIX path for executable artifact controls")
class RuntimeTests(unittest.TestCase):
    def rewrite(self, omit=None, replace=None):
        result = io.BytesIO()
        replace = replace or {}
        with zipfile.ZipFile(CANDIDATE) as source, zipfile.ZipFile(result, "w") as output:
            if omit:
                self.assertIn(omit, source.namelist())
            for name in replace:
                self.assertIn(name, source.namelist())
            for entry in source.infolist():
                if entry.filename != omit:
                    output.writestr(entry, replace.get(entry.filename, source.read(entry)))
        result.seek(0)
        return result

    def test_intact_real_archive_imports_client_and_initializes_server(self):
        result = verifier.verify(CANDIDATE)
        self.assertTrue(result["clientEntryImportedWithHostShim"])
        self.assertTrue(result["extensionEntryImported"])
        self.assertTrue(result["serverIpcInitializeShutdown"])
        self.assertTrue(result["propertyReferenceRejected"])
        self.assertEqual(result["propertyLiteralDiagnostics"], 0)
        self.assertEqual(len(result["runtimePackages"]), 8)

    def test_missing_client_runtime_code_fails(self):
        for file in ("vscode-jsonrpc/lib/node/main.js", "vscode-languageclient/lib/common/client.js",
                     "semver/functions/parse.js", "minimatch/minimatch.js"):
            with self.subTest(file=file), self.assertRaisesRegex(ValueError, "runtime check failed"):
                verifier.verify(self.rewrite(omit="extension/node_modules/"+file))

    def test_missing_server_only_runtime_code_fails(self):
        file = "extension/server/node_modules/vscode-languageserver-textdocument/lib/esm/main.js"
        with self.assertRaisesRegex(ValueError, "Bundled server IPC check failed"):
            verifier.verify(self.rewrite(omit=file))

    def test_server_early_successful_exit_is_not_verification_success(self):
        with self.assertRaisesRegex(ValueError, "exited before clean shutdown"):
            verifier.verify(self.rewrite(replace={"extension/server/server.js": "process.exit(0);"}))

    def test_server_invalid_initialize_response_fails(self):
        invalid = "process.on('message', m => process.send({jsonrpc:'2.0', id:m.id, result:{}}));"
        with self.assertRaisesRegex(ValueError, "Missing initialize capabilities"):
            verifier.verify(self.rewrite(replace={"extension/server/server.js": invalid}))

    def test_server_timeout_is_not_verification_success(self):
        with self.assertRaisesRegex(ValueError, "timed out"):
            verifier.verify(self.rewrite(replace={"extension/server/server.js": "setInterval(()=>{},1000);"}))


if __name__ == "__main__":
    unittest.main()

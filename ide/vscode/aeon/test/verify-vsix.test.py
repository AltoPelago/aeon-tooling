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
STATIC_FILES = ["extension/server/server.js", "extension/server/language-service.js",
                "extension/server/validation.js"]


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
            raw = bytearray(archive([("extension/package.json", b" " * width)] +
                                    [(name, "") for name in STATIC_FILES]).getvalue())
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
                       ("extension/server/language-service.js", ""),
                       ("extension/server/validation.js", ""), ("extension/grammar.json", "{}")]
            with self.subTest(count=count), patch.object(
                    zipfile.ZipFile, "namelist", side_effect=AssertionError("rebuild")):
                with self.assertRaisesRegex(ValueError, "Required artifact missing"):
                    verifier.verify(archive(members))

    def test_missing_required_files_preflight_before_extraction(self):
        manifest = {"main": "./extension.js", "contributes": {
            "grammars": [{"path": "./grammar.json"}]}}
        members = [("extension/package.json", json.dumps(manifest)),
                   ("extension/extension.js", ""), ("extension/grammar.json", "{}")]
        members += [(name, "") for name in STATIC_FILES]
        members += [("extension/unrelated-payload", "x" * (256 * 1024))]
        original_open = zipfile.ZipFile.open
        for missing, _ in members[:-1]:
            reads = []

            def observed(z, entry, *args, **kwargs):
                reads.append(entry.filename if isinstance(entry, zipfile.ZipInfo) else entry)
                return original_open(z, entry, *args, **kwargs)

            candidate = archive([(name, data) for name, data in members if name != missing])
            with self.subTest(missing=missing), patch.object(verifier, "extract") as extract:
                with patch.object(zipfile.ZipFile, "open", observed):
                    with self.assertRaisesRegex(ValueError, "Required artifact missing: "+missing):
                        verifier.verify(candidate)
                extract.assert_not_called()
                expected = [] if missing in STATIC_FILES + ["extension/package.json"] else ["extension/package.json"]
                self.assertEqual(reads, expected)

    def test_declared_grammar_directory_is_not_a_file(self):
        manifest = {"main": "./extension.js", "contributes": {
            "grammars": [{"path": "./grammar.json"}]}}
        for trailing_slash in (False, True):
            directory = zipfile.ZipInfo("extension/grammar.json" + ("/" if trailing_slash else ""))
            directory.create_system = 3
            directory.external_attr = 0o40755 << 16
            members = [("extension/package.json", json.dumps(manifest)),
                       ("extension/extension.js", ""), (directory, "")]
            members += [(name, "") for name in STATIC_FILES]
            with self.subTest(trailing_slash=trailing_slash), patch.object(verifier, "extract") as extract:
                with self.assertRaisesRegex(ValueError, "Required artifact missing: extension/grammar.json"):
                    verifier.verify(archive(members))
                extract.assert_not_called()

    def test_required_paths_cannot_escape_extension(self):
        for invalid in ("../escape", "/absolute", "C:/drive", "bad\\path", "", "\x00"):
            manifest = {"main": "./extension.js", "contributes": {"grammars": [{"path": invalid}]}}
            members = [("extension/package.json", json.dumps(manifest)), ("extension/extension.js", "")]
            members += [(name, "") for name in STATIC_FILES]
            with self.subTest(path=invalid), patch.object(verifier, "extract") as extract:
                with self.assertRaisesRegex(ValueError, "artifact path"):
                    verifier.verify(archive(members))
                extract.assert_not_called()


@unittest.skipUnless(CANDIDATE, "Pass a real VSIX path for executable artifact controls")
class RuntimeTests(unittest.TestCase):
    def rewrite(self, omit=None, replace=None, add=None):
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
            for name, content in (add or {}).items():
                self.assertNotIn(name, source.namelist())
                output.writestr(name, content)
        result.seek(0)
        return result

    def test_intact_real_archive_imports_client_and_initializes_server(self):
        result = verifier.verify(CANDIDATE)
        self.assertTrue(result["clientEntryImportedWithHostShim"])
        self.assertTrue(result["extensionEntryImported"])
        self.assertTrue(result["serverIpcInitializeShutdown"])
        self.assertTrue(result["serverIpcUsesPackagedClientProtocol"])
        self.assertTrue(result["clientPackageInventoryMatchesClosure"])
        self.assertTrue(result["propertyReferenceRejected"])
        self.assertEqual(result["referenceChecks"], [
            {"kind": "clone", "ordinaryAccepted": True, "selectorRejected": True},
            {"kind": "pointer", "ordinaryAccepted": True, "selectorRejected": True}])
        self.assertEqual(result["propertyLiteralDiagnostics"], 0)
        self.assertEqual(len(result["runtimePackages"]), 8)

    def test_reference_rejection_requires_selector_error(self):
        error = {"severity": 1, "code": "SYNTAX_ERROR", "message": "Probe",
                 "range": {"start": {"line": 1, "character": 13},
                           "end": {"line": 1, "character": 17}}}
        variants = [
            ("unrelated warning", {**error, "severity": 2, "code": "UNRELATED_WARNING",
                                   "range": {"start": {"line": 0, "character": 0},
                                             "end": {"line": 0, "character": 5}}}),
            ("warning at selector", {**error, "severity": 2}),
            ("wrong diagnostic code", {**error, "code": "UNRELATED_ERROR"}),
            ("error on preceding binding", {**error, "range": {
                "start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 5}}}),
            ("error before selector", {**error, "range": {
                "start": {"line": 1, "character": 0}, "end": {"line": 1, "character": 4}}}),
            ("no error", None),
        ]
        for label, diagnostic in variants:
            service = ("export function getDiagnostics(text) { return text.includes('&key(') ? " +
                       json.dumps([diagnostic] if diagnostic else []) + " : []; }\n" +
                       "export const getCodeActions=()=>[], getCompletionItems=()=>[], getHover=()=>null;\n")
            with self.subTest(case=label):
                with self.assertRaisesRegex(ValueError, "Missing syntax error at forbidden property selector"):
                    verifier.verify(self.rewrite(replace={"extension/server/language-service.js": service}))

    def test_ordinary_reference_is_a_positive_control(self):
        service = ("export function getDiagnostics(text) { return [{severity:1,code:'SYNTAX_ERROR',"
                   "range:{start:{line:1,character:13},end:{line:1,character:17}}}]; }\n"
                   "export const getCodeActions=()=>[], getCompletionItems=()=>[], getHover=()=>null;\n")
        # Preserve the inert-literal check, so failure comes from ordinary references.
        service = service.replace("return [{", "if(text.startsWith('selected:')) return []; return [{")
        with self.assertRaisesRegex(ValueError, "Ordinary clone reference must parse"):
            verifier.verify(self.rewrite(replace={"extension/server/language-service.js": service}))

    def test_pointer_reference_rejection_is_checked_separately(self):
        service = """export function getDiagnostics(text) {
          if (!text.includes('&key(')) return [];
          const character = text.split('\\n')[1].indexOf('&key(');
          return [{severity:text.includes('~>') ? 2 : 1, code:'SYNTAX_ERROR',
            range:{start:{line:1,character},end:{line:1,character:character+4}}}];
        }
        export const getCodeActions=()=>[], getCompletionItems=()=>[], getHover=()=>null;
        """
        with self.assertRaisesRegex(ValueError, "Missing syntax error at forbidden property selector in pointer"):
            verifier.verify(self.rewrite(replace={"extension/server/language-service.js": service}))

    def test_extra_client_packages_outside_closure_fail(self):
        for directory, name in (
                ("esbuild", "esbuild"), ("@probe/extra", "@probe/extra"),
                ("minimatch/node_modules/esbuild", "esbuild"),
                ("vscode-languageclient/node_modules/balanced-match", "balanced-match")):
            extra = {"extension/node_modules/"+directory+"/package.json":
                     json.dumps({"name": name, "version": "1.0.2"})}
            with self.subTest(directory=directory):
                with self.assertRaisesRegex(ValueError, "outside production closure"):
                    verifier.verify(self.rewrite(add=extra))

    def test_declared_scoped_production_packages_are_allowed(self):
        # A scoped package is valid at either depth when that exact slot is used.
        for owner in ("extension", "extension/node_modules/minimatch"):
            with self.subTest(owner=owner), zipfile.ZipFile(CANDIDATE) as z:
                file = owner+"/package.json"
                manifest = json.loads(z.read(file))
                manifest.setdefault("dependencies", {})["@probe/required"] = "1.0.0"
                directory = owner+"/node_modules/@probe/required/"
                extra = {directory+"package.json": json.dumps({
                    "name": "@probe/required", "version": "1.0.0", "main": "index.js"}),
                    directory+"index.js": "module.exports = {};"}
                result = verifier.verify(self.rewrite(replace={file: json.dumps(manifest)}, add=extra))
                self.assertTrue(result["clientPackageInventoryMatchesClosure"])
                self.assertEqual(len(result["runtimePackages"]), 9)

    def test_development_dependency_also_required_in_production_is_allowed(self):
        with zipfile.ZipFile(CANDIDATE) as z:
            manifest = json.loads(z.read("extension/package.json"))
        manifest.setdefault("devDependencies", {})["balanced-match"] = "1.0.2"
        result = verifier.verify(self.rewrite(replace={"extension/package.json": json.dumps(manifest)}))
        self.assertTrue(result["clientPackageInventoryMatchesClosure"])
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

    def test_response_with_method_uses_client_protocol_classification(self):
        with zipfile.ZipFile(CANDIDATE) as z:
            shebang, body = z.read("extension/server/server.js").split(b"\n", 1)
        for condition in ("message.result?.capabilities", "message.result === null"):
            interceptor = ("const originalSend = process.send.bind(process);\n"
                           "process.send = (message, ...args) => originalSend(\n"
                           "message.id !== undefined && ("+condition+")\n"
                           "? {...message, method: 'probe/unexpected'} : message, ...args);\n")
            source = shebang + b"\n" + interceptor.encode() + body
            with self.subTest(condition=condition):
                with self.assertRaisesRegex(ValueError, "Bundled server IPC check failed: timed out"):
                    verifier.verify(self.rewrite(replace={"extension/server/server.js": source}))

    def test_server_timeout_is_not_verification_success(self):
        with self.assertRaisesRegex(ValueError, "timed out"):
            verifier.verify(self.rewrite(replace={"extension/server/server.js": "setInterval(()=>{},1000);"}))


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Check a local VSIX's production client closure and bundled server, without installing it."""
import argparse
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import tempfile
import zipfile

NODE_CHECK = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const Module = require('node:module');
const {fork} = require('node:child_process');
const {pathToFileURL} = require('node:url');

// Exercise the actual packaged entry point and IPC imports, not just helpers.
async function checkServer(root) {
  const clientRequire = createRequire(createRequire(path.join(root, 'extension.js'))
    .resolve('vscode-languageclient/node'));
  const protocol = clientRequire('vscode-languageserver-protocol/node');
  const child = fork(path.join(root, 'server/server.js'), ['--node-ipc'], {
    cwd: root, silent: true, execArgv: [],
  });
  const connection = protocol.createProtocolConnection(
    new protocol.IPCMessageReader(child), new protocol.IPCMessageWriter(child));
  let stderr = '', timer, phase = 'initialize', fail;
  child.stdout.resume();
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
  const closed = new Promise(resolve => child.once('close', resolve));
  const failure = new Promise((_, reject) => { fail = reject; });
  child.on('error', fail);
  child.on('exit', (code, signal) => {
    if (phase !== 'exit' || code !== 0) {
      fail(new Error('exited before clean shutdown ('+code+', '+signal+')'));
    }
  });
  connection.onError(([error]) => fail(error));
  connection.onClose(() => {
    if (phase !== 'exit') fail(new Error('connection closed before clean shutdown'));
  });
  connection.listen();
  try {
    const handshake = (async () => {
      const result = await connection.sendRequest('initialize', {
        processId: process.pid, rootUri: null, capabilities: {},
      });
      assert.equal(result?.capabilities?.hoverProvider, true, 'Missing initialize capabilities');
      phase = 'shutdown';
      await connection.sendNotification('initialized', {});
      assert.equal(await connection.sendRequest('shutdown'), null, 'Invalid shutdown response');
      phase = 'exit';
      await connection.sendNotification('exit');
      await closed;
      assert.equal(child.exitCode, 0, 'Server did not exit cleanly');
    })();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), 10000);
    });
    await Promise.race([handshake, failure, timeout]);
  } catch (error) {
    throw new Error('Bundled server IPC check failed: '+error.message+' '+stderr);
  } finally {
    clearTimeout(timer);
    connection.dispose();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
}

(async () => {
  const root = fs.realpathSync(process.argv[1]);
  const inside = file => {
    const relative = path.relative(root, fs.realpathSync(file));
    assert(relative && relative !== '..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative),
      'Runtime dependency resolves outside the extracted VSIX');
  };
  const load = createRequire(path.join(root, 'extension.js'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  inside(load.resolve('vscode-languageclient/node'));
  // Node lacks the Extension Host's vscode module. Supply only the inert base
  // classes used at import time; never mock a production dependency or activate.
  const host = Object.fromEntries([
    'CallHierarchyItem', 'CancellationError', 'CodeAction', 'CodeLens',
    'CompletionItem', 'Diagnostic', 'DocumentLink', 'InlayHint',
    'SymbolInformation', 'TypeHierarchyItem',
  ].map(name => [name, class { constructor() { throw new Error('Host activation is outside this check'); } }]));
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'vscode') return host;
    const entry = Module._resolveFilename(request, parent, isMain);
    if (!Module.isBuiltin(entry)) inside(entry);
    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
  };
  try {
    const client = load('vscode-languageclient/node');
    assert.equal(typeof client.LanguageClient, 'function');
    const entry = path.resolve(root, manifest.main);
    inside(entry);
    const extension = load(entry);
    assert.equal(typeof extension.activate, 'function');
    assert.equal(typeof extension.deactivate, 'function');
  } finally { Module._load = originalLoad; }
  const queue = [root], seen = new Set(), packages = [];
  while (queue.length) {
    const directory = queue.shift();
    if (seen.has(directory)) continue;
    seen.add(directory);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (directory !== root) packages.push({name: manifest.name, version: manifest.version});
    const importer = createRequire(path.join(directory, 'package.json'));
    for (const name of Object.keys(manifest.dependencies || {})) {
      // Resolve executable entry points even when a package.json survives.
      inside(importer.resolve(name));
      let entry;
      try { entry = importer.resolve(name+'/package.json'); }
      catch { entry = importer.resolve(name); }
      inside(entry);
      let owner = fs.statSync(entry).isDirectory() ? entry : path.dirname(entry);
      while (owner !== root && owner !== path.dirname(owner)) {
        const file = path.join(owner, 'package.json');
        if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).name === name) break;
        owner = path.dirname(owner);
      }
      assert(owner !== root && owner !== path.dirname(owner), 'Missing manifest for '+name);
      queue.push(owner);
    }
  }
  for (const name of Object.keys(manifest.devDependencies || {})) {
    const dev = path.join(root, 'node_modules', name, 'package.json');
    assert(!fs.existsSync(dev) || seen.has(path.dirname(dev)), 'Development-only package shipped: '+name);
  }
  // Resolving required packages alone cannot detect an extra transitive dev tool.
  // Inventory package slots, including scoped and nested node_modules, by path:
  // the same name/version in an unused location is still an extra package.
  const installed = new Set(), directories = [path.join(root, 'node_modules')];
  const checkPackage = directory => {
    const owner = fs.realpathSync(directory);
    assert(seen.has(owner), 'Unexpected client package outside production closure: '+path.relative(root, owner));
    installed.add(owner);
    directories.push(owner);
  };
  while (directories.length) {
    const directory = directories.pop();
    const slots = path.basename(directory) === 'node_modules';
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      if (!slots) {
        directories.push(child);
      } else if (entry.name.startsWith('@')) {
        for (const member of fs.readdirSync(child, {withFileTypes: true})) {
          if (member.isDirectory()) checkPackage(path.join(child, member.name));
        }
      } else {
        checkPackage(child);
      }
    }
  }
  for (const directory of seen) {
    assert(directory === root || installed.has(directory), 'Production package missing from client inventory');
  }
  const service = await import(pathToFileURL(path.join(root, 'server/language-service.js')).href);
  await import(pathToFileURL(path.join(root, 'server/validation.js')).href);
  assert.deepEqual(service.getDiagnostics('selected:sansa = $.n&tag("book")'), []);
  assert(service.getDiagnostics('items=[1]\ncopy=~$.items&key("items")').length > 0);
  await checkServer(root);
  console.log(JSON.stringify({version: manifest.version, runtimePackages: packages,
    clientPackageInventoryMatchesClosure: true,
    clientEntryImportedWithHostShim: true, extensionEntryImported: true,
    bundledServerImports: true, serverIpcInitializeShutdown: true,
    serverIpcUsesPackagedClientProtocol: true,
    propertyLiteralDiagnostics: 0, propertyReferenceRejected: true}));
})().catch(error => { console.error(error.message); process.exit(1); });
"""

MAX_BYTES = 64 * 1024 * 1024
CHUNK_BYTES = 64 * 1024


def is_directory(entry):
    return entry.is_dir() or stat.S_ISDIR(entry.external_attr >> 16)


def read_manifest(z, entry):
    """Read only the manifest before extraction, without an unbounded ZIP read."""
    content = bytearray()
    with z.open(entry) as source:
        while True:
            chunk = source.read(CHUNK_BYTES)
            if not chunk:
                break
            if len(content) + len(chunk) > MAX_BYTES:
                raise ValueError("Candidate exceeds actual manifest byte limit")
            content.extend(chunk)
    return json.loads(content)


def artifact_path(value):
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("Invalid required artifact path")
    path = PurePosixPath(value)
    if (not path.parts or path.is_absolute() or ".." in path.parts
            or "\\" in value or ":" in value):
        raise ValueError("Unsafe required artifact path")
    return "extension/" + path.as_posix()


def extract(z, entries, destination):
    """Bound each decompression request and account for actual extracted bytes."""
    total = 0
    for entry in entries:
        target = destination.joinpath(*PurePosixPath(entry.filename).parts)
        if is_directory(entry):
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with z.open(entry) as source, target.open("wb") as output:
            while True:
                chunk = source.read(CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError("Candidate exceeds actual extracted byte limit")
                output.write(chunk)


def verify(archive):
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        if len(entries) > 10000 or sum(e.file_size for e in entries) > MAX_BYTES:
            raise ValueError("Candidate exceeds verifier archive limits")
        names, files = set(), {}
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if (not path.parts or path.is_absolute() or ".." in path.parts
                    or "\\" in entry.filename or ":" in entry.filename):
                raise ValueError("Unsafe archive member path")
            normalized = path.as_posix()
            if normalized in names:
                raise ValueError("Duplicate archive member path")
            names.add(normalized)
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError("Candidate must contain ordinary files, not symlinks")
            if stat.S_IFMT(entry.external_attr >> 16) not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError("Candidate must contain ordinary files or directories")
            if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError("Unsupported archive compression method")
            if not is_directory(entry):
                files[normalized] = entry

        def require_file(name):
            if name not in files:
                raise ValueError("Required artifact missing: "+name)

        for name in ("extension/package.json", "extension/server/server.js",
                     "extension/server/language-service.js", "extension/server/validation.js"):
            require_file(name)
        manifest = read_manifest(z, files["extension/package.json"])
        require_file(artifact_path(manifest["main"]))
        for grammar in manifest.get("contributes", {}).get("grammars", []):
            require_file(artifact_path(grammar["path"]))
        with tempfile.TemporaryDirectory(prefix="aeon-vsix-check-") as temporary:
            extract(z, entries, Path(temporary))
            root = Path(temporary)/"extension"
            env = dict(os.environ)
            env.pop("NODE_PATH", None)
            env.pop("NODE_OPTIONS", None)
            result = subprocess.run(
                ["node", "-e", NODE_CHECK, str(root)],
                capture_output=True, text=True, timeout=30, env=env)
            if result.returncode:
                raise ValueError("Extracted VSIX runtime check failed: "+result.stderr.strip())
            return json.loads(result.stdout)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", nargs="?", type=Path)
    args = parser.parse_args()
    archive = args.archive
    if archive is None:
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root/"package.json").read_text())
        archive = root/(manifest["name"]+"-"+manifest["version"]+".vsix")
    try:
        result = verify(archive.resolve())
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

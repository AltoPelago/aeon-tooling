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
const {pathToFileURL} = require('node:url');
(async () => {
  const root = fs.realpathSync(process.argv[1]);
  const inside = file => {
    const relative = path.relative(root, fs.realpathSync(file));
    assert(relative && relative !== '..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative),
      'Runtime dependency resolves outside the extracted VSIX');
  };
  const load = createRequire(path.join(root, 'extension.js'));
  inside(load.resolve('vscode-languageclient/node'));
  const queue = [root], seen = new Set(), packages = [];
  while (queue.length) {
    const directory = queue.shift();
    if (seen.has(directory)) continue;
    seen.add(directory);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (directory !== root) packages.push({name: manifest.name, version: manifest.version});
    const importer = createRequire(path.join(directory, 'package.json'));
    for (const name of Object.keys(manifest.dependencies || {})) {
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
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const name of Object.keys(manifest.devDependencies || {})) {
    const dev = path.join(root, 'node_modules', name, 'package.json');
    assert(!fs.existsSync(dev) || seen.has(path.dirname(dev)), 'Development-only package shipped: '+name);
  }
  const service = await import(pathToFileURL(path.join(root, 'server/language-service.js')).href);
  await import(pathToFileURL(path.join(root, 'server/validation.js')).href);
  assert.deepEqual(service.getDiagnostics('selected:sansa = $.n&tag("book")'), []);
  assert(service.getDiagnostics('items=[1]\ncopy=~$.items&key("items")').length > 0);
  console.log(JSON.stringify({version: manifest.version, runtimePackages: packages,
    bundledServerImports: true, propertyLiteralDiagnostics: 0, propertyReferenceRejected: true}));
})().catch(error => { console.error(error.message); process.exit(1); });
"""

def verify(archive):
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        if len(entries) > 10000 or sum(e.file_size for e in entries) > 64 * 1024 * 1024:
            raise ValueError("Candidate exceeds verifier archive limits")
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in entry.filename:
                raise ValueError("Unsafe archive member path")
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError("Candidate must contain ordinary files, not symlinks")
        manifest = json.loads(z.read("extension/package.json"))
        required = ["extension/"+manifest["main"].removeprefix("./"),
                    "extension/server/server.js", "extension/server/language-service.js"]
        required += ["extension/"+g["path"].removeprefix("./")
                     for g in manifest.get("contributes", {}).get("grammars", [])]
        for name in required:
            if name not in z.namelist():
                raise ValueError("Required artifact missing: "+name)
        with tempfile.TemporaryDirectory(prefix="aeon-vsix-check-") as temporary:
            z.extractall(temporary)
            env = dict(os.environ)
            env.pop("NODE_PATH", None)
            result = subprocess.run(
                ["node", "-e", NODE_CHECK, str(Path(temporary)/"extension")],
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

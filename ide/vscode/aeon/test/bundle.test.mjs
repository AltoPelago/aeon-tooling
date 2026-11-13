import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

test('candidate server bundle preserves import-only SANSA exports and cursor dependency', async t => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-editor-bundle-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const extension = join(root, 'extension');
  const build = join(root, 'typescript');
  mkdirSync(join(extension, 'scripts'), {recursive: true});
  cpSync(new URL('../scripts/bundle-server.mjs', import.meta.url), join(extension, 'scripts/bundle-server.mjs'));
  for (const name of ['aes', 'annotation-stream', 'core', 'finalize', 'lexer', 'parser', 'profiles', 'transport', 'aeos']) {
    const dir = join(build, 'packages', name);
    mkdirSync(join(dir, 'dist'), {recursive: true});
    const packageName = name === 'aeos' ? '@altopelago/aeos-core' : `@altopelago/aeon-${name}`;
    writeFileSync(join(dir, 'package.json'), JSON.stringify({name: packageName, type: 'module', main: './dist/index.js', dependencies: name === 'parser' ? {'@altopelago/sansa': '0.0.0'} : name === 'core' ? {'@altopelago/aeon-parser': '0.0.0'} : {}}));
    writeFileSync(join(dir, 'dist/index.js'), 'export const fixture = true;');
    writeFileSync(join(dir, 'dist/index.test.js'), 'throw new Error("test sidecar must not ship");');
  }
  for (const name of ['vscode-languageserver', 'vscode-languageserver-textdocument', '@altopelago/sansa']) {
    const dir = join(build, 'node_modules', name);
    mkdirSync(dir, {recursive: true});
    const exports = name === '@altopelago/sansa'
      ? {'.': {import: './index.js'}, './parsing/selector-cursor': {import: './cursor.js'}} : undefined;
    writeFileSync(join(dir, 'package.json'), JSON.stringify({name, type: 'module', main: './index.js', ...(exports ? {exports} : {})}));
    writeFileSync(join(dir, 'index.js'), 'export const fixture = true;');
    if (exports) writeFileSync(join(dir, 'cursor.js'), 'export const cursor = "included";');
  }
  const lsp = join(build, 'tools/aeon-lsp/dist');
  mkdirSync(lsp, {recursive: true});
  writeFileSync(join(lsp, 'server.js'), 'import {cursor} from "@altopelago/sansa/parsing/selector-cursor"; export {cursor};');
  const result = spawnSync(process.execPath, [join(extension, 'scripts/bundle-server.mjs'), build], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((await import(pathToFileURL(join(extension, 'server/server.js')).href)).cursor, 'included');
  assert.equal(existsSync(join(extension, 'server/node_modules/@altopelago/aeon-core/dist/index.test.js')), false);
});

test('unbundled extension fallback resolves the documented sibling implementation', () => {
  const extension = resolve(new URL('..', import.meta.url).pathname);
  const expected = resolve(extension, '../../../../aeon/implementations/typescript/tools/aeon-lsp/dist/server.js');
  const seen = [];
  const context = vm.createContext({__dirname: extension, module: {exports: {}}, require(name) {
    if (name === 'path') return {resolve};
    if (name === 'fs') return {existsSync(p) {seen.push(p); return p === expected;}};
    if (name === 'vscode') return {window: {showErrorMessage() {throw new Error('server not found');}}};
    if (name === 'vscode-languageclient/node') return {TransportKind: {ipc: 1}, LanguageClient: class {start() {return {dispose() {}};}}};
    throw new Error(name);
  }});
  vm.runInContext(readFileSync(new URL('../extension.js', import.meta.url), 'utf8'), context);
  context.module.exports.activate({subscriptions: []});
  assert.ok(seen.includes(expected));
});

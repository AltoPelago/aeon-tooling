import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import textmate from 'vscode-textmate';
import oniguruma from 'vscode-oniguruma';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('fixtures/property-literals.json', import.meta.url), 'utf8'));
await oniguruma.loadWASM(readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer);
const onigLib = Promise.resolve({
  createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
  createOnigString: text => new oniguruma.OnigString(text),
});

for (const [host, relative] of [
  ['VS Code', 'ide/vscode/aeon/syntaxes/aeon.tmLanguage.json'],
  ['Pulsar', 'ide/pulsar/aeon/grammars/aeon.json'],
]) {
  const path = fileURLToPath(new URL(relative, root));
  const raw = textmate.parseRawGrammar(readFileSync(path, 'utf8'), path);
  const registry = new textmate.Registry({onigLib, loadGrammar: async () => raw});
  const grammar = await registry.loadGrammar('source.aeon');
  const at = (tokens, offset, scope) => tokens.some(t =>
    t.startIndex <= offset && offset < t.endIndex && t.scopes.includes(scope));

  test(host+': real TextMate engine retains each complete literal in nested contexts', () => {
    const contexts = [
      a => 'selected:sansa = '+a+', next = 1',
      a => 'holder@{selected:sansa = '+a+', other = 1} = 1',
      a => 'list = [ '+a+' ]',
      a => 'tuple = ( '+a+' )',
      a => 'node = <tag( '+a+' )>',
      a => 'obj = { selected:sansa = '+a+' next = 1 }',
    ];
    for (const address of fixture.valid) for (const context of contexts) {
      const line = context(address), start = line.indexOf(address);
      const {tokens} = grammar.tokenizeLine(line);
      for (let i = start; i < start + address.length; i++) {
        assert(at(tokens, i, 'meta.address.sansa.aeon'), host+': '+line+' at '+i);
        assert(!at(tokens, i, 'invalid.illegal.sansa.incomplete.aeon'), line);
      }
      assert(!at(tokens, start + address.length, 'meta.address.sansa.aeon'), line);
    }
  });

  test(host+': incomplete known property arguments recover at the next line', () => {
    for (const address of fixture.unfinished) {
      const line = 'selected:sansa = '+address;
      const first = grammar.tokenizeLine(line);
      assert(first.tokens.some(t => t.scopes.includes('invalid.illegal.sansa.incomplete.aeon')), address);
      const second = grammar.tokenizeLine('next = 1', first.ruleStack);
      assert(at(second.tokens, 0, 'variable.other.key.aeon'), address);
      assert(!at(second.tokens, 0, 'meta.address.sansa.aeon'), address);
      assert(!second.tokens.some(t => t.scopes.some(s => s.startsWith('string.quoted'))), address);
    }
  });

  test(host+': comments and strings keep property lookalikes inert', () => {
    for (const line of ['// $&tag("book")', 'text = '+JSON.stringify('$&key("x")')]) {
      assert(!grammar.tokenizeLine(line).tokens.some(t => t.scopes.includes('meta.address.sansa.aeon')), line);
    }
  });

  test(host+': structural reference rules do not admit property expressions', () => {
    for (const entry of raw.repository.bindings.patterns.filter(p => p.name?.startsWith('meta.binding.') && p.match)) {
      const pattern = new RegExp('^(?:'+entry.match+')$');
      for (const prefix of fixture.referencePrefixes) for (const a of fixture.valid) {
        assert(!pattern.test(prefix+a), prefix+a);
        assert(!pattern.test(prefix+' '+a), prefix+' '+a);
      }
    }
  });
}

// Sublime uses the same Oniguruma-compatible match expression and recovery
// capture. Its native application is a separate host qualification.
test('Sublime: same address rule and real Oniguruma complete/recovery matches', () => {
  const source = readFileSync(new URL('ide/sublime/AEON/AEON.sublime-syntax', root), 'utf8');
  const match = /  sansa-addresses:\n    - match: '([^\n]+)'\n      scope: meta.address.sansa.aeon\n      captures:\n        1: invalid.illegal.sansa.incomplete.aeon/.exec(source);
  assert(match, 'missing Sublime address/recovery rule');
  const vscode = JSON.parse(readFileSync(new URL('ide/vscode/aeon/syntaxes/aeon.tmLanguage.json', root)));
  assert.equal(match[1], vscode.repository['sansa-addresses'].patterns[0].match);
  const scanner = new oniguruma.OnigScanner([match[1]]);
  try {
    for (const a of [...fixture.valid, ...fixture.unfinished]) {
      const result = scanner.findNextMatchSync(a, 0);
      assert(result, a);
      assert.equal(result.captureIndices[0].start, 0, a);
      assert.equal(result.captureIndices[0].end, a.length, a);
    }
  } finally { scanner.dispose(); }
});

test('Neovim and grammar highlight queries agree on complete and recovery nodes', () => {
  const grammar = readFileSync(new URL('grammar/tree-sitter-aeon/queries/highlights.scm', root), 'utf8');
  const nvim = readFileSync(new URL('ide/nvim/aeon-nvim/queries/aeon/highlights.scm', root), 'utf8');
  for (const query of [grammar, nvim]) {
    assert(query.includes('(sansa_address) @string.special.path'));
    assert(query.includes('(incomplete_sansa_address) @error'));
  }
});

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
      a => '<tag( '+a+' )>',
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
    for (const address of fixture.unfinished) for (const suffix of ['', ' ', '\t', ' \t  ']) for (const eol of ['', '\r']) {
      const line = 'selected:sansa = '+address+suffix+eol;
      const first = grammar.tokenizeLine(line);
      assert(first.tokens.some(t => t.scopes.includes('invalid.illegal.sansa.incomplete.aeon')), address);
      const second = grammar.tokenizeLine('next = 1', first.ruleStack);
      assert(at(second.tokens, 0, 'variable.other.key.aeon'), address);
      assert(!at(second.tokens, 0, 'meta.address.sansa.aeon'), address);
      assert(!second.tokens.some(t => t.scopes.some(s => s.startsWith('string.quoted'))), address);
    }
  });

  test(host+': complete literals keep trailing layout outside the address scope', () => {
    for (const address of fixture.valid) for (const suffix of [' ', '\t', ' \t  ']) {
      const line = 'selected:sansa = '+address+suffix;
      const start = line.indexOf(address);
      const {tokens} = grammar.tokenizeLine(line);
      assert(at(tokens, start+address.length-1, 'meta.address.sansa.aeon'), line);
      assert(!at(tokens, start+address.length, 'meta.address.sansa.aeon'), line);
      assert(!tokens.some(t => t.scopes.includes('invalid.illegal.sansa.incomplete.aeon')), line);
    }
  });

  test(host+': rejected closed-quote tails and quoted-space controls keep their scopes', () => {
    // Bounded behavior controls for the resource regression. Work/growth is
    // checked separately; these assertions impose no wall-clock threshold.
    for (const count of [64, 128, 256, 512]) for (const unit of [' ', '\t']) {
      const start = 'selected:sansa = ';
      const payload = unit.repeat(count);
      for (const [tail, complete, recovering] of [['"junk', false, false], ['")', true, false], ['', false, true], ['" \t', false, true]]) {
        const address = '$&key("'+payload+tail;
        const {tokens} = grammar.tokenizeLine(start+address);
        assert(at(tokens, start.length, 'meta.address.sansa.aeon'));
        assert.equal(at(tokens, start.length+1, 'meta.address.sansa.aeon'), complete || recovering);
        assert.equal(tokens.some(t => t.scopes.includes('invalid.illegal.sansa.incomplete.aeon')), recovering);
      }
    }
  });

  test(host+': comments and strings keep property lookalikes inert', () => {
    for (const line of ['// $&tag("book")', 'text = '+JSON.stringify('$&key("x")')]) {
      assert(!grammar.tokenizeLine(line).tokens.some(t => t.scopes.includes('meta.address.sansa.aeon')), line);
    }
  });

  test(host + ': retired head selectors keep only their address prefix', () => {
    for (const suffix of ['&headTag("book")', '&headTag("unfinished']) {
      const address = '$.items[0]' + suffix;
      const {tokens} = grammar.tokenizeLine(address);
      assert(at(tokens, 0, 'meta.address.sansa.aeon'), address);
      assert(!at(tokens, address.indexOf('&'), 'meta.address.sansa.aeon'), address);
      assert(!tokens.some(t => t.scopes.includes('invalid.illegal.sansa.incomplete.aeon')), address);
    }
  });

  test(host + ': intrinsic tags, attributes, datatypes and children retain their own scopes', () => {
    const lines = [
      ['<"aeon:header"@{<true>, <"badge⚑"@{mark:string = "ok"}>}:node<list<string>>>',
        [['"aeon:header"', 'entity.name.tag'], ['true', 'entity.name.tag'],
          ['"badge⚑"', 'entity.name.tag'], ['mark', 'variable.other.key'],
          ['node', 'storage.type'], ['list', 'storage.type']]],
      ['owner@{<glyph>} = {<entry>, items=[<leaf>, <leaf()>]}',
        [['glyph', 'entity.name.tag'], ['entry', 'entity.name.tag'], ['leaf', 'entity.name.tag']]],
      [String.raw`<item\id\:node<list<string>>(["value"])>`,
        [['id', 'entity.name.label.identity'], ['list', 'storage.type'], ['string', 'storage.type'],
          ['["value"]', 'meta.node.children'], ['"value"', 'string.quoted.double']]],
      ['<item@{on:string = "lit", true:boolean = true}()>',
        [['on', 'variable.other.key'], ['string', 'storage.type'], ['true:', 'meta.attribute.binding.typed'],
          ['boolean', 'storage.type'], ['"lit"', 'string.quoted.double']]],
      ['<item@{field:list<list<string>> = [["a"]]}:node>',
        [['field', 'variable.other.key'], ['list', 'storage.type'], ['string', 'storage.type']]],
      ['<split:node<list',
        [['list', 'storage.type']]],
      ['  <string>>(["child"])>',
        [['string', 'storage.type'], ['["child"]', 'meta.node.children']]],
      ['<outer:node',
        [['node', 'storage.type']]],
      ['  <string>>',
        [['string', 'storage.type']]],
      ['<typed_child:node',
        [['node', 'storage.type']]],
      ['  <string>("child")>',
        [['string', 'storage.type'], ['"child"', 'meta.node.children']]],
      ['<commented:node // layout',
        [['node', 'storage.type']]],
      ['  <string>>',
        [['string', 'storage.type']]],
      ['<commented_again:node /* layout */',
        [['node', 'storage.type']]],
      ['  <string>>',
        [['string', 'storage.type']]],
      ['<attr@{field:tuple<list',
        [['field', 'variable.other.key'], ['list', 'storage.type']]],
      ['  <string>, int32> = [["a"], 1]}>',
        [['string', 'storage.type'], ['int32', 'storage.type']]],
      ['items = [<unfinished',
        [['unfinished', 'entity.name.tag']]],
      ['  <recovered>,',
        [['recovered', 'entity.name.tag']]],
      ['  <typed_incomplete:node<list',
        [['list', 'storage.type']]],
      ['  <after_type>,',
        [['after_type', 'entity.name.tag']]],
      [']', []],
      ['<broken:node<list',
        [['list', 'storage.type']]],
      ['<recovered>',
        [['recovered', 'entity.name.tag']]],
      ['<scene:node(',
        [['scene', 'entity.name.tag'], ['node', 'storage.type']]],
      ['  "leaf", <child>, (~>ref[0])',
        [['"leaf"', 'string.quoted.double'], ['child', 'entity.name.tag'], ['~>', 'keyword.other.binding.alias']]],
      [')>', [['>', 'punctuation.definition.node.end']]],
      ['<unfinished', [['unfinished', 'entity.name.tag']]],
      ['<following>', [['following', 'entity.name.tag']]],
      ['<also_broken:node<list',
        [['list', 'storage.type']]],
      ['next = 1', [['next', 'variable.other.key']]],
      ['<unclosed@{field:list<string[',
        [['field', 'variable.other.key'], ['string', 'storage.type']]],
      ['}>', [['>', 'punctuation.definition.node.end']]],
      ['next = 2', [['next', 'variable.other.key']]],
    ];
    let stack;
    for (const [line, spans] of lines) {
      const {tokens, ruleStack} = grammar.tokenizeLine(line, stack);
      stack = ruleStack;
      for (const [text, scope] of spans) {
        const start = line.indexOf(text);
        assert(start >= 0, text);
        for (let offset = start; offset < start + text.length; offset++) {
          assert(at(tokens, offset, scope + '.aeon'), host + ' ' + text + ' ' + scope + ' ' + line);
        }
      }
      if (line.startsWith('next')) {
        assert(!tokens.some(t => t.scopes.includes('meta.node.literal.aeon')));
      }
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
    for (const a of fixture.unfinished) for (const suffix of ['', ' ', '\t', ' \t  ']) for (const eol of ['', '\r']) {
      const line = a+suffix+eol;
      const result = scanner.findNextMatchSync(line, 0);
      assert(result, JSON.stringify(line));
      assert.equal(result.captureIndices[0].end, line.length, JSON.stringify(line));
      assert(result.captureIndices[1].length > 0, JSON.stringify(line));
    }
    for (const a of fixture.valid) for (const suffix of [' ', '\t', ' \t  ']) {
      const result = scanner.findNextMatchSync(a+suffix, 0);
      assert.equal(result.captureIndices[0].end, a.length, a);
      assert.equal(result.captureIndices[1].length, 0, a);
    }
    for (const count of [64, 128, 256, 512]) {
      const result = scanner.findNextMatchSync('$&key("'+' '.repeat(count)+'"junk', 0);
      assert.equal(result.captureIndices[0].end, 1);
      assert.equal(result.captureIndices[1].length, 0);
    }
  } finally { scanner.dispose(); }
});

test('Sublime uses the same quoted and bare node tag opener as TextMate', () => {
  const source = readFileSync(new URL('ide/sublime/AEON/AEON.sublime-syntax', root), 'utf8');
  const rule = /  node-literals:\n    - match: '([^\n]+)'/.exec(source);
  assert(rule, 'missing node introducer');
  const vscode = JSON.parse(readFileSync(new URL('ide/vscode/aeon/syntaxes/aeon.tmLanguage.json', root)));
  const opener = rule[1].replaceAll("''", "'");
  assert.equal(opener, vscode.repository['node-literals'].patterns[0].begin);
  const scanner = new oniguruma.OnigScanner([opener]);
  try {
    for (const tag of ['bare', 'on', '"?xml"', "'display name'", '"é😀"']) {
      const line = '<' + tag + '>';
      const {captureIndices} = scanner.findNextMatchSync(line, 0);
      assert.equal(line.slice(captureIndices[2].start, captureIndices[2].end), tag);
    }
    for (const line of ['<"">', "<''>", '<`tag`>']) {
      assert.equal(scanner.findNextMatchSync(line, 0), null);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { jsonToAes, jsonToAeon, jsonToTelex } from '../json-core/src/index.js';
import { tomlToAes, tomlToAeon, tomlToTelex } from '../toml-core/src/index.js';
import { xmlToAes, xmlToAeon, xmlToTelex } from '../xml-core/src/index.js';
import { alogToAes, alogToAeon, alogToTelex } from '../alog-core/src/index.js';
import { yamlToAes, yamlToAeon, yamlToTelex } from '../yaml-core/src/index.js';
const coreUrl = new URL('../../../../aeon/implementations/typescript/packages/core/dist/index.js', import.meta.url);
const core = existsSync(coreUrl) ? await import(coreUrl.href) : null;
const cases = [
  ['JSON', '{"name":"Alice","":{"":1}}', jsonToAes, jsonToAeon, jsonToTelex],
  ['JSON', '[]', jsonToAes, jsonToAeon, jsonToTelex],
  ['JSON', '42', jsonToAes, jsonToAeon, jsonToTelex],
  ['TOML', 'name="Alice"\n""={""=1}', tomlToAes, tomlToAeon, tomlToTelex],
  ['XML', '<?xml version="1.0"?><p a="1">hi<b/>there</p>', xmlToAes, xmlToAeon, xmlToTelex],
  ['ALOG', '&LOG v1\n1, |a\\|b|, "a`b", &UTF8, ^abc, #ff, !none', alogToAes, alogToAeon, alogToTelex],
  ['YAML', 'a: [1, 2]\n"": "yes"', yamlToAes, yamlToAeon, yamlToTelex],
];
for (const [format, input, toAes, toAeon, toTelex] of cases) {
  test(`${format}: wrapper metadata and descendant paths (${input.slice(0, 20)})`, () => {
    const records = toAes(input);
    const root = format === 'XML' ? '$.xml' : '$.[""]';
    assert.ok(records.some(record => record.path === root));
    assert.deepEqual(records.find(record => record.path === root + '.@.source'),
      { path: root + '.@.source', kind: 'SymbolicLiteral', value: format });
    assert.ok(records.every(record => record.path.startsWith(root)
      || (format === 'XML' && record.path.startsWith('$.["?xml"]'))));
    assert.match(toAeon(input), new RegExp(`source = \\|${format}\\|`));
    assert.equal(toAes(input, { sourceMetadata: false }).some(r => r.path === root + '.@.source'), false);
  });
  test(`${format}: portable Telex and AEON round trip (${input.slice(0, 20)})`, { skip: !core && 'Sibling built AEON core unavailable' }, () => {
    const result = core.compileToTelex(toAeon(input, {includeHeader: false, sortKeys: false}));
    assert.deepEqual(result.compile.errors, []);
    assert.equal(result.telex, toTelex(input));
  });
}
test('nested source empty keys stay unique and duplicate detection still applies', () => {
  assert.equal(jsonToAes('{"":{"":1}}').at(-1).path, '$.[""].[""].[""]');
  assert.throws(() => jsonToAes('{"":1,"\\u0000":2,"":3}'), /Duplicate/);
  assert.throws(() => tomlToAes('""=1\n""=2'), /uplicate/);
  assert.throws(() => jsonToAes('42', {mapping: 'native'}), /root must be an object/);
  assert.equal(xmlToAes('<p/>', {mapping: 'native'})[0].path, '$.xml');
});
test('root and metadata count toward resource limits', () => {
  for (const [fn, input] of [[jsonToAes, '{}'], [tomlToAes, ''], [xmlToAes, '<p/>']]) {
    assert.throws(() => fn(input, {limits: {maxEvents: 1}}));
    assert.throws(() => fn(input, {limits: {maxPathDepth: 0}}));
  }
});

test('CLIs use the new wrapper by default and expose explicit legacy selection', () => {
  for (const [fmt, input] of [['json', '42'], ['toml', 'a=1'], ['xml', '<p/>'], ['alog', '&LOG v1\n1'], ['yaml', 'a: 1']]) {
    const bin = fileURLToPath(new URL(`../${fmt}-core/bin/${fmt}-aes.js`, import.meta.url));
    const result = spawnSync(process.execPath, [bin, '--records'], {input, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout)[0].path, fmt === 'xml' ? '$.xml' : '$.[""]');
    if (['json', 'toml', 'xml'].includes(fmt)) {
      const legacy = spawnSync(process.execPath, [bin, '--native', '--records'], {input: fmt === 'json' ? '{"a":1}' : input, encoding: 'utf8'});
      assert.equal(legacy.status, 0, legacy.stderr);
      assert.equal(JSON.parse(legacy.stdout)[0].path, fmt === 'xml' ? '$.xml' : '$.a');
    }
  }
});
const integrationUrls = [
  new URL('../../../../aeon/implementations/typescript/packages/aeos/dist/index.js', import.meta.url),
  new URL('../../../../sansa/src/index.js', import.meta.url),
  new URL('../../../../sansa/tools/query-web/runtime.mjs', import.meta.url),
];
test('default wrapper supports AEOS constraints and SANSA empty-member queries', {
  skip: !integrationUrls.every(url => existsSync(url)) && 'Built AEOS/SANSA sibling integrations unavailable',
}, async () => {
  const [aeos, sansa, runtime] = await Promise.all(integrationUrls.map(url => import(url.href)));
  const schema = { rules: [
    {path: '$.[""]', constraints: {required: true, type: 'ObjectNode'}},
    {path: '$.[""].age', constraints: {required: true, type: 'NumberLiteral', min_value: '18'}},
  ]};
  const telex = jsonToTelex('{"age":42,"name":"Alice"}');
  const valid = aeos.validateTelex(telex, schema);
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));
  assert.equal(aeos.validateTelex(jsonToTelex('{"age":12}'), schema).ok, false);
  const loaded = await runtime.namespaceFromTelexSource(telex);
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  const result = sansa.evaluateQuery('from $.[""] where .age >= 18 select .name', loaded.namespace);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].value.bindings[0].value, 'Alice');
});

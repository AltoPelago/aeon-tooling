import test from 'node:test';
import assert from 'node:assert/strict';
import { yamlToAes, yamlToAeon } from '../src/index.js';
import { jsonToAes } from '../../json-core/src/index.js';

test('YAML 1.2 Core tree values agree with JSON without source metadata', () => {
  const yaml = 'name: Alice\nactive: true\nyes: yes\ndate: 2026-11-09\nlist: [null, 1, "hi"]\n"": {"": []}';
  const json = '{"name":"Alice","active":true,"yes":"yes","date":"2026-11-09","list":[null,1,"hi"],"":{"":[]}}';
  assert.deepEqual(yamlToAes(yaml, { sourceMetadata: false }), jsonToAes(json, { sourceMetadata: false }));
  assert.match(yamlToAeon(yaml), /source = \|YAML\|/);
});
test('retains arbitrary integer and decimal precision, block strings and all root kinds', () => {
  for (const input of ['[1,2]', 'null', 'hello', '{}', '']) assert.equal(yamlToAes(input)[0].path, '$.[""]');
  for (const [input, expected] of [['9007199254740993','9007199254740993'], ['1.234567890123456789','1.234567890123456789'], ['1e999','1e999'], ['0xFF','255'], ['0o17','15'], ['+.5','0.5'], ['01.0','1.0']]) {
    assert.equal(yamlToAes(input)[0].value, expected);
  }
  assert.equal(yamlToAes('|\n  hello\n  world\n')[0].value, 'hello\nworld\n');
});
test('rejects unsupported graphs, tags, keys, streams, duplicates and versions', () => {
  for (const input of ['&a [1]', '[&a 1, *a]', '? [a,b]\n: x', '1: value', '<<: {}', '!custom x', '!!str x', 'a: 1\na: 2', '---\na\n---\nb', '%YAML 1.1\n---\nyes', '.inf', '.nan']) {
    assert.throws(() => yamlToAes(input), undefined, input);
  }
});
test('rejects bad UTF-8, lone surrogates and resource limit violations', () => {
  assert.throws(() => yamlToAes(Uint8Array.of(255)), /UTF-8/);
  assert.throws(() => yamlToAes('"\\uD800"'));
  assert.throws(() => yamlToAes('a: 1', {limits: {maxInputBytes: 1}}), /exceeded/);
  assert.throws(() => yamlToAes('[1,2]', {limits: {maxEvents: 2}}));
});

test('declares YAML version and limited adapter support as ordinary wrapper metadata', () => {
  const records = yamlToAes('42');
  assert.deepEqual(records, [
    {path: '$.[""]', kind: 'NumberLiteral', value: '42'},
    {path: '$.[""].@.source', kind: 'SymbolicLiteral', value: 'YAML'},
    {path: '$.[""].@.support', kind: 'StringLiteral', value: 'limited'},
    {path: '$.[""].@.version', kind: 'StringLiteral', value: '1.2'},
  ]);
  assert.match(yamlToAeon('42'), /""@\{source = \|YAML\|, support = "limited", version = "1.2"\} = 42/);
  assert.deepEqual(yamlToAes('42', {sourceMetadata:false}), [records[0]]);
  assert.equal(yamlToAes('42', {limits:{maxEvents:4, maxKeySegmentCodepoints:7, maxStringCodepoints:7, maxPathDepth:2, maxPathCharacters:16}}).length, 4);
  for (const limits of [{maxEvents:3}, {maxKeySegmentCodepoints:6}, {maxStringCodepoints:6}, {maxPathDepth:1}, {maxPathCharacters:15}]) {
    assert.throws(() => yamlToAes('42', {limits}), /exceed/);
  }
});

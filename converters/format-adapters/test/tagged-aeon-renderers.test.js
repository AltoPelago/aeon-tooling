import assert from 'node:assert/strict';
import test from 'node:test';
import { aesToAeon as renderJson } from '../json-core/src/index.js';
import { aesToAeon as renderToml } from '../toml-core/src/index.js';

const renderers = [['JSON', renderJson], ['TOML', renderToml]];
const record = (path, kind, fields = {}) => ({path, kind, ...fields});
const tagged = (path, tag, fields) => record(path, 'NodeLiteral', {tag, ...fields});

for (const [format, render] of renderers) {
  test(format + ' AEON renderer uses intrinsic keys and direct child positions', () => {
    const records = [
      tagged('$.[\"catalog.v1\"]', 'catalog.v1', {identity:'catalog-1', datatype:'node'}),
      tagged('$.[\"catalog.v1\"].@.badge', 'badge'),
      record('$.[\"catalog.v1\"].@.badge[0]', 'StringLiteral', {value:'ready'}),
      record('$.[\"catalog.v1\"][0]', 'StringLiteral', {value:'Title'}),
      tagged('$.[\"catalog.v1\"][1]', 'item'),
      tagged('$.[\"catalog.v1\"][2]', 'item'),
      record('$.siblings', 'ObjectNode'),
      tagged('$.siblings.child', 'child', {datatype:'custom', clarifiers:[{kind:'StringLiteral', value:'two words'}]}),
      record('$.slots', 'ListNode'),
      record('$.slots[0]', 'ObjectNode', {identity:'slot'}),
      record('$.slots[0].@.source', 'StringLiteral', {value:'local'}),
      tagged('$.slots[0].item', 'item'),
    ];
    assert.equal(render(records, {includeHeader:false}), [
      '<"catalog.v1"\\catalog-1\\@{<badge("ready")>}:node(',
      '  "Title",',
      '  <item>,',
      '  <item>',
      ')>',
      'siblings = {',
      '  <child:custom["two words"]>',
      '}',
      'slots = [',
      '  \\slot\\@{source = "local"} = {',
      '    <item>',
      '  }',
      ']',
      '',
    ].join('\n'));
  });

  test(format + ' AEON renderer preserves the spelling of node null reasons', () => {
    const reasons = ['none', 'notSet', 'notApplicable', 'tombstone', 'notset', 'other reason'];
    const records = [tagged('$.node', 'node'), ...reasons.map((value, index) =>
      record('$.node[' + index + ']', 'NullLiteral', {value}))];
    assert.equal(render(records, {includeHeader:false}),
      '<node(!none, !notSet, !notApplicable, !tombstone, !"notset", !"other reason")>\n');
  });

  test(format + ' AEON renderer rejects invalid tagged records without coercion', () => {
    for (const [records, match] of [
      [[tagged('$.a', 'a'), record('$.a[0]', 'NodeHead', {value:'a'})], /Unsupported.*NodeHead/],
      [[tagged('$.a', 'b')], /Invalid intrinsic node record/],
      [[tagged('$.a', 'a', {value:'a'})], /Invalid intrinsic node record/],
      [[tagged('$.a', 'a'), tagged('$.a.@.b', 'other')], /Invalid intrinsic node record/],
      [[tagged('$.a', 'a'), tagged('$.a[0x]', 'b')], /Invalid index/],
      [[tagged('$.a', 'a'), tagged('$.a[1]', 'b')], /out-of-order child/],
      [[tagged('$.a', 'a'), tagged('$.a[0]', '')], /Invalid intrinsic node record/],
      [[tagged('$.a', 'a'), tagged('$.a[0]', '\ud800')], /Invalid intrinsic node record/],
      [[tagged('$.a', 'a'), tagged('$.a', 'a')], /duplicate record/],
      [[tagged('$.a', 'a', {identity:'same'}), tagged('$.b', 'b', {identity:'same'})], /Duplicate structural identity/],
      [[tagged('$.a', 'a', {datatype:'node', generics:[{datatype:'string'}]})], /cannot preserve generic datatypes/],
    ]) {
      assert.throws(() => render(records), match);
    }
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  jsonToAes,
  jsonToTelex,
  JsonAesError,
  normalizeJsonNumber,
} from '../../test-support/json-core.js';

function expectError(input, code, extra = {}, options) {
  assert.throws(() => jsonToAes(input, options), (error) => {
    assert.ok(error instanceof JsonAesError, `expected JsonAesError, got ${error}`);
    assert.equal(error.code, code, error.message);
    for (const [key, value] of Object.entries(extra)) assert.equal(error[key], value, key);
    return true;
  });
}

test('maps every JSON value type to its AES kind', () => {
  const records = jsonToAes('{"s":"hi","n":12,"t":true,"f":false,"z":null,"o":{},"l":[]}');
  assert.deepEqual(records, [
    { path: '$.s', kind: 'StringLiteral', value: 'hi' },
    { path: '$.n', kind: 'NumberLiteral', value: '12' },
    { path: '$.t', kind: 'BooleanLiteral', value: 'true' },
    { path: '$.f', kind: 'BooleanLiteral', value: 'false' },
    { path: '$.z', kind: 'NullLiteral', value: 'none' },
    { path: '$.o', kind: 'ObjectNode' },
    { path: '$.l', kind: 'ListNode' },
  ]);
});

test('emits depth-first preorder with list indexes', () => {
  const records = jsonToAes('{"a":[1,{"b":[true]}],"c":"x"}');
  assert.deepEqual(records.map((r) => r.path), [
    '$.a', '$.a[0]', '$.a[1]', '$.a[1].b', '$.a[1].b[0]', '$.c',
  ]);
});

test('quotes non-bare member keys canonically', () => {
  const records = jsonToAes('{"weird key":1,"1":2,"@":3,"é":4,"q\\"t":5,"_ok9":6,"a.b":7}');
  assert.deepEqual(records.map((r) => r.path), [
    '$.["weird key"]', '$.["1"]', '$.["@"]', '$.["é"]', '$.["q\\"t"]', '$._ok9', '$.["a.b"]',
  ]);
});

test('canonicalizes numbers like AEON without host conversion', () => {
  const cases = {
    '0': '0', '-0': '-0', '1.50': '1.5', '1.0': '1.0', '1E+5': '1e5', '1e-07': '1e-7',
    '2.50E3': '2.5e3', '1.0e3': '1e3', '0e10': '0e0', '-0.0E-0': '-0e0', '5e0': '5e0',
    '12345678901234567890123': '12345678901234567890123',
    '0.1000000000000000055511151231257827': '0.1000000000000000055511151231257827',
  };
  for (const [lexeme, expected] of Object.entries(cases)) {
    assert.equal(normalizeJsonNumber(lexeme), expected, lexeme);
    assert.equal(jsonToAes(`{"n":${lexeme}}`)[0].value, expected, lexeme);
  }
});

test('decodes string escapes and surrogate pairs', () => {
  const [record] = jsonToAes('{"s":"a\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9\\ud83d\\ude00😀"}');
  assert.equal(record.value, 'a"\\/\b\f\n\r\té😀😀');
});

test('accepts UTF-8 bytes and a leading BOM', () => {
  const bytes = new TextEncoder().encode('\uFEFF{"k":"é"}');
  assert.deepEqual(jsonToAes(bytes), [{ path: '$.k', kind: 'StringLiteral', value: 'é' }]);
  assert.deepEqual(jsonToAes('\uFEFF{}'), []);
});

test('an empty root object is an empty complete stream', () => {
  assert.deepEqual(jsonToAes(' {} '), []);
  assert.equal(jsonToTelex('{}'), 'telex.aes=1\n');
});

test('encodes canonical Telex', () => {
  assert.equal(
    jsonToTelex('{"a":{"b c":"x\\ny"},"n":null,"l":[1]}'),
    [
      'telex.aes=1', '',
      'path=$.a', 'kind=ObjectNode', '',
      'path=$.a.["b c"]', 'kind=StringLiteral', 'value=x\\ny', '',
      'path=$.n', 'kind=NullLiteral', 'value=none', '',
      'path=$.l', 'kind=ListNode', '',
      'path=$.l[0]', 'kind=NumberLiteral', 'value=1', '',
    ].join('\n'),
  );
});

test('rejects non-object roots', () => {
  for (const input of ['[]', '[1]', '"x"', '1', '-1', 'true', 'false', 'null']) {
    expectError(input, 'JSON_ROOT_NOT_OBJECT', { offset: 0 });
  }
  expectError('  [1]', 'JSON_ROOT_NOT_OBJECT', { offset: 2, column: 3 });
});

test('rejects JSON that AEON/AES cannot represent, with precise offsets', () => {
  expectError('{"a":1,"":2}', 'JSON_EMPTY_KEY', { offset: 7, path: '$' });
  expectError('{"a":{"x":1,"x":2}}', 'JSON_DUPLICATE_KEY', { offset: 12, path: '$.a' });
  expectError(
    '{\n  "name": "Alice",\n  "\\u006eame": "Bob"\n}',
    'JSON_DUPLICATE_KEY',
    { line: 3, column: 3, offset: 23, path: '$' },
  );
  expectError('{"a":"\\ud800"}', 'JSON_LONE_SURROGATE', { offset: 6 });
  expectError('{"a":"\\udc00"}', 'JSON_LONE_SURROGATE', { offset: 6 });
  expectError('{"a":"\\ud800\\u0041"}', 'JSON_LONE_SURROGATE', { offset: 6 });
  expectError('{"a":"\ud800"}', 'JSON_LONE_SURROGATE', { offset: 6 });
  expectError('{"\\ud800":1}', 'JSON_LONE_SURROGATE', { offset: 2 });
});

test('upholds third-format adapter principles (no coercion, no invented semantics)', () => {
  // Date-looking, reference-looking, hex-looking, or null-looking strings remain StringLiteral
  const records = jsonToAes(JSON.stringify({
    date: '2026-10-18',
    wtc: '2026-10-18T22:30:00Z&Australia/Melbourne',
    ref: '~$.other',
    hex: '#ff00ff',
    nullSentinel: '!none',
    // Special AEON/AES/JS property names remain ordinary ObjectNode/scalar members
    '@': { a: 1 },
    '$': 'root',
    'aeon:mode': 'strict',
    'aeon:header': { profile: 'custom' },
    conflictAuthority: 'trusted',
  }));
  assert.deepEqual(records, [
    { path: '$.date', kind: 'StringLiteral', value: '2026-10-18' },
    { path: '$.wtc', kind: 'StringLiteral', value: '2026-10-18T22:30:00Z&Australia/Melbourne' },
    { path: '$.ref', kind: 'StringLiteral', value: '~$.other' },
    { path: '$.hex', kind: 'StringLiteral', value: '#ff00ff' },
    { path: '$.nullSentinel', kind: 'StringLiteral', value: '!none' },
    { path: '$.["@"]', kind: 'ObjectNode' },
    { path: '$.["@"].a', kind: 'NumberLiteral', value: '1' },
    { path: '$.["$"]', kind: 'StringLiteral', value: 'root' },
    { path: '$.["aeon:mode"]', kind: 'StringLiteral', value: 'strict' },
    { path: '$.["aeon:header"]', kind: 'ObjectNode' },
    { path: '$.["aeon:header"].profile', kind: 'StringLiteral', value: 'custom' },
    { path: '$.conflictAuthority', kind: 'StringLiteral', value: 'trusted' },
  ]);
});

test('rejects malformed JSON', () => {
  expectError('', 'JSON_UNEXPECTED_END');
  expectError('{', 'JSON_UNEXPECTED_END');
  expectError('{"a":1,}', 'JSON_SYNTAX', { offset: 7 });
  expectError('{"a":[1,]}', 'JSON_SYNTAX', { offset: 8 });
  expectError('{"a" 1}', 'JSON_SYNTAX', { offset: 5 });
  expectError('{a:1}', 'JSON_SYNTAX', { offset: 1 });
  expectError("{'a':1}", 'JSON_SYNTAX', { offset: 1 });
  expectError('{"a":tru}', 'JSON_SYNTAX', { offset: 5 });
  expectError('{"a":nul}', 'JSON_SYNTAX');
  expectError('{"a":NaN}', 'JSON_SYNTAX', { offset: 5 });
  expectError('{"a":Infinity}', 'JSON_SYNTAX');
  expectError('{"a":1} x', 'JSON_TRAILING_CONTENT', { offset: 8 });
  expectError('{"a":1}{}', 'JSON_TRAILING_CONTENT');
  expectError('{"a":"x\ny"}', 'JSON_CONTROL_CHARACTER', { offset: 7 });
  expectError('{"a":"\\x"}', 'JSON_INVALID_ESCAPE', { offset: 6 });
  expectError('{"a":"\\u12G4"}', 'JSON_INVALID_ESCAPE', { offset: 6 });
  expectError('{"a":"abc', 'JSON_UNEXPECTED_END');
  expectError('{"a":1 /* c */}', 'JSON_SYNTAX');
  for (const n of ['01', '-', '1.', '.5', '+1', '1e', '1e+', '-01', '0x10', '1.e3']) {
    assert.throws(() => jsonToAes(`{"n":${n}}`), JsonAesError, n);
  }
  expectError('{"n":01}', 'JSON_INVALID_NUMBER', { offset: 5, path: '$.n' });
});

test('reports UTF-8 byte offsets and code-point columns', () => {
  // "é" is 2 bytes; "😀" is 4 bytes and 2 UTF-16 units but 1 column.
  expectError('{"é😀":1,}', 'JSON_SYNTAX', { offset: 12, line: 1, column: 9 });
  expectError('{\n  "a": 1,\n  "a": 2\n}', 'JSON_DUPLICATE_KEY', { line: 3, column: 3, offset: 14 });
});

test('rejects invalid UTF-8 bytes at the first bad byte', () => {
  expectError(Uint8Array.from([0x7b, 0x22, 0x61, 0xff, 0x22]), 'JSON_INVALID_UTF8', { offset: 3 });
  expectError(Uint8Array.from([0x7b, 0x22, 0xc0, 0xaf]), 'JSON_INVALID_UTF8', { offset: 2 }); // overlong
  expectError(Uint8Array.from([0x7b, 0x22, 0xed, 0xa0, 0x80]), 'JSON_INVALID_UTF8', { offset: 2 }); // surrogate
  expectError(Uint8Array.from([0x7b, 0x22, 0xe2, 0x82]), 'JSON_INVALID_UTF8', { offset: 2 }); // truncated
});

test('enforces resource limits', () => {
  const deep = `{"a":${'['.repeat(300)}${']'.repeat(300)}}`;
  expectError(deep, 'JSON_LIMIT_EXCEEDED', { limit: 'max_value_nesting_depth', observed: 257 });
  assert.equal(jsonToAes(deep, { limits: { maxValueNestingDepth: 300 } }).length, 300);

  expectError('{"a":[1,2,3]}', 'JSON_LIMIT_EXCEEDED', { limit: 'max_list_items' }, { limits: { maxListItems: 2 } });
  expectError('{"a":1,"b":2}', 'JSON_LIMIT_EXCEEDED', { limit: 'max_events' }, { limits: { maxEvents: 1 } });
  expectError('{"a":"😀😀"}', 'JSON_LIMIT_EXCEEDED', { limit: 'max_string_codepoints' }, { limits: { maxStringCodepoints: 1 } });
  assert.equal(jsonToAes('{"a":"😀"}', { limits: { maxStringCodepoints: 1 } }).length, 1);
  expectError('{"abc":1}', 'JSON_LIMIT_EXCEEDED', { limit: 'max_key_segment_codepoints' }, { limits: { maxKeySegmentCodepoints: 2 } });
  expectError('{"a":12345}', 'JSON_LIMIT_EXCEEDED', { limit: 'max_numeric_literal_characters' }, { limits: { maxNumericLiteralCharacters: 4 } });
  expectError('{"a":{"b":1}}', 'JSON_LIMIT_EXCEEDED', { limit: 'max_path_depth' }, { limits: { maxPathDepth: 1 } });
  expectError('{"abcd":1}', 'JSON_LIMIT_EXCEEDED', { limit: 'max_path_characters' }, { limits: { maxPathCharacters: 5 } });
  expectError('{"a":1}', 'JSON_LIMIT_EXCEEDED', { limit: 'max_input_bytes' }, { limits: { maxInputBytes: 3 } });
  assert.throws(() => jsonToAes('{}', { limits: { bogus: 1 } }), TypeError);
});

test('does not treat prototype-like keys specially', () => {
  const records = jsonToAes('{"__proto__":{"constructor":1},"prototype":[]}');
  assert.deepEqual(records.map((r) => r.path), ['$.__proto__', '$.__proto__.constructor', '$.prototype']);
});

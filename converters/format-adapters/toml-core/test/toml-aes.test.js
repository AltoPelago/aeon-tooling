import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tomlToAes,
  tomlToTelex,
  TomlAesError,
  normalizeTomlNumber,
} from '../../test-support/toml-core.js';

function expectError(input, code, extra = {}, options) {
  assert.throws(() => tomlToAes(input, options), (error) => {
    assert.ok(error instanceof TomlAesError, `expected TomlAesError, got ${error}`);
    assert.equal(error.code, code, error.message);
    for (const [key, value] of Object.entries(extra)) assert.equal(error[key], value, key);
    return true;
  });
}

test('maps every TOML scalar and container kind into portable AES', () => {
  const input = `
str = "hello"
int = +42
flt = 3.140
bool_t = true
bool_f = false
inf_p = +inf
inf_n = -inf
nan_p = nan
nan_n = -nan
bin = 0b1010_0101
oct = 0o0755
hex = 0xDEAD_beef
ld = 2026-10-19
lt = 03:30:00.1200
ldt = 2026-10-19 03:30:00
odt = 2026-10-19T03:30:00z
arr = [1, 2]
inline = { k = "v" }
`;
  const records = tomlToAes(input);
  assert.deepEqual(records, [
    { path: '$.str', kind: 'StringLiteral', value: 'hello' },
    { path: '$.int', kind: 'NumberLiteral', value: '42' },
    { path: '$.flt', kind: 'NumberLiteral', value: '3.14' },
    { path: '$.bool_t', kind: 'BooleanLiteral', value: 'true' },
    { path: '$.bool_f', kind: 'BooleanLiteral', value: 'false' },
    { path: '$.inf_p', kind: 'InfinityLiteral', value: 'Infinity' },
    { path: '$.inf_n', kind: 'InfinityLiteral', value: '-Infinity' },
    { path: '$.nan_p', kind: 'NaNLiteral', value: 'NaN' },
    { path: '$.nan_n', kind: 'NaNLiteral', value: '-NaN' },
    {
      path: '$.bin',
      kind: 'RadixLiteral',
      datatype: 'radix',
      generics: [],
      clarifiers: [{ kind: 'NumberLiteral', value: '2' }],
      value: '10100101',
    },
    {
      path: '$.oct',
      kind: 'RadixLiteral',
      datatype: 'radix',
      generics: [],
      clarifiers: [{ kind: 'NumberLiteral', value: '8' }],
      value: '0755',
    },
    {
      path: '$.hex',
      kind: 'RadixLiteral',
      datatype: 'radix',
      generics: [],
      clarifiers: [{ kind: 'NumberLiteral', value: '16' }],
      value: 'DEADBEEF',
    },
    { path: '$.ld', kind: 'DateLiteral', value: '2026-10-19' },
    { path: '$.lt', kind: 'TimeLiteral', value: '03:30:00.1200' },
    { path: '$.ldt', kind: 'DateTimeLiteral', value: '2026-10-19T03:30:00' },
    { path: '$.odt', kind: 'DateTimeLiteral', value: '2026-10-19T03:30:00Z' },
    { path: '$.arr', kind: 'ListNode' },
    { path: '$.arr[0]', kind: 'NumberLiteral', value: '1' },
    { path: '$.arr[1]', kind: 'NumberLiteral', value: '2' },
    { path: '$.inline', kind: 'ObjectNode' },
    { path: '$.inline.k', kind: 'StringLiteral', value: 'v' },
  ]);
});

test('assembles non-contiguous tables, implicit parent tables, dotted keys, and arrays of tables into preorder AES', () => {
  const input = `
[database]
host = "localhost"

[server]
port = 8080

[database.credentials]
user = "admin"

[[products]]
name = "Hammer"
sku.code = "H-1"
sku.batch = 2

[[products]]
name = "Nail"
`;
  const records = tomlToAes(input);
  assert.deepEqual(records.map((r) => r.path), [
    '$.database',
    '$.database.host',
    '$.database.credentials',
    '$.database.credentials.user',
    '$.server',
    '$.server.port',
    '$.products',
    '$.products[0]',
    '$.products[0].name',
    '$.products[0].sku',
    '$.products[0].sku.code',
    '$.products[0].sku.batch',
    '$.products[1]',
    '$.products[1].name',
  ]);
});

test('allows opening an implicit parent table later with [parent]', () => {
  const input = `
[a.b]
x = 1

[a]
y = 2
`;
  assert.deepEqual(tomlToAes(input), [
    { path: '$.a', kind: 'ObjectNode' },
    { path: '$.a.b', kind: 'ObjectNode' },
    { path: '$.a.b.x', kind: 'NumberLiteral', value: '1' },
    { path: '$.a.y', kind: 'NumberLiteral', value: '2' },
  ]);
});

test('parses basic, literal, and multiline strings with line-ending backslash trimming', () => {
  const input = `
basic = "a\\"\\\\\\b\\f\\n\\r\\t\\u00e9\\U0001F600"
lit = 'C:\\Data\\nodejs\\templates'
ml_basic = """
Roses are red
Violets are \\
    blue"""
ml_quotes = """"quoted""""
ml_lit = '''
The first newline is
trimmed in raw strings.
'''
`;
  const records = tomlToAes(input);
  assert.deepEqual(records, [
    { path: '$.basic', kind: 'StringLiteral', value: 'a"\\\b\f\n\r\té😀' },
    { path: '$.lit', kind: 'StringLiteral', value: 'C:\\Data\\nodejs\\templates' },
    { path: '$.ml_basic', kind: 'StringLiteral', value: 'Roses are red\nViolets are blue' },
    { path: '$.ml_quotes', kind: 'StringLiteral', value: '"quoted"' },
    { path: '$.ml_lit', kind: 'StringLiteral', value: 'The first newline is\ntrimmed in raw strings.\n' },
  ]);
});

test('quotes dashed and special TOML keys into canonical SANSA member segments', () => {
  const input = `
bare-dash = 1
1234 = 2
"weird key" = 3
'single.quoted' = 4
`;
  assert.deepEqual(tomlToAes(input).map((r) => r.path), [
    '$.["bare-dash"]',
    '$.["1234"]',
    '$.["weird key"]',
    '$.["single.quoted"]',
  ]);
});

test('canonicalizes TOML decimal integers and floats without float conversion', () => {
  const cases = {
    '+99': '99',
    '0': '0',
    '-0': '-0',
    '+0.0': '0.0',
    '-0.0': '-0.0',
    '1_000': '1000',
    '5_349_221': '5349221',
    '1e06': '1e6',
    '-2E-2': '-2e-2',
    '6.626e-34': '6.626e-34',
    '9_224_617.445_991_228_313': '9224617.445991228313',
    '9223372036854775807': '9223372036854775807',
  };
  for (const [raw, expected] of Object.entries(cases)) {
    assert.equal(normalizeTomlNumber(raw), expected, raw);
    assert.equal(tomlToAes(`n = ${raw}`)[0].value, expected, raw);
  }
});

test('rejects empty keys, duplicate keys (including escaped), and illegal table redefinitions', () => {
  expectError('"" = 1', 'TOML_EMPTY_KEY', { path: '$' });
  expectError("'' = 1", 'TOML_EMPTY_KEY', { path: '$' });
  expectError('a."" = 1', 'TOML_EMPTY_KEY');
  expectError('name = "Alice"\n"\\u006eame" = "Bob"', 'TOML_DUPLICATE_KEY', { line: 2, path: '$' });
  expectError('[a]\nx = 1\n[a]\ny = 2', 'TOML_DUPLICATE_TABLE', { path: '$.a' });
  expectError('a.b = 1\n[a]', 'TOML_DUPLICATE_TABLE', { path: '$.a' });
  expectError('[a.b]\nx = 1\n[a]\nb.c = 2', 'TOML_EXTEND_DEFINED_TABLE', { path: '$.a.b' });
  expectError('a = { b = 1 }\na.c = 2', 'TOML_EXTEND_INLINE_TABLE', { path: '$.a' });
  expectError('a = { b = 1 }\n[a.c]', 'TOML_EXTEND_INLINE_TABLE', { path: '$.a' });
  expectError('a = [1, 2]\n[[a]]', 'TOML_DUPLICATE_TABLE', { path: '$.a' });
});

test('rejects invalid numbers, dates, strings, and inline table violations', () => {
  expectError('a = 01', 'TOML_INVALID_NUMBER');
  expectError('a = 1__0', 'TOML_INVALID_NUMBER');
  expectError('a = 1_', 'TOML_INVALID_NUMBER');
  expectError('a = +0x10', 'TOML_INVALID_NUMBER');
  expectError('a = 0x_10', 'TOML_INVALID_NUMBER');
  expectError('a = 0b102', 'TOML_INVALID_NUMBER');
  expectError('a = 0o78', 'TOML_INVALID_NUMBER');
  expectError('a = .5', 'TOML_INVALID_NUMBER');
  expectError('a = 1.', 'TOML_INVALID_NUMBER');
  expectError('d = 2026-02-29', 'TOML_INVALID_DATETIME');
  expectError('t = 25:00:00', 'TOML_INVALID_DATETIME');
  expectError('dt = 2026-10-19T10:00:00+25:00', 'TOML_INVALID_DATETIME');
  expectError('s = "\\uD800"', 'TOML_LONE_SURROGATE');
  expectError('s = "\\U00110000"', 'TOML_LONE_SURROGATE');
  expectError('t = { a = 1, }', 'TOML_SYNTAX');
  expectError('t = {\n a = 1\n}', 'TOML_SYNTAX');
});

test('upholds third-format adapter principles (no coercion, no invented semantics)', () => {
  const input = `
date_str = "2026-10-19"
ref_str = "~$.other"
null_str = "!none"
toggle_str = "yes"
"@" = { a = 1 }
"$" = "root"
"aeon:mode" = "strict"
`;
  const records = tomlToAes(input);
  assert.deepEqual(records, [
    { path: '$.date_str', kind: 'StringLiteral', value: '2026-10-19' },
    { path: '$.ref_str', kind: 'StringLiteral', value: '~$.other' },
    { path: '$.null_str', kind: 'StringLiteral', value: '!none' },
    { path: '$.toggle_str', kind: 'StringLiteral', value: 'yes' },
    { path: '$.["@"]', kind: 'ObjectNode' },
    { path: '$.["@"].a', kind: 'NumberLiteral', value: '1' },
    { path: '$.["$"]', kind: 'StringLiteral', value: 'root' },
    { path: '$.["aeon:mode"]', kind: 'StringLiteral', value: 'strict' },
  ]);
});

test('encodes canonical Telex including radix[b] datatypes', () => {
  const telex = tomlToTelex('mask = 0b1010\nwhen = 2026-10-19T03:30:00+11:00\n');
  assert.equal(
    telex,
    [
      'telex.aes=1', '',
      'path=$.mask', 'kind=RadixLiteral', 'datatype=radix[2]', 'value=1010', '',
      'path=$.when', 'kind=DateTimeLiteral', 'value=2026-10-19T03:30:00+11:00', '',
    ].join('\n'),
  );
});

test('enforces Aeonic resource limits', () => {
  expectError('a = [1, 2, 3]', 'TOML_LIMIT_EXCEEDED', { limit: 'max_list_items' }, { limits: { maxListItems: 2 } });
  expectError('a = 1\nb = 2', 'TOML_LIMIT_EXCEEDED', { limit: 'max_events' }, { limits: { maxEvents: 1 } });
  expectError('a = "😀😀"', 'TOML_LIMIT_EXCEEDED', { limit: 'max_string_codepoints' }, { limits: { maxStringCodepoints: 1 } });
  expectError('abc = 1', 'TOML_LIMIT_EXCEEDED', { limit: 'max_key_segment_codepoints' }, { limits: { maxKeySegmentCodepoints: 2 } });
  expectError('a = 12345', 'TOML_LIMIT_EXCEEDED', { limit: 'max_numeric_literal_characters' }, { limits: { maxNumericLiteralCharacters: 4 } });
  expectError('a.b = 1', 'TOML_LIMIT_EXCEEDED', { limit: 'max_path_depth' }, { limits: { maxPathDepth: 1 } });
  expectError('abcd = 1', 'TOML_LIMIT_EXCEEDED', { limit: 'max_path_characters' }, { limits: { maxPathCharacters: 5 } });
  expectError('a = [[1]]', 'TOML_LIMIT_EXCEEDED', { limit: 'max_value_nesting_depth' }, { limits: { maxValueNestingDepth: 1 } });
});

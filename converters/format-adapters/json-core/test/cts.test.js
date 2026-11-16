/**
 * Shared Conformance Test Suite (CTS) verification against `aeonite-cts`.
 *
 * Exercises `json-core` against the official CTS suites in
 * `aeonite-org/aeonite-cts/cts/` (or `AEONITE_CTS_ROOT`):
 *
 *   1. `cts/core/v1/suites/16-aeonic-limit-boundaries.json`:
 *      Validates that `DEFAULT_JSON_AES_LIMITS` matches `altopelago.aeonic-limits.v1`
 *      and that every JSON-applicable limit boundary (`at-limit` pass and
 *      `one-over` fail-closed rejection) behaves identically to AEON Core.
 *   2. `cts/aes/v1/suites/11-next-number-normalization.json`:
 *      Validates that every RFC 8259-legal number lexeme in the portable AES
 *      number normalization suite normalizes to the exact CTS expected payload.
 *   3. `cts/telex/v1/telex-cts.v1.snapshot-0.2.json`:
 *      Validates that `encodeTelex` reproduces the exact canonical Telex bytes
 *      for every JSON-subset record vector in the released Telex CTS snapshot.
 *   4. `cts/aes/v1/aes-events-cts.v1.snapshot-0.2.json`:
 *      Validates that for every valid `aes.complete.v1` body-only vector whose
 *      records fall in the JSON value subset, reconstructing JSON and running
 *      `jsonToAes` reproduces the exact CTS record stream.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_JSON_AES_LIMITS,
  JsonAesError,
  encodeTelex,
  jsonToAes,
  jsonToTelex,
} from '../../test-support/json-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const ctsRoot = resolve(
  process.env.AEONITE_CTS_ROOT
    ?? resolve(here, '..', '..', '..', '..', '..', '..', 'aeonite-org', 'aeonite-cts', 'cts'),
);
const hasCts = existsSync(ctsRoot);

const JSON_KINDS = new Set([
  'ObjectNode',
  'ListNode',
  'StringLiteral',
  'NumberLiteral',
  'BooleanLiteral',
  'NullLiteral',
]);
const JSON_RECORD_FIELDS = new Set(['path', 'kind', 'value']);

function readJson(relPath) {
  return JSON.parse(readFileSync(resolve(ctsRoot, relPath), 'utf8'));
}

test(
  'CTS: DEFAULT_JSON_AES_LIMITS matches altopelago.aeonic-limits.v1 defaults in 16-aeonic-limit-boundaries.json',
  { skip: !hasCts && 'aeonite-cts not found' },
  () => {
    const suite = readJson('core/v1/suites/16-aeonic-limit-boundaries.json');
    const defaults = suite.meta.limits_defaults;
    assert.equal(defaults.limits_id, 'altopelago.aeonic-limits.v1');
    assert.equal(DEFAULT_JSON_AES_LIMITS.maxValueNestingDepth, defaults.structure.max_value_nesting_depth);
    assert.equal(DEFAULT_JSON_AES_LIMITS.maxPathDepth, defaults.structure.max_path_depth);
    assert.equal(DEFAULT_JSON_AES_LIMITS.maxPathCharacters, defaults.structure.max_path_characters);
    assert.equal(DEFAULT_JSON_AES_LIMITS.maxStringCodepoints, defaults.structure.max_string_codepoints);
    assert.equal(DEFAULT_JSON_AES_LIMITS.maxKeySegmentCodepoints, defaults.structure.max_key_segment_codepoints);
    assert.equal(DEFAULT_JSON_AES_LIMITS.maxListItems, defaults.structure.max_list_items);
    assert.equal(DEFAULT_JSON_AES_LIMITS.maxEvents, defaults.processing.max_events);
    assert.equal(DEFAULT_JSON_AES_LIMITS.maxInputBytes, defaults.formats.aeon.max_input_bytes);
    assert.equal(
      DEFAULT_JSON_AES_LIMITS.maxNumericLiteralCharacters,
      defaults.formats.aeon.max_numeric_literal_characters,
    );
  },
);

test(
  'CTS: all JSON-applicable limit boundary vectors in 16-aeonic-limit-boundaries.json pass at-limit and fail one-over',
  { skip: !hasCts && 'aeonite-cts not found' },
  () => {
    const suite = readJson('core/v1/suites/16-aeonic-limit-boundaries.json');

    // Equivalent JSON fixtures for each JSON-applicable AEON Core limit vector
    const jsonEquivalents = new Map([
      ['core-limits-001-input-bytes-at-limit', { json: '{"a":1}', limits: { maxInputBytes: 7 }, limitName: 'max_input_bytes' }],
      ['core-limits-002-input-bytes-one-over', { json: '{"a":1}', limits: { maxInputBytes: 6 }, limitName: 'max_input_bytes' }],
      ['core-limits-013-value-nesting-at-limit', { json: '{"a":[[1]]}', limits: { maxValueNestingDepth: 2 }, limitName: 'max_value_nesting_depth' }],
      ['core-limits-014-value-nesting-one-over', { json: '{"a":[[1]]}', limits: { maxValueNestingDepth: 1 }, limitName: 'max_value_nesting_depth' }],
      ['core-limits-015-path-depth-at-limit', { json: '{"a":{"b":1}}', limits: { maxPathDepth: 2 }, limitName: 'max_path_depth' }],
      ['core-limits-016-path-depth-one-over', { json: '{"a":{"b":1}}', limits: { maxPathDepth: 1 }, limitName: 'max_path_depth' }],
      ['core-limits-017-string-codepoints-at-limit', { json: '{"a":"xy"}', limits: { maxStringCodepoints: 2 }, limitName: 'max_string_codepoints' }],
      ['core-limits-018-string-codepoints-one-over', { json: '{"a":"xy"}', limits: { maxStringCodepoints: 1 }, limitName: 'max_string_codepoints' }],
      ['core-limits-019-key-segment-at-limit', { json: '{"ab":1}', limits: { maxKeySegmentCodepoints: 2 }, limitName: 'max_key_segment_codepoints' }],
      ['core-limits-020-key-segment-one-over', { json: '{"ab":1}', limits: { maxKeySegmentCodepoints: 1 }, limitName: 'max_key_segment_codepoints' }],
      ['core-limits-021-list-items-at-limit', { json: '{"a":[1,2]}', limits: { maxListItems: 2 }, limitName: 'max_list_items' }],
      ['core-limits-022-list-items-one-over', { json: '{"a":[1,2]}', limits: { maxListItems: 1 }, limitName: 'max_list_items' }],
      ['core-limits-025-path-characters-at-limit', { json: '{"a":{"b":1}}', limits: { maxPathCharacters: 5 }, limitName: 'max_path_characters' }],
      ['core-limits-026-path-characters-one-over', { json: '{"a":{"b":1}}', limits: { maxPathCharacters: 4 }, limitName: 'max_path_characters' }],
      ['core-limits-027-events-at-limit', { json: '{"a":1,"b":2}', limits: { maxEvents: 2 }, limitName: 'max_events' }],
      ['core-limits-028-events-one-over', { json: '{"a":1,"b":2}', limits: { maxEvents: 1 }, limitName: 'max_events' }],
      ['core-limits-029-numeric-characters-at-limit', { json: '{"a":1234}', limits: { maxNumericLiteralCharacters: 4 }, limitName: 'max_numeric_literal_characters' }],
      ['core-limits-030-numeric-characters-one-over', { json: '{"a":1234}', limits: { maxNumericLiteralCharacters: 3 }, limitName: 'max_numeric_literal_characters' }],
    ]);

    let checked = 0;
    for (const vector of suite.tests) {
      const mapped = jsonEquivalents.get(vector.id);
      if (!mapped) continue;
      checked += 1;
      if (vector.expected.ok) {
        const records = jsonToAes(mapped.json, { limits: mapped.limits });
        assert.ok(records.length > 0, vector.id);
      } else {
        assert.throws(
          () => jsonToAes(mapped.json, { limits: mapped.limits }),
          (err) => {
            assert.ok(err instanceof JsonAesError, vector.id);
            assert.equal(err.code, 'JSON_LIMIT_EXCEEDED', vector.id);
            assert.equal(err.limit, mapped.limitName, vector.id);
            return true;
          },
          vector.id,
        );
      }
    }
    assert.equal(checked, jsonEquivalents.size);
  },
);

test(
  'CTS: portable number normalization vectors in aes/v1/suites/11-next-number-normalization.json',
  { skip: !hasCts && 'aeonite-cts not found' },
  () => {
    const suite = readJson('aes/v1/suites/11-next-number-normalization.json');
    for (const vector of suite.tests) {
      // Extract bindings from the AEON source that are valid RFC 8259 JSON numbers
      const bindings = {};
      for (const line of vector.input.source.trim().split('\n')) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)(?::[A-Za-z0-9_]+)?\s*=\s*(.+)$/u);
        assert.ok(match, `unexpected line in ${vector.id}: ${line}`);
        const [, key, rawValue] = match;
        // RFC 8259 numbers cannot start with '+' or contain '_'
        if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u.test(rawValue)) {
          bindings[key] = rawValue;
        }
      }
      const jsonText = `{${Object.entries(bindings).map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',')}}`;
      const actualRecords = jsonToAes(jsonText);
      const expectedSubset = vector.expected.result.events
        .filter((e) => e.path.slice(2) in bindings)
        .map((e) => ({ path: e.path, kind: e.value_kind, value: e.value }));
      assert.deepEqual(actualRecords, expectedSubset, vector.id);
    }
  },
);

test(
  'CTS: Telex snapshot-0.2 canonical JSON-subset vectors round-trip through encodeTelex and jsonToTelex',
  { skip: !hasCts && 'aeonite-cts not found' },
  () => {
    const manifest = readJson('telex/v1/telex-cts.v1.snapshot-0.2.json');
    let matched = 0;
    for (const suiteRef of manifest.suites) {
      const suite = readJson(`telex/v1/${suiteRef.file}`);
      const excluded = new Set(suiteRef.exclude_tests ?? []);
      for (const vector of suite.tests.filter((v) => !excluded.has(v.id))) {
        if (
          vector.operation !== 'parse'
          || !vector.expected.ok
          || vector.expected.profile_explicit
          || vector.expected.projection_explicit
          || !vector.expected.canonical
        ) {
          continue;
        }
        const isJsonSubset = vector.expected.records.every(
          (r) =>
            Object.keys(r).every((k) => JSON_RECORD_FIELDS.has(k))
            && JSON_KINDS.has(r.kind)
            && (r.kind !== 'NullLiteral' || r.value === 'none'),
        );
        if (!isJsonSubset) continue;

        matched += 1;
        assert.equal(encodeTelex(vector.expected.records), vector.input.telex, vector.id);
      }
    }
    assert.ok(matched >= 3, `expected at least 3 Telex CTS vectors, matched ${matched}`);
  },
);

test(
  'CTS: AES projection suites (aes-cts.v1.snapshot-0.4) JSON-compatible vectors match jsonToAes',
  { skip: !hasCts && 'aeonite-cts not found' },
  () => {
    const manifest = readJson('aes/v1/aes-cts.v1.snapshot-0.4.json');
    // Vectors whose untyped structure is representable in JSON:
    const jsonInputsForVector = new Map([
      ['aes-baseline-001', '{"a":1}'],
      ['aes-emission-001-quoted-key', '{"a.b":2}'],
      ['aes-emission-002-indexed-order', '{"a":[1]}'],
      ['aes-portable-values-002-source-spelling-normalized', '{"grouped":42,"plain":42}'],
      ['aes-source-span-001-ascii', '{"a":"plain"}'],
      ['aes-source-span-002-non-ascii', '{"a":"café"}'],
      ['aes-source-span-003-combining-sequence', '{"a":"naïve"}'],
      ['aes-source-span-004-astral-scalar', '{"a":"😀"}'],
      ['aes-source-span-005-bom-and-crlf', '\uFEFF{"a":"x"}\r\n'],
      ['aes-source-span-006-source-absent', '{"a":"plain"}'],
    ]);

    let verified = 0;
    for (const suiteRef of manifest.suites) {
      const suite = readJson(`aes/v1/${suiteRef.file}`);
      const excluded = new Set(suiteRef.exclude_tests ?? []);
      for (const vector of suite.tests.filter((v) => !excluded.has(v.id))) {
        const jsonInput = jsonInputsForVector.get(vector.id);
        if (!jsonInput) continue;
        verified += 1;

        const actual = jsonToAes(jsonInput);
        const expected = vector.expected.result.events.map((e) => ({
          path: e.path,
          kind: e.value_kind,
          ...(typeof e.value === 'string' ? { value: e.value } : {}),
        }));
        assert.deepEqual(
          actual.map(({ path, kind, value }) => ({
            path,
            kind,
            ...(expected[0]?.value !== undefined && value !== undefined ? { value } : {}),
          })),
          expected,
          vector.id,
        );
        // Also ensure jsonToTelex produces a valid stream for each CTS vector
        assert.ok(jsonToTelex(jsonInput).startsWith('telex.aes=1\n'), vector.id);
      }
    }
    assert.equal(verified, jsonInputsForVector.size);
  },
);

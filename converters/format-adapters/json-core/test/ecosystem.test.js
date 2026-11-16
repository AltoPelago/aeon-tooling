// Differential tests against the real Aeonite ecosystem in the aeon-family
// sibling layout. Each oracle is skipped when its sibling checkout is absent.
//
//   1. AES reference codec (aes/src/telex.js): every output must be a valid,
//      canonical `aes.complete.v1` Telex stream.
//   2. AEON compiler (aeon core): the same document written as AEON must
//      produce byte-identical Telex. This is the "JSON is a subset of AEON"
//      claim, checked directly.
//   3. AEON finalizer (AES -> JSON): records must materialize back to the
//      value JSON.parse produces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jsonToAeon, jsonToAes, jsonToTelex } from '../../test-support/json-core.js';

const family = fileURLToPath(new URL('../../../../../', import.meta.url));
const ts = `${family}aeon/implementations/typescript/packages/`;
const paths = {
  aes: `${family}aes/src/telex.js`,
  core: `${ts}core/dist/index.js`,
  finalize: `${ts}finalize/dist/index.js`,
  canonical: `${ts}canonical/dist/index.js`,
};
const load = async (path) => (existsSync(path) ? import(path) : null);
const aes = await load(paths.aes);
const core = await load(paths.core);
const finalize = await load(paths.finalize);
const canonical = await load(paths.canonical);

// ---- deterministic random JSON documents ----------------------------------

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = ['a', 'B_1', '_x', 'name', 'weird key', '1', '0x', 'é', '日本', '😀', 'q"t', 'b\\s',
  'tab\t', 'a.b', 'a[0]', '-', '~', 'x=y', 'line\nbreak', ' ', '\u0001'];
const RESERVED_FOR_FINALIZE = ['@', '$', '__proto__', 'constructor', 'prototype'];
const STRINGS = ['', 'x', 'hello world', 'é😀', 'q"b\\s/', '\b\f\n\r\t', '\u0000\u001f\u007f',
  '!none', '~$.a', '#ff', '2025-01-01', 'true', '1.50', '\u2028\u2029', 'a=b', '[1]'];

function generate(seed, { safe }) {
  const random = rng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const keyPool = safe ? KEYS : [...KEYS, ...RESERVED_FOR_FINALIZE];
  const digits = (n) => Array.from({ length: n }, () => Math.floor(random() * 10)).join('');
  const number = () => {
    let s = random() < 0.3 ? '-' : '';
    s += random() < 0.2 ? '0' : `${1 + Math.floor(random() * 9)}${digits(Math.floor(random() * (safe ? 6 : 25)))}`;
    if (random() < 0.4) s += `.${digits(1 + Math.floor(random() * 4))}`;
    if (random() < 0.3) {
      s += `${pick(['e', 'E'])}${pick(['', '+', '-'])}${digits(1 + Math.floor(random() * (safe ? 1 : 3)))}`;
    }
    return { number: s };
  };
  const value = (depth) => {
    const r = random();
    if (depth < 5 && r < 0.18) {
      const keys = [...new Set(Array.from({ length: Math.floor(random() * 5) }, () => pick(keyPool)))];
      return { object: keys.map((key) => [key, value(depth + 1)]) };
    }
    if (depth < 5 && r < 0.33) return { array: Array.from({ length: Math.floor(random() * 5) }, () => value(depth + 1)) };
    if (r < 0.55) return { string: pick(STRINGS) };
    if (r < 0.8) return number();
    if (r < 0.9) return { boolean: random() < 0.5 };
    return { null: true };
  };
  const keys = [...new Set(Array.from({ length: 1 + Math.floor(random() * 6) }, () => pick(keyPool)))];
  return { object: keys.map((key) => [key, value(1)]) };
}

function toJson(node) {
  if ('object' in node) return `{${node.object.map(([k, v]) => `${JSON.stringify(k)}:${toJson(v)}`).join(',')}}`;
  if ('array' in node) return `[${node.array.map(toJson).join(', ')}]`;
  if ('string' in node) return JSON.stringify(node.string);
  if ('number' in node) return node.number;
  if ('boolean' in node) return String(node.boolean);
  return 'null';
}

function toAeonValue(node) {
  if ('object' in node) return `{ ${node.object.map(([k, v]) => `${JSON.stringify(k)} = ${toAeonValue(v)}`).join(', ')} }`;
  if ('array' in node) return `[${node.array.map(toAeonValue).join(', ')}]`;
  if ('null' in node) return '!none';
  return toJson(node);
}

const toAeonDocument = (root) => root.object.map(([k, v]) => `${JSON.stringify(k)} = ${toAeonValue(v)}`).join('\n');

const CASES = 400;
const FIXED = [
  '{}',
  '{"a":{"b":{"c":[[[]],{}]}}}',
  '{"n":[0,-0,1.50,1E+5,1e-07,-0.0E-0,12345678901234567890123]}',
  '{"s":"\\u00e9\\ud83d\\ude00\\/\\b\\f","z":null,"t":true}',
];

// ---- oracles --------------------------------------------------------------

test('output is valid, canonical aes.complete.v1 Telex (AES reference codec)', { skip: !aes && 'aes sibling not found' }, () => {
  const inputs = [...FIXED, ...Array.from({ length: CASES }, (_, i) => toJson(generate(i + 1, { safe: false })))];
  for (const input of inputs) {
    const telex = jsonToTelex(input);
    const result = aes.validateTelex(telex);
    assert.deepEqual(result.diagnostics, [], input);
    assert.equal(aes.canonicalizeTelex(telex), telex, input);
    assert.deepEqual(aes.parseTelex(telex).records, jsonToAes(input), input);
  }
});

test('JSON and the equivalent AEON document produce identical Telex (AEON compiler)', { skip: !core && 'aeon core dist not found' }, () => {
  for (let i = 1; i <= CASES; i += 1) {
    const root = generate(i, { safe: false });
    const json = toJson(root);
    const aeon = toAeonDocument(root);
    const compiled = core.compileToTelex(aeon, {});
    assert.deepEqual(compiled.compile.errors, [], `AEON rejected:\n${aeon}`);
    assert.equal(jsonToTelex(json), compiled.telex, `seed ${i}\nJSON: ${json}\nAEON: ${aeon}`);
  }
});

test('AES records materialize back to JSON.parse output (AEON finalizer)', { skip: !finalize && 'aeon finalize dist not found' }, () => {
  const inputs = [...FIXED.filter((s) => !s.includes('1234567890123')), ...Array.from({ length: CASES }, (_, i) => toJson(generate(i + 1, { safe: true })))];
  for (const input of inputs) {
    const { document, meta } = finalize.finalizePortableJson(jsonToAes(input));
    assert.deepEqual(meta?.errors ?? [], [], input);
    assert.deepEqual(document, JSON.parse(input), input);
  }
});

test('JSON -> AEON matches canonical AEON representation (@altopelago/aeon-canonical)', { skip: !canonical && 'aeon canonical dist not found' }, () => {
  for (let i = 1; i <= CASES; i += 1) {
    const root = generate(i, { safe: false });
    const json = toJson(root);
    const aeon = toAeonDocument(root);
    const fromJson = jsonToAeon(json);
    const expectedCanonical = canonical.canonicalize(aeon);
    assert.deepEqual(expectedCanonical.errors, [], `canonicalize rejected seed ${i}:\n${aeon}`);
    assert.equal(fromJson, expectedCanonical.text, `seed ${i}\nJSON: ${json}`);
    // Verify idempotence when passed through canonicalize() again
    assert.equal(canonical.canonicalize(fromJson).text, fromJson, `seed ${i} not idempotent`);
  }

  // Also check examples/inventory.json
  const inventoryJson = readFileSync(new URL('../examples/inventory.json', import.meta.url), 'utf8');
  const inventoryAeon = jsonToAeon(inventoryJson);
  const reCanonicalized = canonical.canonicalize(inventoryAeon);
  assert.deepEqual(reCanonicalized.errors, []);
  assert.equal(inventoryAeon, reCanonicalized.text);
});

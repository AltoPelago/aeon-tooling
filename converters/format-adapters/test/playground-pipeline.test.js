import test from 'node:test';
import assert from 'node:assert/strict';
import { cases } from '../examples/validate-and-query/cases.mjs';
import { createPipelineRunner } from '../playground/pipeline.mjs';
import { createPlaygroundServer } from '../playground/server.mjs';
import { loadRuntimes, verifyXmlQuerySupport } from '../examples/validate-and-query/pipeline.mjs';

let runtime, unavailable;
try { runtime = await loadRuntimes(); } catch (error) { unavailable = error.message; }
const options = { skip: unavailable };
const inputFor = example => ({ format: example.format, source: example.source,
  schema: example.schema, query: example.queries[0].text, runQuery: true });
const run = createPipelineRunner(async () => runtime);

test('pipeline: XML equality distinguishes element tags through Telex', options, async () => {
  const input = inputFor(cases.find(example => example.format === 'xml'));
  input.schema = 'aeos:schema = { rules:list<object> = [{path:sansa = $.xml, constraints:object = {required:boolean = true}}] }';
  input.query = 'from $.xml[0] where ?[0] == ?[1] select ?';
  for (const [source, count] of [['<r><item/><other/></r>', 0], ['<r><item/><item/></r>', 1]]) {
    const result = await run({ ...input, source });
    assert.equal(result.validation.ok, true, JSON.stringify(result.validation.errors));
    assert.equal(result.query?.ok, true, JSON.stringify(result.runtimeError ?? result.query?.errors));
    assert.equal(result.query.count, count);
  }
  input.source = '<r><item/><other/></r>';
  const incompatible = createPipelineRunner(async () => ({
    ...runtime,
    requireXmlQuerySupport: () => verifyXmlQuerySupport(async () => ({ok: true, count: 0})),
    evaluateTelexQuery() { assert.fail('The incompatible runtime must not evaluate the XML query'); },
  }));
  const stopped = await incompatible(input);
  assert.equal(stopped.runtimeError.code, 'XML_QUERY_RUNTIME_UNAVAILABLE');
  assert.equal(stopped.validation.ok, true);
  assert.ok(stopped.records.some(record => record.tag === 'other'));
  assert.equal(stopped.query, null);
  const validationOnly = await incompatible({ ...input, runQuery: false });
  assert.equal(validationOnly.runtimeError, undefined);
  assert.equal(validationOnly.validation.ok, true);
});

test('pipeline: every UI example returns AES, validation and JSON-safe typed SANSA results', options, async () => {
  for (const example of cases) {
    for (const query of example.queries) {
      const result = await run({ ...inputFor(example), query: query.text });
      assert.equal(result.validation.ok, true);
      assert.equal(result.query.ok, true, JSON.stringify(result.query.errors));
      const matches = result.query.results.flatMap(row => row.value.bindings);
      assert.deepEqual(matches.map(binding => binding.value), query.expected);
      for (const binding of matches) {
        const record = result.records.find(record => record.path === binding.address);
        assert.ok(record);
        assert.equal(binding.representationKind, record.kind);
      }
      assert.doesNotThrow(() => JSON.stringify(result));
    }
    const rejected = await run({ ...inputFor(example), source: example.invalidSource });
    assert.equal(rejected.validation.ok, false);
    assert.ok(rejected.validation.errors.some(error => error.path === example.invalidPath));
    assert.ok(rejected.records.length);
    assert.equal(rejected.query, null);
  }
});

test('pipeline: edited queries support binding, scalar and object projections and report syntax errors separately', options, async () => {
  const input = inputFor(cases[0]);
  const changed = await run({ ...input, query: 'from $.[""].items.* where .price >= 10 select .sku' });
  assert.equal(changed.query.results[0].value.bindings[0].value, 'B2');
  const empty = await run({ ...input, query: 'from $.[""].items.* where .price > 100 select .sku' });
  assert.equal(empty.query.ok, true);
  assert.equal(empty.query.count, 0);
  for (const query of ['from $.[""].items.* select "literal"', 'from $.[""].items.* select { sku = .sku }']) {
    const result = await run({ ...input, query });
    assert.equal(result.query.ok, true, JSON.stringify(result.query.errors));
    assert.doesNotThrow(() => JSON.stringify(result));
  }
  const bad = await run({ ...input, query: 'from' });
  assert.equal(bad.validation.ok, true);
  assert.equal(bad.query.ok, false);
  assert.ok(bad.query.errors.length);
  assert.ok(bad.records.length);
});

test('pipeline: schema edits, validation-only runs and unavailable runtimes keep imported AES inspectable', options, async () => {
  const input = inputFor(cases[0]);
  const only = await run({ ...input, runQuery: false, query: 'invalid query deliberately not evaluated' });
  assert.equal(only.validation.ok, true);
  assert.equal(only.query, null);
  for (const schema of ['aeos:schema = {', 'aeos:schema = { rules = 42 }']) {
    const bad = await run({ ...input, schema });
    assert.equal(bad.schemaError.code, 'INVALID_SCHEMA');
    assert.equal(bad.validation, null);
    assert.equal(bad.query, null);
    assert.ok(bad.records.length);
  }
  const strict = input.schema.replace('min_value:number = 0', 'min_value:number = 10');
  assert.notEqual(strict, input.schema);
  assert.equal((await run({ ...input, schema: strict })).validation.ok, false);
  let attempts = 0;
  const retry = createPipelineRunner(async () => {
    if (++attempts === 1) throw new Error('Build required');
    return runtime;
  });
  const missing = await retry(input);
  assert.equal(missing.runtimeError.code, 'PIPELINE_RUNTIME_UNAVAILABLE');
  assert.ok(missing.records.length);
  assert.equal((await retry(input)).query.ok, true);
});

test('pipeline: native AEOS comments, SANSA literals and exact numeric constraints are parsed before validation', options, async () => {
  const input = inputFor(cases[0]);
  const schema = `//! format:aeos-v1
// Check an exact number outside the JavaScript safe integer range.
aeos:schema = {
  rules:list<object> = [{
    path:sansa = $.[""].large
    constraints:object = {
      required:boolean = true
      type:string = "NumberLiteral"
      min_value:number = 9007199254740993
    }
  }]
}
`;
  const passed = await run({ ...input, schema });
  assert.equal(passed.validation.ok, true);
  assert.equal(passed.query.ok, true);
  const failed = await run({ ...input, schema: schema.replace('9007199254740993', '9007199254740994') });
  assert.equal(failed.validation.ok, false);
  assert.equal(failed.validation.errors[0].path, '$.[""].large');
  assert.equal(failed.query, null);
});

test('pipeline HTTP: examples, real validation/query results, limits and same-origin boundaries', options, async t => {
  const server = createPlaygroundServer(() => { throw new Error('Conversion should not be called'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (body, extra = {}) => fetch(url + '/api/pipeline', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body),
  });
  const examples = await (await fetch(url + '/api/pipeline/examples')).json();
  assert.deepEqual(examples.examples, cases);
  assert.equal((await fetch(url + '/pipeline.js')).status, 200);
  const input = inputFor(cases[0]);
  const response = await post(input);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.validation.ok, true);
  assert.equal(result.query.results[0].value.bindings[0].value, 'A1');
  const invalid = await (await post({ ...input, source: cases[0].invalidSource })).json();
  assert.equal(invalid.validation.ok, false);
  assert.equal(invalid.query, null);
  assert.equal((await post({ ...input, source: '{' })).status, 422);
  assert.equal((await post({ ...input, format: 'aeon' })).status, 422);
  assert.equal((await post({ ...input, schema: {} })).status, 422);
  assert.equal((await post({ ...input, query: 'x'.repeat(65_537) })).status, 422);
  assert.equal((await post({ ...input, schema: 'x'.repeat(262_145) })).status, 422);
  assert.equal((await post({ ...input, source: 'x'.repeat(1_048_577) })).status, 413);
  assert.equal((await post(input, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await fetch(url + '/api/pipeline/examples', { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(url + '/api/pipeline', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(url + '/examples/validate-and-query/pipeline.mjs')).status, 404);
});

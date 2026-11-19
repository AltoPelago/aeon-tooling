import test from 'node:test';
import assert from 'node:assert/strict';
import { cases } from '../examples/validate-and-query/cases.mjs';
import { loadRuntimes, runPipeline, summarizeQuery } from '../examples/validate-and-query/pipeline.mjs';

// Like the conversion playground tests, integration requires built local AEON
// packages. A missing checkout is reported as an explicit skip, not a mock pass.
let runtime, unavailable;
try { runtime = await loadRuntimes(); } catch (error) { unavailable = error.message; }
for (const example of cases) {
  test(`${example.format}: imported AES passes AEOS and real SANSA queries`, { skip: unavailable }, async () => {
    const output = await runPipeline(example, runtime);
    assert.equal(output.validation.ok, true, JSON.stringify(output.validation.errors));
    assert.equal(output.queries.length, example.queries.length);
    for (const [index, query] of output.queries.entries()) {
      const matches = summarizeQuery(query.result);
      assert.deepEqual(matches.map(match => match.value), example.queries[index].expected);
      for (const match of matches) {
        const record = output.records.find(record => record.path === match.address);
        assert.ok(record, match.address);
        assert.equal(match.kind, record.kind);
        assert.equal(match.value, record.value);
        if (record.datatype) assert.equal(match.datatype, record.datatype);
      }
    }
  });
  test(`${example.format}: invalid data fails AEOS before SANSA executes`, { skip: unavailable }, async () => {
    const output = await runPipeline({ ...example, source: example.invalidSource }, {
      ...runtime,
      namespaceFromTelexSource() { assert.fail('Invalid data must not enter the query namespace'); },
      evaluateQuery() { assert.fail('Invalid data must not be queried'); },
    });
    assert.equal(output.validation.ok, false);
    assert.ok(output.validation.errors.some(error => error.path === example.invalidPath));
    assert.deepEqual(output.queries, []);
  });
}

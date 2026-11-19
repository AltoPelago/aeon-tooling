import assert from 'node:assert/strict';
import { cases } from './cases.mjs';
import { loadRuntimes, runPipeline, summarizeQuery } from './pipeline.mjs';

const args = process.argv.slice(2);
const selected = args.length === 0 ? cases : cases.filter(example => args.includes(example.format));
if (args.some(format => !cases.some(example => example.format === format))) {
  console.error('Usage: npm run examples:adapters -- [json toml yaml xml alog]');
  process.exitCode = 1;
} else {
  const runtime = await loadRuntimes();
  for (const example of selected) {
    const output = await runPipeline(example, runtime);
    assert.equal(output.validation.ok, true, JSON.stringify(output.validation.errors));
    console.log(`\n${example.format.toUpperCase()}: ${example.description}`);
    console.log('Source:\n' + example.source);
    console.log('AEOS schema:\n' + example.schema);
    console.log('Portable AES:\n' + JSON.stringify(output.records, null, 2));
    console.log('AEOS: passed');
    for (const [index, query] of output.queries.entries()) {
      const matches = summarizeQuery(query.result);
      assert.deepEqual(matches.map(match => match.value), example.queries[index].expected);
      console.log('SANSA: ' + query.text);
      console.log(JSON.stringify(matches, null, 2));
    }
    const invalid = await runPipeline({ ...example, source: example.invalidSource }, runtime);
    assert.equal(invalid.validation.ok, false);
    assert.ok(invalid.validation.errors.some(error => error.path === example.invalidPath));
    assert.equal(invalid.queries.length, 0);
    console.log('Invalid source (one field changed):\n' + example.invalidSource);
    console.log('AEOS: rejected; SANSA queries skipped');
    console.log(JSON.stringify(invalid.validation.errors, null, 2));
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleCatalog, examplesFor, sampleFor } from '../playground/public/examples.js';
import { createConverter, loadCompiler } from '../playground/convert.mjs';
let core;
try {core = await loadCompiler();} catch {}
const convert = core ? createConverter(core) : null;
const entries = Object.values(exampleCatalog).flat();

test('every format offers several feature examples with unique IDs and both mode expectations', () => {
  assert.deepEqual(Object.keys(exampleCatalog).sort(),['aeon','alog','json','toml','xml','yaml']);
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
  for (const [format, examples] of Object.entries(exampleCatalog)) {
    assert.ok(examples.length >= 3,format);
    for (const entry of examples) {
      assert.ok(entry.title && entry.description && entry.source,entry.id);
      assert.ok(entry.expected.lossless.description && entry.expected.lossy.description,entry.id);
    }
    if (format !== 'aeon') assert.ok(examples.some(e => e.expected.lossless.outcome === 'error' && e.expected.lossy.outcome === 'success'),format);
  }
});
test('example selection prefers the current route and leaves catalogue/source data unchanged', () => {
  const snapshot = JSON.stringify(exampleCatalog);
  for (const format of ['json','xml','yaml','toml','alog']) {
    const imports = examplesFor(format,'aeon');
    assert.equal(imports[0].from,format); assert.equal(imports[0].to,'aeon');
    const exports = examplesFor('aeon',format);
    assert.equal(exports[0].from,'aeon'); assert.equal(exports[0].to,format);
    assert.equal(exports[0].expected.lossless.outcome,'success');
    assert.equal(sampleFor('aeon',format),exports[0].source);
  }
  assert.equal(JSON.stringify(exampleCatalog),snapshot);
});
for (const entry of entries) for (const mode of ['lossless','lossy']) {
  test(`example ${entry.id}: ${mode} matches the documented outcome`, {skip: !core && 'Built empty-key-capable AEON compiler unavailable'}, () => {
    const expected = entry.expected[mode];
    if (expected.outcome === 'error') {
      assert.throws(() => convert({...entry,mode}),error => error.code === 'UNREPRESENTABLE');
      return;
    }
    const result = convert({...entry,mode});
    assert.equal(typeof result.output,'string');
    assert.equal(result.stringifiedScalars,expected.stringifiedScalars);
    assert.equal(result.mode,mode);
    assert.equal(result.warnings.some(warning => warning.code === 'LOSSY_MODE'),mode === 'lossy');
  });
}

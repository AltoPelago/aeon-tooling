#!/usr/bin/env node
// Compare editor fixtures with the implementation, never an editor-side resolver.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--aeon-root' || args[2] !== '--sansa-root') {
  throw new Error('Usage: node scripts/verify-editor-property-literals.mjs --aeon-root BUILT_CHECKOUT --sansa-root CHECKOUT');
}
const aeon = resolve(args[1]), sansa = resolve(args[3]);
const {compile} = await import(pathToFileURL(aeon+'/implementations/typescript/packages/core/dist/index.js').href);
const {canonicalize} = await import(pathToFileURL(aeon+'/implementations/typescript/packages/canonical/dist/index.js').href);
const {parseAddress} = await import(pathToFileURL(sansa+'/src/index.js').href);
const fixture = JSON.parse(readFileSync(new URL('../test/fixtures/property-literals.json', import.meta.url), 'utf8'));
let references = 0;
for (const address of fixture.valid) {
  const parsed = parseAddress(address);
  assert.equal(parsed.ok, true, address);
  const source = 'selected:sansa = '+address+'\nnext = 1\n';
  const result = compile(source);
  assert.deepEqual(result.errors, [], address);
  const literal = result.events.find(e => e.key === 'selected')?.value;
  assert.equal(literal?.type, 'SansaAddressLiteral', address);
  assert.equal(literal.canonical, parsed.address.canonical, address);
  const canonical = canonicalize(source);
  assert.deepEqual(canonical.errors, [], address);
  const replay = compile(canonical.text);
  assert.deepEqual(replay.errors, [], address);
  assert.equal(replay.events.find(e => e.key === 'selected')?.value.canonical, literal.canonical, address);
  assert.deepEqual(canonicalize(canonical.text), canonical, address);
  for (const prefix of fixture.referencePrefixes) {
    const reference = compile('target = 1\ncopy = '+prefix+address);
    assert.equal(reference.events.length, 0, prefix+address);
    assert(reference.errors.some(e => e.code === 'SYNTAX_ERROR'), prefix+address);
    references++;
  }
}
for (const address of [...fixture.unfinished, ...fixture.invalid]) {
  assert.equal(parseAddress(address).ok, false, address);
  const result = compile('selected:sansa = '+address);
  assert(result.errors.length > 0, address);
}
const ordinary = compile('items = [{name = "ok"}]\ncopy = ~items[0].name\npointer = ~>items[0].name');
assert.deepEqual(ordinary.errors, []);
console.log(JSON.stringify({validLiterals: fixture.valid.length,
  invalidOrUnfinishedRejected: fixture.unfinished.length+fixture.invalid.length,
  propertyReferencesRejected: references, ordinaryReferences: 2,
  canonicalRoundTrips: fixture.valid.length, implementationOracle: true, publication: false}));

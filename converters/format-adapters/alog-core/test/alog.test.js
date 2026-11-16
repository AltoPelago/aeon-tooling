import test from 'node:test';
import assert from 'node:assert/strict';
import { alogToAes, alogToAeon, alogToTelex, alogToAesStream } from '../src/index.js';

test('v1 maps ordered, duplicate and variable-width records with exact scalars', () => {
  const input = '&LOG v1\n1, "Alice, 😀", |active|, !none\n1, "Alice, 😀", |active|, !none\n9007199254740993, 2026-11-09, true';
  const r = alogToAes(input);
  assert.equal(r[0].path, '$.[""]');
  assert.equal(r[1].value, 'ALOG');
  assert.equal(r.filter(e => e.kind === 'ListNode').length, 4);
  assert.equal(r.at(-3).value, '9007199254740993');
  assert.match(alogToAeon(input), /source = \|ALOG\|/);
  assert.match(alogToTelex(input), /kind=SymbolicLiteral/);
});
test('header, comments, CRLF, empty sources and explicit headerless context', () => {
  assert.equal(alogToAes('&LOG v1\r\n/* multi\r\nline */\r\n// comment').length, 2);
  assert.equal(alogToAes('1', { requireHeader: false }).at(-1).value, '1');
  assert.equal(alogToAes('&LOG v1', { sourceMetadata: false }).length, 1);
  assert.equal(alogToAes('&LOG v1\n1 /*a\nb*/\n2').filter(r => r.kind === 'NumberLiteral').length, 2);
});
test('rejects missing fields, syntax extensions, physical continuations and malformed EOF', () => {
  for (const s of ['1,', ',1', '1,,2', '1 2', '[1]', '{a=1}', '(1)', '`x`', 'x=1', '1\n"x', '1, /*a\n*/2', '1 /*', '//! host', '//{ semantic', '1\r2']) {
    assert.throws(() => alogToAes('&LOG v1\n' + s), undefined, s);
  }
  for (const s of ['', '1', '&LOG v2']) assert.throws(() => alogToAes(s));
});
test('finite and stream outputs match across every byte split including UTF-8 and CRLF', async () => {
  const input = new TextEncoder().encode('&LOG v1\r\n1, "😀", |a\\|b| // hi\r\n/*x\r\ny*/\r\n2, false');
  const expected = alogToAes(input);
  for (let i = 0; i <= input.length; i++) {
    const out = [];
    for await (const batch of alogToAesStream([input.slice(0, i), input.slice(i)], { limits: { maxBatchEvents: 2 } })) {
      assert.ok(batch.length <= 2); out.push(...batch);
    }
    assert.deepEqual(out, expected, `split ${i}`);
  }
});
test('live delivery defers unfinished lines, validates whole records, and applies backpressure', async () => {
  let reads = 0;
  async function* input() { reads++; yield Buffer.from('&LOG v1\n1, "ok"\n'); reads++; yield Buffer.from('2, [3]\n'); }
  const stream = alogToAesStream(input());
  assert.equal((await stream.next()).value.length, 2);
  assert.equal(reads, 1);
  const record = (await stream.next()).value;
  assert.equal(record.length, 3);
  await assert.rejects(stream.next(), /Invalid scalar/);
  assert.equal(reads, 2);
  let delivered = [];
  await assert.rejects(async () => { for await (const batch of alogToAesStream([Buffer.from('&LOG v1\n1, "bad')])) delivered.push(...batch); });
  assert.equal(delivered.length, 2); // no partial record
});
test('limits and UTF-8 errors are observable', async () => {
  for (const limits of [{maxInputBytes: 2}, {maxLineBytes: 2}, {maxEvents: 2}, {maxFields: 1}, {maxRecords: 0}]) {
    assert.throws(() => alogToAes('&LOG v1\n1,2', { limits }), /exceeded/);
  }
  assert.throws(() => alogToAes(Uint8Array.of(255)), /UTF-8/);
  await assert.rejects(async () => { for await (const _ of alogToAesStream([Uint8Array.of(0xf0)])) {} }, /UTF-8/);
});

test('line byte boundary is independent of compiler framing and CRLF chunk splits', async () => {
  const input = '&LOG v1\r\n"12345678"\r\n';
  const options = {limits: {maxLineBytes: 10}};
  const expected = alogToAes(input, options);
  const out = [];
  for await (const batch of alogToAesStream([Buffer.from('&LOG v1\r\n"12345678"\r'), Buffer.from('\n')], options)) out.push(...batch);
  assert.deepEqual(out, expected);
});
test('cancellation closes the producer without reading the next chunk', async () => {
  let read = 0, closed = false;
  async function* chunks() {
    try { read++; yield Buffer.from('&LOG v1\n'); read++; yield Buffer.from('1\n'); }
    finally { closed = true; }
  }
  const stream = alogToAesStream(chunks());
  await stream.next();
  await stream.return();
  assert.equal(read, 1); assert.equal(closed, true);
});

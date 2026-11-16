import { compileToTelex } from '@altopelago/aeon-core';
import { aesToAeon } from '../../json-core/src/aeon.js';
import { encodeTelex } from '../../toml-core/src/telex.js';

export { aesToAeon, encodeTelex };
export const DEFAULT_ALOG_AES_LIMITS = Object.freeze({
  maxInputBytes: 16_777_216, maxLineBytes: 1_048_576,
  maxRecords: 65_536, maxFields: 65_536, maxEvents: 100_000, maxBatchEvents: 256,
});
const ROOT = '$.[""]';
const SCALARS = new Set(['StringLiteral', 'NumberLiteral', 'BooleanLiteral', 'NullLiteral',
  'SymbolicLiteral', 'ToggleLiteral', 'HexLiteral', 'RadixLiteral', 'EncodingLiteral',
  'SeparatorLiteral', 'DateLiteral', 'TimeLiteral', 'DateTimeLiteral', 'WTCDateTimeLiteral',
  'SansaAddressLiteral', 'InfinityLiteral', 'NaNLiteral']);
export class AlogAesError extends Error {
  constructor(code, message, line) { super(message); this.name = 'AlogAesError'; this.code = code; this.line = line; }
}
class Parser {
  constructor(options) {
    this.options = options;
    this.limits = { ...DEFAULT_ALOG_AES_LIMITS };
    for (const [key, value] of Object.entries(options.limits ?? {})) {
      if (!(key in this.limits) || (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) || (key === 'maxBatchEvents' && (!Number.isSafeInteger(value) || value < 1))) throw new TypeError(`Invalid limit: ${key}`);
      this.limits[key] = value;
    }
    this.header = options.requireHeader === false;
    this.started = false; this.block = false; this.line = 0; this.index = 0; this.events = 0;
  }
  fail(code, message) { throw new AlogAesError(code, message, this.line); }
  check(key, value) { if (value > this.limits[key]) this.fail('ALOG_LIMIT_EXCEEDED', `${key} exceeded`); }
  start() {
    if (this.started) return [];
    this.started = true;
    return [{ path: ROOT, kind: 'ListNode' }, ...(this.options.sourceMetadata === false ? [] : [
      { path: `${ROOT}.@.source`, kind: 'SymbolicLiteral', value: 'ALOG' },
    ])];
  }
  parseLine(raw) {
    this.line++;
    this.check('maxLineBytes', Buffer.byteLength(raw));
    if (this.line === 1) raw = raw.replace(/^\uFEFF/, '');
    let clean = '', quote = null;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i], next = raw[i + 1];
      if (this.block) {
        if (ch === '*' && next === '/') { this.block = false; clean += ' '; i++; }
      } else if (quote) {
        clean += ch;
        if (ch === '\\') { if (next !== undefined) clean += raw[++i]; }
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === '|' || ch === "'") { quote = ch; clean += ch; }
      else if (ch === '/' && next === '/') {
        if (['!', '?', '@', '#', '{', '[', '('].includes(raw[i + 2])) this.fail('ALOG_SEMANTIC_COMMENT', 'Semantic comments are excluded');
        break;
      } else if (ch === '/' && ['!', '?', '@', '#', '{', '[', '('].includes(next)) {
        this.fail('ALOG_SEMANTIC_COMMENT', 'Semantic comments are excluded');
      } else if (ch === '/' && next === '*') { this.block = true; clean += ' '; i++; }
      else clean += ch;
    }
    if (quote) this.fail('ALOG_MULTILINE_VALUE', 'Unterminated scalar on physical line');
    clean = clean.trim();
    if (!clean) return [];
    if (!this.header) {
      if (clean !== '&LOG v1') this.fail('ALOG_HEADER', 'Expected &LOG v1 declaration');
      this.header = true;
      return this.count(this.start());
    }
    if (clean.startsWith('&LOG')) this.fail('ALOG_HEADER', 'Unexpected format declaration');
    // Split only outside quoted strings and symbolic literals. Each field is
    // compiled independently, preventing list syntax from relaxing separators.
    const fields = []; let start = 0; quote = null;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; }
      else if (ch === '"' || ch === '|' || ch === "'") quote = ch;
      else if (ch === ',') { fields.push(clean.slice(start, i).trim()); start = i + 1; }
    }
    fields.push(clean.slice(start).trim());
    this.check('maxFields', fields.length); this.check('maxRecords', this.index + 1);
    const recordPath = `${ROOT}[${this.index}]`;
    const record = [{ path: recordPath, kind: 'ListNode' }];
    for (const [i, field] of fields.entries()) {
      if (!field || field.startsWith('`')) this.fail('ALOG_FIELD', 'Missing or excluded field syntax');
      const result = compileToTelex(`field = ${field}`, { maxInputBytes: this.limits.maxLineBytes + 8 });
      const scalar = result.records[0];
      if (result.compile.errors.length || result.records.length !== 1 || scalar.path !== '$.field' || !SCALARS.has(scalar.kind) || scalar.datatype !== undefined) {
        this.fail('ALOG_FIELD', `Invalid scalar field ${i + 1}: ${result.compile.errors[0]?.message ?? 'containers, assignments and attributes are excluded'}`);
      }
      record.push({ ...scalar, path: `${recordPath}[${i}]` });
    }
    // Commit only after every field validates.
    const out = this.count([...this.start(), ...record]); this.index++; return out;
  }
  count(events) { this.check('maxEvents', this.events + events.length); this.events += events.length; return events; }
  finish() {
    if (this.block) this.fail('ALOG_UNTERMINATED_COMMENT', 'Unterminated block comment');
    if (!this.header) this.fail('ALOG_HEADER', 'Expected &LOG v1 declaration');
    return this.count(this.start());
  }
}
function decode(input) {
  if (typeof input === 'string') return input;
  if (!(input instanceof Uint8Array)) throw new TypeError('ALOG input must be text or UTF-8 bytes');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input); }
  catch { throw new AlogAesError('ALOG_INVALID_UTF8', 'Invalid UTF-8'); }
}
export function alogToAes(input, options = {}) {
  const parser = new Parser(options), text = decode(input);
  parser.check('maxInputBytes', Buffer.byteLength(text));
  const out = [];
  // CRLF is one boundary. Lone CR is deliberately rejected in v1.
  if (/\r(?!\n)/u.test(text)) parser.fail('ALOG_NEWLINE', 'Use LF or CRLF');
  for (const line of text.split(/\r?\n/u)) out.push(...parser.parseLine(line));
  out.push(...parser.finish()); return out;
}
export const alogToAeon = (input, options) => aesToAeon(alogToAes(input, options), options);
export const alogToTelex = (input, options) => encodeTelex(alogToAes(input, options));

/** Pull-driven UTF-8 stream. Yields bounded event batches. Output is provisional
 * until clean iterator completion; failure throws, cancellation uses return().
 * Input producers should supply bounded byte chunks. No earlier records retained.
 */
export async function* alogToAesStream(chunks, options = {}) {
  const parser = new Parser(options), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let pending = '', bytes = 0;
  function* batches(events) {
    for (let i = 0; i < events.length; i += parser.limits.maxBatchEvents) yield events.slice(i, i + parser.limits.maxBatchEvents);
  }
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) throw new TypeError('Streaming input must contain UTF-8 byte chunks');
    bytes += chunk.length; parser.check('maxInputBytes', bytes);
    let text;
    try { text = decoder.decode(chunk, { stream: true }); }
    catch { parser.fail('ALOG_INVALID_UTF8', 'Invalid UTF-8'); }
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '\n') continue;
      let line = pending + text.slice(start, i);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.includes('\r')) parser.fail('ALOG_NEWLINE', 'Use LF or CRLF');
      pending = ''; start = i + 1;
      yield* batches(parser.parseLine(line));
    }
    pending += text.slice(start); parser.check('maxLineBytes', Buffer.byteLength(pending.endsWith('\r') ? pending.slice(0, -1) : pending));
  }
  try { pending += decoder.decode(); } catch { parser.fail('ALOG_INVALID_UTF8', 'Incomplete UTF-8'); }
  if (pending.includes('\r')) parser.fail('ALOG_NEWLINE', 'Use LF or CRLF');
  if (pending) yield* batches(parser.parseLine(pending));
  yield* batches(parser.finish());
}

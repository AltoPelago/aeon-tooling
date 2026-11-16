import { normalizeJsonNumber } from './number.js';

/**
 * Default limits, aligned with `altopelago.aeonic-limits.v1` (structure and
 * processing) and the AEON source-format limits, since JSON is consumed here
 * as a source format.
 */
export const DEFAULT_JSON_AES_LIMITS = Object.freeze({
  maxInputBytes: 16_777_216,
  maxEvents: 100_000,
  maxValueNestingDepth: 256,
  maxPathDepth: 1_024,
  maxPathCharacters: 8_192,
  maxStringCodepoints: 1_048_576,
  maxKeySegmentCodepoints: 1_024,
  maxListItems: 65_536,
  maxNumericLiteralCharacters: 1_024,
});

const LIMIT_NAMES = Object.freeze({
  maxInputBytes: 'max_input_bytes',
  maxEvents: 'max_events',
  maxValueNestingDepth: 'max_value_nesting_depth',
  maxPathDepth: 'max_path_depth',
  maxPathCharacters: 'max_path_characters',
  maxStringCodepoints: 'max_string_codepoints',
  maxKeySegmentCodepoints: 'max_key_segment_codepoints',
  maxListItems: 'max_list_items',
  maxNumericLiteralCharacters: 'max_numeric_literal_characters',
});

/** Canonical SANSA bare member spelling; anything else is quoted. */
const BARE_MEMBER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/**
 * A precise, stable conversion diagnostic.
 *
 * `offset` is a zero-based UTF-8 byte offset into the input (including any
 * BOM). `line` and `column` are 1-based; columns count Unicode code points.
 */
export class JsonAesError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'JsonAesError';
    this.code = code;
    Object.assign(this, details);
  }
}

/**
 * Convert a JSON text into portable AES records (`aes.events.v1`,
 * `aes.complete.v1`, body-only projection).
 *
 * | JSON    | AES kind         | value                          |
 * | ------- | ---------------- | ------------------------------ |
 * | object  | `ObjectNode`     | (absent)                       |
 * | array   | `ListNode`       | (absent)                       |
 * | string  | `StringLiteral`  | decoded string                 |
 * | number  | `NumberLiteral`  | canonical AEON number lexeme   |
 * | boolean | `BooleanLiteral` | `true` / `false`               |
 * | null    | `NullLiteral`    | `none` (AEON `!none`)          |
 *
 * Records are emitted in canonical depth-first preorder and carry no
 * datatype, matching what AEON produces for the same untyped document.
 *
 * Throws {@link JsonAesError} on the first violation. Nothing is silently
 * dropped, renamed, or coerced.
 *
 * @param {string | Uint8Array} input JSON text, or its UTF-8 bytes.
 * @param {{ mapping?: 'root' | 'native', sourceMetadata?: boolean, limits?: Partial<typeof DEFAULT_JSON_AES_LIMITS> }} [options]
 * @returns {import('./index.js').JsonAesRecord[]}
 */
export function jsonToAes(input, options = {}) {
  const limits = normalizeLimits(options.limits);
  const text = decodeInput(input, limits);
  return new Parser(text, limits, options).parseDocument();
}

function normalizeLimits(source = {}) {
  const limits = { ...DEFAULT_JSON_AES_LIMITS };
  for (const [key, value] of Object.entries(source)) {
    if (!(key in DEFAULT_JSON_AES_LIMITS)) throw new TypeError(`Unknown limit: ${key}`);
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) {
      throw new TypeError(`Limit ${key} must be a non-negative integer or Infinity`);
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}

function decodeInput(input, limits) {
  if (typeof input === 'string') {
    // String length is a lower bound on UTF-8 bytes; only measure when needed.
    if (input.length > limits.maxInputBytes / 3) {
      const bytes = new TextEncoder().encode(input).length;
      if (bytes > limits.maxInputBytes) throw limitError('maxInputBytes', bytes, limits, {});
    }
    return input;
  }
  if (!(input instanceof Uint8Array)) {
    throw new TypeError('JSON input must be a string or a Uint8Array');
  }
  if (input.length > limits.maxInputBytes) {
    throw limitError('maxInputBytes', input.length, limits, {});
  }
  const invalidAt = firstInvalidUtf8(input);
  if (invalidAt !== -1) {
    throw new JsonAesError('JSON_INVALID_UTF8', 'Input is not valid UTF-8', {
      offset: invalidAt,
    });
  }
  // ignoreBOM keeps a leading BOM in the string so offsets stay byte-exact.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(input);
}

class Parser {
  constructor(text, limits, options) {
    this.native = options.mapping === 'native';
    if (options.mapping !== undefined && !['native', 'root'].includes(options.mapping)) throw new TypeError('Unknown mapping mode');
    this.sourceMetadata = options.sourceMetadata !== false;
    this.text = text;
    this.limits = limits;
    this.pos = text.charCodeAt(0) === 0xfeff ? 1 : 0; // RFC 8259 §8.1: may ignore a BOM
    this.records = [];
  }

  parseDocument() {
    this.skipWhitespace();
    if (!this.native) {
      const loc = this.child({ path: '$', segments: 0, chars: 1 }, '.[""]', this.pos);
      this.parseValue(loc, 0);
      if (this.sourceMetadata) this.checkCodepoints('maxKeySegmentCodepoints', 'source', this.pos, loc.path);
      if (this.sourceMetadata) this.emit(this.child(loc, '.@.source', this.pos), { path: loc.path + '.@.source', kind: 'SymbolicLiteral', value: 'JSON' });
      if (this.sourceMetadata) this.records.splice(1, 0, this.records.pop());
      this.skipWhitespace();
      if (this.pos < this.text.length) this.fail('JSON_TRAILING_CONTENT', 'Unexpected content after the JSON root value');
      return this.records;
    }
    const ch = this.text[this.pos];
    if (ch === undefined) this.fail('JSON_UNEXPECTED_END', 'Expected a JSON object');
    if (ch !== '{') {
      if ('["-0123456789tfn'.includes(ch)) {
        this.fail(
          'JSON_ROOT_NOT_OBJECT',
          'The JSON root must be an object: AES has no event for the document root `$`',
        );
      }
      this.failUnexpected('a JSON object');
    }
    this.parseObject({ path: '$', segments: 0, chars: 1 }, 0);
    this.skipWhitespace();
    if (this.pos < this.text.length) {
      this.fail('JSON_TRAILING_CONTENT', 'Unexpected content after the JSON root value');
    }
    return this.records;
  }

  // ---- values -------------------------------------------------------------

  parseValue(loc, nesting) {
    this.skipWhitespace();
    const ch = this.text[this.pos];
    switch (ch) {
      case '{':
        this.enterContainer(loc, nesting);
        this.emit(loc, { path: loc.path, kind: 'ObjectNode' });
        this.parseObject(loc, nesting + 1);
        return;
      case '[':
        this.enterContainer(loc, nesting);
        this.emit(loc, { path: loc.path, kind: 'ListNode' });
        this.parseArray(loc, nesting + 1);
        return;
      case '"': {
        const start = this.pos;
        const value = this.parseString();
        this.checkCodepoints('maxStringCodepoints', value, start, loc.path);
        this.emit(loc, { path: loc.path, kind: 'StringLiteral', value });
        return;
      }
      case 't':
        this.expectWord('true');
        this.emit(loc, { path: loc.path, kind: 'BooleanLiteral', value: 'true' });
        return;
      case 'f':
        this.expectWord('false');
        this.emit(loc, { path: loc.path, kind: 'BooleanLiteral', value: 'false' });
        return;
      case 'n':
        this.expectWord('null');
        // JSON null carries no reason, so it maps to AEON's reserved `!none`.
        this.emit(loc, { path: loc.path, kind: 'NullLiteral', value: 'none' });
        return;
      default:
        if (ch === '-' || (ch >= '0' && ch <= '9')) {
          this.emit(loc, { path: loc.path, kind: 'NumberLiteral', value: this.parseNumber(loc) });
          return;
        }
        this.failUnexpected('a JSON value');
    }
  }

  enterContainer(loc, nesting) {
    if (nesting + 1 > this.limits.maxValueNestingDepth) {
      throw limitError('maxValueNestingDepth', nesting + 1, this.limits, this.where(this.pos, loc.path));
    }
  }

  parseObject(loc, nesting) {
    this.pos += 1; // '{'
    const seen = new Set();
    this.skipWhitespace();
    if (this.text[this.pos] === '}') {
      this.pos += 1;
      return;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') this.failUnexpected('an object key string');
      const keyStart = this.pos;
      const key = this.parseString();
      if (this.native && key.length === 0) {
        this.fail(
          'JSON_EMPTY_KEY',
          'Empty object keys are not representable in AEON or as an AES path member',
          keyStart,
          loc.path,
        );
      }
      if (seen.has(key)) {
        this.fail(
          'JSON_DUPLICATE_KEY',
          `Duplicate object key ${JSON.stringify(key)}: AES paths must be unique`,
          keyStart,
          loc.path,
        );
      }
      seen.add(key);
      this.checkCodepoints('maxKeySegmentCodepoints', key, keyStart, loc.path);

      this.skipWhitespace();
      if (this.text[this.pos] !== ':') this.failUnexpected("':'");
      this.pos += 1;

      this.parseValue(this.child(loc, memberSegment(key), keyStart), nesting);

      this.skipWhitespace();
      const next = this.text[this.pos];
      if (next === ',') {
        this.pos += 1;
        continue;
      }
      if (next === '}') {
        this.pos += 1;
        return;
      }
      this.failUnexpected("',' or '}'");
    }
  }

  parseArray(loc, nesting) {
    this.pos += 1; // '['
    this.skipWhitespace();
    if (this.text[this.pos] === ']') {
      this.pos += 1;
      return;
    }
    for (let index = 0; ; index += 1) {
      if (index + 1 > this.limits.maxListItems) {
        throw limitError('maxListItems', index + 1, this.limits, this.where(this.pos, loc.path));
      }
      this.skipWhitespace();
      this.parseValue(this.child(loc, `[${index}]`, this.pos), nesting);
      this.skipWhitespace();
      const next = this.text[this.pos];
      if (next === ',') {
        this.pos += 1;
        continue;
      }
      if (next === ']') {
        this.pos += 1;
        return;
      }
      this.failUnexpected("',' or ']'");
    }
  }

  child(loc, segment, at) {
    const next = {
      path: loc.path + segment,
      segments: loc.segments + 1,
      chars: loc.chars + codepointLength(segment),
    };
    if (next.segments > this.limits.maxPathDepth) {
      throw limitError('maxPathDepth', next.segments, this.limits, this.where(at, loc.path));
    }
    if (next.chars > this.limits.maxPathCharacters) {
      throw limitError('maxPathCharacters', next.chars, this.limits, this.where(at, loc.path));
    }
    return next;
  }

  emit(loc, record) {
    if (this.records.length + 1 > this.limits.maxEvents) {
      throw limitError('maxEvents', this.records.length + 1, this.limits, this.where(this.pos, loc.path));
    }
    this.records.push(record);
  }

  // ---- scalars ------------------------------------------------------------

  /** RFC 8259 string; rejects lone surrogates because AES carries Unicode scalars. */
  parseString() {
    const { text } = this;
    this.pos += 1; // opening quote
    let out = '';
    let chunkStart = this.pos;
    for (;;) {
      const code = text.charCodeAt(this.pos);
      if (Number.isNaN(code)) this.fail('JSON_UNEXPECTED_END', 'Unterminated string');
      if (code === 0x22) { // "
        out += text.slice(chunkStart, this.pos);
        this.pos += 1;
        return out;
      }
      if (code === 0x5c) { // backslash
        out += text.slice(chunkStart, this.pos);
        out += this.parseEscape();
        chunkStart = this.pos;
        continue;
      }
      if (code < 0x20) {
        this.fail(
          'JSON_CONTROL_CHARACTER',
          `Unescaped control character U+${hex4(code)} in string`,
        );
      }
      if (code >= 0xd800 && code <= 0xdfff) {
        const low = text.charCodeAt(this.pos + 1);
        if (code > 0xdbff || !(low >= 0xdc00 && low <= 0xdfff)) {
          this.fail('JSON_LONE_SURROGATE', `Lone surrogate U+${hex4(code)} in string`);
        }
        this.pos += 2;
        continue;
      }
      this.pos += 1;
    }
  }

  parseEscape() {
    const start = this.pos;
    const ch = this.text[this.pos + 1];
    this.pos += 2;
    switch (ch) {
      case '"': return '"';
      case '\\': return '\\';
      case '/': return '/';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'u': {
        const unit = this.readHex4(start);
        if (unit >= 0xdc00 && unit <= 0xdfff) {
          this.fail('JSON_LONE_SURROGATE', `Lone surrogate escape \\u${hex4(unit)}`, start);
        }
        if (unit >= 0xd800 && unit <= 0xdbff) {
          if (this.text[this.pos] !== '\\' || this.text[this.pos + 1] !== 'u') {
            this.fail('JSON_LONE_SURROGATE', `Lone surrogate escape \\u${hex4(unit)}`, start);
          }
          const lowStart = this.pos;
          this.pos += 2;
          const low = this.readHex4(lowStart);
          if (!(low >= 0xdc00 && low <= 0xdfff)) {
            this.fail('JSON_LONE_SURROGATE', `Lone surrogate escape \\u${hex4(unit)}`, start);
          }
          return String.fromCharCode(unit, low);
        }
        return String.fromCharCode(unit);
      }
      case undefined:
        return this.fail('JSON_UNEXPECTED_END', 'Unterminated string escape', start);
      default:
        return this.fail('JSON_INVALID_ESCAPE', `Invalid string escape \\${ch}`, start);
    }
  }

  readHex4(escapeStart) {
    const digits = this.text.slice(this.pos, this.pos + 4);
    if (!/^[0-9A-Fa-f]{4}$/.test(digits)) {
      this.fail('JSON_INVALID_ESCAPE', 'Invalid \\u escape: expected four hexadecimal digits', escapeStart);
    }
    this.pos += 4;
    return Number.parseInt(digits, 16);
  }

  /** RFC 8259: -? (0 | [1-9][0-9]*) (. [0-9]+)? ([eE] [+-]? [0-9]+)? */
  parseNumber(loc) {
    const { text } = this;
    const start = this.pos;
    const invalid = () => this.fail('JSON_INVALID_NUMBER', 'Invalid JSON number', start, loc.path);
    const digits = () => {
      const from = this.pos;
      while (text[this.pos] >= '0' && text[this.pos] <= '9') this.pos += 1;
      return this.pos - from;
    };
    if (text[this.pos] === '-') this.pos += 1;
    if (text[this.pos] === '0') {
      this.pos += 1;
      if (text[this.pos] >= '0' && text[this.pos] <= '9') invalid(); // leading zero
    } else if (digits() === 0) {
      invalid();
    }
    if (text[this.pos] === '.') {
      this.pos += 1;
      if (digits() === 0) invalid();
    }
    if (text[this.pos] === 'e' || text[this.pos] === 'E') {
      this.pos += 1;
      if (text[this.pos] === '+' || text[this.pos] === '-') this.pos += 1;
      if (digits() === 0) invalid();
    }
    const lexeme = text.slice(start, this.pos);
    if (lexeme.length > this.limits.maxNumericLiteralCharacters) {
      throw limitError('maxNumericLiteralCharacters', lexeme.length, this.limits, this.where(start, loc.path));
    }
    return normalizeJsonNumber(lexeme);
  }

  expectWord(word) {
    if (this.text.startsWith(word, this.pos)) {
      this.pos += word.length;
      return;
    }
    this.failUnexpected('a JSON value');
  }

  skipWhitespace() {
    const { text } = this;
    for (;;) {
      const ch = text[this.pos];
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') this.pos += 1;
      else return;
    }
  }

  checkCodepoints(limitKey, value, at, path) {
    const maximum = this.limits[limitKey];
    if (value.length <= maximum) return; // UTF-16 length is an upper bound
    const observed = codepointLength(value);
    if (observed > maximum) throw limitError(limitKey, observed, this.limits, this.where(at, path));
  }

  // ---- diagnostics --------------------------------------------------------

  failUnexpected(expected) {
    if (this.pos >= this.text.length) {
      this.fail('JSON_UNEXPECTED_END', `Unexpected end of input; expected ${expected}`);
    }
    const found = String.fromCodePoint(this.text.codePointAt(this.pos));
    this.fail('JSON_SYNTAX', `Unexpected ${JSON.stringify(found)}; expected ${expected}`);
  }

  fail(code, message, at = this.pos, path) {
    throw new JsonAesError(code, message, this.where(at, path));
  }

  where(at, path) {
    return locate(this.text, at, path);
  }
}

function memberSegment(key) {
  return BARE_MEMBER.test(key) ? `.${key}` : `.[${JSON.stringify(key)}]`;
}

function limitError(limitKey, observed, limits, where) {
  const limit = LIMIT_NAMES[limitKey];
  return new JsonAesError(
    'JSON_LIMIT_EXCEEDED',
    `${limit} exceeded: ${observed} > ${limits[limitKey]}`,
    { ...where, limit, observed, maximum: limits[limitKey] },
  );
}

function locate(text, at, path) {
  const prefix = text.slice(0, at);
  const lastNewline = prefix.lastIndexOf('\n');
  const where = {
    offset: new TextEncoder().encode(prefix).length,
    line: countChar(prefix, '\n') + 1,
    column: codepointLength(prefix.slice(lastNewline + 1)) + 1,
  };
  if (path !== undefined) where.path = path;
  return where;
}

function countChar(text, ch) {
  let count = 0;
  for (let i = text.indexOf(ch); i !== -1; i = text.indexOf(ch, i + 1)) count += 1;
  return count;
}

function codepointLength(value) {
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
    }
    count += 1;
  }
  return count;
}

function hex4(unit) {
  return unit.toString(16).toUpperCase().padStart(4, '0');
}

/** Returns the byte offset of the first invalid UTF-8 sequence, or -1. */
function firstInvalidUtf8(bytes) {
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) { i += 1; continue; }
    let needed;
    let min;
    if (b0 >= 0xc2 && b0 <= 0xdf) { needed = 1; min = 0x80; }
    else if (b0 >= 0xe0 && b0 <= 0xef) { needed = 2; min = 0x800; }
    else if (b0 >= 0xf0 && b0 <= 0xf4) { needed = 3; min = 0x10000; }
    else return i;
    if (i + needed >= bytes.length) return i; // truncated sequence
    let scalar = b0 & (0x3f >> needed);
    for (let k = 1; k <= needed; k += 1) {
      const b = bytes[i + k];
      if ((b & 0xc0) !== 0x80) return i;
      scalar = (scalar << 6) | (b & 0x3f);
    }
    if (scalar < min || scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff)) return i;
    i += needed + 1;
  }
  return -1;
}

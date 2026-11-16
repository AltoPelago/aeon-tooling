import { normalizeTomlNumber, isTomlIntegerInRange } from './number.js';

/**
 * Default limits aligned with `altopelago.aeonic-limits.v1`.
 */
export const DEFAULT_TOML_AES_LIMITS = Object.freeze({
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
/** TOML v1.0 bare key characters: ASCII letters, digits, underscores, dashes. */
const TOML_BARE_KEY_CHAR = /^[A-Za-z0-9_-]$/u;

export class TomlAesError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TomlAesError';
    this.code = code;
    Object.assign(this, details);
  }
}

/**
 * Convert a TOML v1.0 document into portable AES records (`aes.events.v1`,
 * `aes.complete.v1`, body-only projection).
 *
 * | TOML                     | AES kind          | datatype     | value                        |
 * | ------------------------ | ----------------- | ------------ | ---------------------------- |
 * | Table / Inline table     | `ObjectNode`      | (absent)     | (absent)                     |
 * | Array / `[[array]]`      | `ListNode`        | (absent)     | (absent)                     |
 * | String (basic/lit/multi) | `StringLiteral`   | (absent)     | decoded string               |
 * | Decimal integer / float  | `NumberLiteral`   | (absent)     | canonical AEON number lexeme |
 * | `0b...` binary integer   | `RadixLiteral`    | `radix[2]`   | digits without `0b` / `_`    |
 * | `0o...` octal integer    | `RadixLiteral`    | `radix[8]`   | digits without `0o` / `_`    |
 * | `0x...` hex integer      | `RadixLiteral`    | `radix[16]`  | digits without `0x` / `_`    |
 * | `[+-]?inf`               | `InfinityLiteral` | (absent)     | `Infinity` / `-Infinity`     |
 * | `[+-]?nan`               | `NaNLiteral`      | (absent)     | `NaN` / `-NaN`               |
 * | Boolean                  | `BooleanLiteral`  | (absent)     | `true` / `false`             |
 * | Local Date               | `DateLiteral`     | (absent)     | `YYYY-MM-DD`                 |
 * | Local Time               | `TimeLiteral`     | (absent)     | `HH:MM:SS[.frac]`            |
 * | Local / Offset Date-Time | `DateTimeLiteral` | (absent)     | `YYYY-MM-DDTHH:MM:SS...`     |
 *
 * Because TOML allows non-contiguous `[table]`, `[[array.of.tables]]`, and
 * dotted keys (`a.b.c = 1`), the adapter first assembles and validates the
 * complete TOML table hierarchy and then emits AES events in canonical
 * depth-first preorder.
 *
 * @param {string | Uint8Array} input
 * @param {{ mapping?: 'root' | 'native', sourceMetadata?: boolean, limits?: Partial<typeof DEFAULT_TOML_AES_LIMITS> }} [options]
 * @returns {import('./index.js').TomlAesRecord[]}
 */
export function tomlToAes(input, options = {}) {
  const limits = normalizeLimits(options.limits);
  const text = decodeInput(input, limits);
  const parser = new TomlParser(text, limits);
  if (options.mapping !== undefined && !['native', 'root'].includes(options.mapping)) throw new TypeError('Unknown mapping mode');
  parser.native = options.mapping === 'native';
  parser.sourceMetadata = options.sourceMetadata !== false;
  const rootTable = parser.parseDocument();
  return parser.emitTree(rootTable);
}

function normalizeLimits(source = {}) {
  const limits = { ...DEFAULT_TOML_AES_LIMITS };
  for (const [key, value] of Object.entries(source)) {
    if (!(key in DEFAULT_TOML_AES_LIMITS)) throw new TypeError(`Unknown limit: ${key}`);
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) {
      throw new TypeError(`Limit ${key} must be a non-negative integer or Infinity`);
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}

function decodeInput(input, limits) {
  if (typeof input === 'string') {
    if (input.length > limits.maxInputBytes / 3) {
      const bytes = new TextEncoder().encode(input).length;
      if (bytes > limits.maxInputBytes) throw limitError('maxInputBytes', bytes, limits, {});
    }
    return input;
  }
  if (!(input instanceof Uint8Array)) {
    throw new TypeError('TOML input must be a string or a Uint8Array');
  }
  if (input.length > limits.maxInputBytes) {
    throw limitError('maxInputBytes', input.length, limits, {});
  }
  const invalidAt = firstInvalidUtf8(input);
  if (invalidAt !== -1) {
    throw new TomlAesError('TOML_INVALID_UTF8', 'Input is not valid UTF-8', {
      offset: invalidAt,
    });
  }
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(input);
}

/**
 * Internal table node representation:
 * - `entries`: Map<string, Node> preserving insertion order
 * - `state`:
 *     - `'implicit'`: created as an intermediate table for `[a.b]` or `[[a.b]]`; can still be opened by `[a]`
 *     - `'header'`: opened by `[a]`; cannot be reopened by another `[a]`
 *     - `'dotted'`: created by dotted key `a.b = 1` within a table/root; can be extended by sibling dotted keys in the SAME `[table]` block (`dottedScope`), but cannot be reopened by `[a]`
 *     - `'sealed'`: inline table `{ ... }`; completely immutable
 * - `dottedScope`: symbol/id of the `[table]` header section in which a `'dotted'` table was created
 */
function createTableNode(state, pos, dottedScope = null) {
  return {
    type: 'table',
    entries: new Map(),
    state,
    pos,
    dottedScope,
  };
}

class TomlParser {
  constructor(text, limits) {
    this.text = text;
    this.limits = limits;
    this.pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    this.root = createTableNode('header', this.pos, 0);
    this.currentTable = this.root;
    this.currentPath = { path: '$', segments: 0, chars: 1 };
    this.sectionId = 0;
    this.records = [];
  }

  parseDocument() {
    while (this.pos < this.text.length) {
      this.skipWsAndComments(true);
      if (this.pos >= this.text.length) break;

      if (this.text[this.pos] === '[') {
        this.sectionId += 1;
        if (this.text[this.pos + 1] === '[') {
          this.parseArrayOfTablesHeader();
        } else {
          this.parseTableHeader();
        }
      } else {
        this.parseKeyValue(this.currentTable, this.currentPath, this.sectionId, 0);
      }

      this.skipSpacesAndComment();
      if (this.pos < this.text.length) {
        if (this.text[this.pos] === '\n') {
          this.pos += 1;
        } else if (this.text[this.pos] === '\r' && this.text[this.pos + 1] === '\n') {
          this.pos += 2;
        } else {
          this.fail('TOML_SYNTAX', 'Expected a newline or EOF after statement');
        }
      }
    }
    return this.root;
  }

  // ---- headers & key-value statements -------------------------------------

  parseTableHeader() {
    const start = this.pos;
    this.pos += 1; // '['
    const keys = this.parseKeyPath();
    this.skipSpaces();
    if (this.text[this.pos] !== ']') {
      this.fail('TOML_SYNTAX', "Expected ']' to close table header");
    }
    this.pos += 1;

    let table = this.root;
    let loc = { path: '$', segments: 0, chars: 1 };

    for (let i = 0; i < keys.length; i += 1) {
      const { key, pos: keyPos } = keys[i];
      const isLast = i === keys.length - 1;
      loc = this.childPath(loc, memberSegment(key), keyPos);

      const existing = table.entries.get(key);
      if (!isLast) {
        if (existing === undefined) {
          const next = createTableNode('implicit', keyPos, null);
          table.entries.set(key, next);
          table = next;
        } else if (existing.type === 'table') {
          if (existing.state === 'sealed') {
            this.fail('TOML_EXTEND_INLINE_TABLE', `Cannot extend inline table at ${loc.path}`, keyPos, loc.path);
          }
          table = existing;
        } else if (existing.type === 'aot') {
          table = existing.items.at(-1);
          loc = this.childPath(loc, `[${existing.items.length - 1}]`, keyPos);
        } else {
          this.fail('TOML_DUPLICATE_KEY', `Cannot redefine scalar or static array at ${loc.path} as a table`, keyPos, loc.path);
        }
      } else if (existing === undefined) {
        const next = createTableNode('header', start, this.sectionId);
        table.entries.set(key, next);
        table = next;
      } else if (existing.type === 'table' && existing.state === 'sealed') {
        this.fail('TOML_EXTEND_INLINE_TABLE', `Cannot extend inline table at ${loc.path}`, start, loc.path);
      } else if (existing.type === 'table' && existing.state === 'implicit') {
        existing.state = 'header';
        existing.dottedScope = this.sectionId;
        table = existing;
      } else {
        this.fail('TOML_DUPLICATE_TABLE', `Cannot redefine table or key at ${loc.path}`, start, loc.path);
      }
    }

    this.currentTable = table;
    this.currentPath = loc;
  }

  parseArrayOfTablesHeader() {
    const start = this.pos;
    this.pos += 2; // '[['
    const keys = this.parseKeyPath();
    this.skipSpaces();
    if (this.text[this.pos] !== ']' || this.text[this.pos + 1] !== ']') {
      this.fail('TOML_SYNTAX', "Expected ']]' to close array-of-tables header");
    }
    this.pos += 2;

    let table = this.root;
    let loc = { path: '$', segments: 0, chars: 1 };

    for (let i = 0; i < keys.length; i += 1) {
      const { key, pos: keyPos } = keys[i];
      const isLast = i === keys.length - 1;
      loc = this.childPath(loc, memberSegment(key), keyPos);

      const existing = table.entries.get(key);
      if (!isLast) {
        if (existing === undefined) {
          const next = createTableNode('implicit', keyPos, null);
          table.entries.set(key, next);
          table = next;
        } else if (existing.type === 'table') {
          if (existing.state === 'sealed') {
            this.fail('TOML_EXTEND_INLINE_TABLE', `Cannot extend inline table at ${loc.path}`, keyPos, loc.path);
          }
          table = existing;
        } else if (existing.type === 'aot') {
          table = existing.items.at(-1);
          loc = this.childPath(loc, `[${existing.items.length - 1}]`, keyPos);
        } else {
          this.fail('TOML_DUPLICATE_KEY', `Cannot redefine key at ${loc.path}`, keyPos, loc.path);
        }
      } else if (existing === undefined) {
        const elementTable = createTableNode('header', start, this.sectionId);
        const aot = { type: 'aot', items: [elementTable], pos: start };
        table.entries.set(key, aot);
        loc = this.childPath(loc, '[0]', start);
        table = elementTable;
      } else if (existing.type === 'aot') {
        const nextIndex = existing.items.length;
        if (nextIndex + 1 > this.limits.maxListItems) {
          throw limitError('maxListItems', nextIndex + 1, this.limits, this.where(start, loc.path));
        }
        const elementTable = createTableNode('header', start, this.sectionId);
        existing.items.push(elementTable);
        loc = this.childPath(loc, `[${nextIndex}]`, start);
        table = elementTable;
      } else {
        this.fail(
          'TOML_DUPLICATE_TABLE',
          `Cannot append array-of-tables to existing non-array-of-tables at ${loc.path}`,
          start,
          loc.path,
        );
      }
    }

    this.currentTable = table;
    this.currentPath = loc;
  }

  parseKeyValue(baseTable, baseLoc, scopeId, baseNesting) {
    const keys = this.parseKeyPath();
    this.skipSpaces();
    if (this.text[this.pos] !== '=') {
      this.fail('TOML_SYNTAX', "Expected '=' after key");
    }
    this.pos += 1;
    this.skipSpaces();

    let table = baseTable;
    let loc = baseLoc;

    for (let i = 0; i < keys.length - 1; i += 1) {
      const { key, pos: keyPos } = keys[i];
      loc = this.childPath(loc, memberSegment(key), keyPos);
      const existing = table.entries.get(key);
      if (existing === undefined) {
        const next = createTableNode('dotted', keyPos, scopeId);
        table.entries.set(key, next);
        table = next;
      } else if (existing.type === 'table') {
        if (existing.state === 'sealed') {
          this.fail('TOML_EXTEND_INLINE_TABLE', `Cannot extend inline table at ${loc.path}`, keyPos, loc.path);
        }
        if (existing.state === 'header' && existing.dottedScope !== scopeId) {
          this.fail(
            'TOML_EXTEND_DEFINED_TABLE',
            `Cannot add keys via dotted path to already-defined table ${loc.path}`,
            keyPos,
            loc.path,
          );
        }
        if (existing.state === 'dotted' && existing.dottedScope !== scopeId) {
          this.fail(
            'TOML_EXTEND_DEFINED_TABLE',
            `Cannot reopen dotted-key table ${loc.path} from another section`,
            keyPos,
            loc.path,
          );
        }
        if (existing.state === 'implicit') {
          existing.state = 'dotted';
          existing.dottedScope = scopeId;
        }
        table = existing;
      } else {
        this.fail('TOML_DUPLICATE_KEY', `Cannot redefine non-table key at ${loc.path}`, keyPos, loc.path);
      }
    }

    const last = keys.at(-1);
    const valueLoc = this.childPath(loc, memberSegment(last.key), last.pos);
    if (table.entries.has(last.key)) {
      this.fail(
        'TOML_DUPLICATE_KEY',
        `Duplicate key ${JSON.stringify(last.key)} at ${loc.path}`,
        last.pos,
        loc.path,
      );
    }

    const valueNode = this.parseValue(valueLoc, baseNesting + keys.length - 1);
    table.entries.set(last.key, valueNode);
  }

  parseKeyPath() {
    const keys = [];
    for (;;) {
      this.skipSpaces();
      const keyPos = this.pos;
      const key = this.parseSingleKey();
      if (this.native && key.length === 0) {
        this.fail(
          'TOML_EMPTY_KEY',
          'Empty keys are not representable in AEON or as an AES path member',
          keyPos,
          this.currentPath.path,
        );
      }
      this.checkCodepoints('maxKeySegmentCodepoints', key, keyPos, this.currentPath.path);
      keys.push({ key, pos: keyPos });
      this.skipSpaces();
      if (this.text[this.pos] === '.') {
        this.pos += 1;
        continue;
      }
      return keys;
    }
  }

  parseSingleKey() {
    const ch = this.text[this.pos];
    if (ch === '"') {
      if (this.text.startsWith('"""', this.pos)) {
        this.fail('TOML_SYNTAX', 'Multiline strings are not allowed as keys');
      }
      return this.parseBasicString();
    }
    if (ch === "'") {
      if (this.text.startsWith("'''", this.pos)) {
        this.fail('TOML_SYNTAX', 'Multiline strings are not allowed as keys');
      }
      return this.parseLiteralString();
    }
    const start = this.pos;
    while (this.pos < this.text.length && TOML_BARE_KEY_CHAR.test(this.text[this.pos])) {
      this.pos += 1;
    }
    if (this.pos === start) {
      this.fail('TOML_SYNTAX', 'Expected a key');
    }
    return this.text.slice(start, this.pos);
  }

  // ---- values -------------------------------------------------------------

  parseValue(loc, nesting) {
    this.skipSpaces();
    const start = this.pos;
    const ch = this.text[this.pos];
    if (ch === undefined || ch === '\n' || ch === '\r' || ch === '#') {
      this.fail('TOML_UNEXPECTED_END', 'Expected a value', start, loc.path);
    }

    if (ch === '"') {
      const value = this.text.startsWith('"""', this.pos)
        ? this.parseMultilineBasicString()
        : this.parseBasicString();
      this.checkCodepoints('maxStringCodepoints', value, start, loc.path);
      return { type: 'scalar', kind: 'StringLiteral', value };
    }

    if (ch === "'") {
      const value = this.text.startsWith("'''", this.pos)
        ? this.parseMultilineLiteralString()
        : this.parseLiteralString();
      this.checkCodepoints('maxStringCodepoints', value, start, loc.path);
      return { type: 'scalar', kind: 'StringLiteral', value };
    }

    if (ch === '[') {
      return this.parseStaticArray(loc, nesting);
    }

    if (ch === '{') {
      return this.parseInlineTable(loc, nesting);
    }

    if (this.text.startsWith('true', this.pos) && this.isValueTerminator(this.pos + 4)) {
      this.pos += 4;
      return { type: 'scalar', kind: 'BooleanLiteral', value: 'true' };
    }
    if (this.text.startsWith('false', this.pos) && this.isValueTerminator(this.pos + 5)) {
      this.pos += 5;
      return { type: 'scalar', kind: 'BooleanLiteral', value: 'false' };
    }

    return this.parseNumericOrTemporal(loc);
  }

  parseStaticArray(loc, nesting) {
    const start = this.pos;
    this.pos += 1; // '['
    const items = [];
    for (;;) {
      this.skipWsAndComments(true);
      if (this.text[this.pos] === ']') {
        this.pos += 1;
        return { type: 'array', items, pos: start };
      }
      if (items.length + 1 > this.limits.maxListItems) {
        throw limitError('maxListItems', items.length + 1, this.limits, this.where(this.pos, loc.path));
      }
      const itemLoc = this.childPath(loc, `[${items.length}]`, this.pos);
      items.push(this.parseValue(itemLoc, nesting + 1));
      this.skipWsAndComments(true);
      const next = this.text[this.pos];
      if (next === ',') {
        this.pos += 1;
        continue;
      }
      if (next === ']') {
        this.pos += 1;
        return { type: 'array', items, pos: start };
      }
      this.fail('TOML_SYNTAX', "Expected ',' or ']' in array", this.pos, loc.path);
    }
  }

  parseInlineTable(loc, nesting) {
    const start = this.pos;
    this.pos += 1; // '{'
    const scopeId = Symbol('inline');
    const table = createTableNode('sealed', start, scopeId);
    this.skipSpaces();
    if (this.text[this.pos] === '}') {
      this.pos += 1;
      return table;
    }
    for (;;) {
      this.skipSpaces();
      const ch = this.text[this.pos];
      if (ch === '\n' || ch === '\r') {
        this.fail('TOML_SYNTAX', 'Newlines are not allowed inside TOML v1.0 inline tables', this.pos, loc.path);
      }
      this.parseKeyValue(table, loc, scopeId, nesting + 1);
      this.skipSpaces();
      const next = this.text[this.pos];
      if (next === ',') {
        this.pos += 1;
        this.skipSpaces();
        if (this.text[this.pos] === '}') {
          this.fail('TOML_SYNTAX', 'Trailing commas are not allowed in TOML v1.0 inline tables', this.pos, loc.path);
        }
        continue;
      }
      if (next === '}') {
        this.pos += 1;
        this.sealSubtables(table);
        return table;
      }
      this.fail('TOML_SYNTAX', "Expected ',' or '}' in inline table", this.pos, loc.path);
    }
  }

  sealSubtables(table) {
    table.state = 'sealed';
    for (const child of table.entries.values()) {
      if (child.type === 'table') this.sealSubtables(child);
    }
  }

  // ---- strings ------------------------------------------------------------

  parseBasicString() {
    this.pos += 1; // '"'
    let out = '';
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      const code = this.text.charCodeAt(this.pos);
      if (ch === '"') {
        this.pos += 1;
        return out;
      }
      if (ch === '\\') {
        out += this.parseStringEscape(false);
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        this.fail('TOML_SYNTAX', 'Unterminated basic string');
      }
      if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
        this.fail('TOML_CONTROL_CHARACTER', `Unescaped control character U+${hex4(code)} in string`);
      }
      if (code >= 0xd800 && code <= 0xdfff) {
        const low = this.text.charCodeAt(this.pos + 1);
        if (code > 0xdbff || !(low >= 0xdc00 && low <= 0xdfff)) {
          this.fail('TOML_LONE_SURROGATE', `Lone surrogate U+${hex4(code)} in string`);
        }
        out += this.text.slice(this.pos, this.pos + 2);
        this.pos += 2;
        continue;
      }
      out += ch;
      this.pos += 1;
    }
    return this.fail('TOML_UNEXPECTED_END', 'Unterminated basic string');
  }

  parseMultilineBasicString() {
    this.pos += 3; // '"""'
    // A newline immediately following the opening delimiter is trimmed
    if (this.text[this.pos] === '\n') this.pos += 1;
    else if (this.text[this.pos] === '\r' && this.text[this.pos + 1] === '\n') this.pos += 2;

    let out = '';
    while (this.pos < this.text.length) {
      if (this.text.startsWith('"""', this.pos)) {
        // TOML allows up to 2 extra quotes inside the closing delimiter (e.g. """"" -> "" + """)
        let quotes = 0;
        while (this.text[this.pos + quotes] === '"' && quotes < 5) quotes += 1;
        if (quotes >= 6) {
          this.fail('TOML_SYNTAX', 'Too many consecutive quotes in multiline basic string');
        }
        out += '"'.repeat(quotes - 3);
        this.pos += quotes;
        return out;
      }
      const ch = this.text[this.pos];
      const code = this.text.charCodeAt(this.pos);
      if (ch === '\\') {
        out += this.parseStringEscape(true);
        continue;
      }
      if (ch === '\r' && this.text[this.pos + 1] === '\n') {
        out += '\n';
        this.pos += 2;
        continue;
      }
      if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f) {
        this.fail('TOML_CONTROL_CHARACTER', `Unescaped control character U+${hex4(code)} in string`);
      }
      if (code >= 0xd800 && code <= 0xdfff) {
        const low = this.text.charCodeAt(this.pos + 1);
        if (code > 0xdbff || !(low >= 0xdc00 && low <= 0xdfff)) {
          this.fail('TOML_LONE_SURROGATE', `Lone surrogate U+${hex4(code)} in string`);
        }
        out += this.text.slice(this.pos, this.pos + 2);
        this.pos += 2;
        continue;
      }
      out += ch;
      this.pos += 1;
    }
    return this.fail('TOML_UNEXPECTED_END', 'Unterminated multiline basic string');
  }

  parseStringEscape(multiline) {
    const start = this.pos;
    this.pos += 1; // '\\'
    if (multiline) {
      // Line-ending backslash trims whitespace and newlines until the next non-whitespace char
      let look = this.pos;
      while (this.text[look] === ' ' || this.text[look] === '\t') look += 1;
      if (this.text[look] === '\n' || (this.text[look] === '\r' && this.text[look + 1] === '\n')) {
        this.pos = look;
        while (
          this.text[this.pos] === ' '
          || this.text[this.pos] === '\t'
          || this.text[this.pos] === '\n'
          || (this.text[this.pos] === '\r' && this.text[this.pos + 1] === '\n')
        ) {
          if (this.text[this.pos] === '\r') this.pos += 2;
          else this.pos += 1;
        }
        return '';
      }
    }
    const ch = this.text[this.pos];
    this.pos += 1;
    switch (ch) {
      case 'b': return '\b';
      case 't': return '\t';
      case 'n': return '\n';
      case 'f': return '\f';
      case 'r': return '\r';
      case '"': return '"';
      case '\\': return '\\';
      case 'u': return this.readUnicodeScalar(4, start);
      case 'U': return this.readUnicodeScalar(8, start);
      case undefined:
        return this.fail('TOML_UNEXPECTED_END', 'Unterminated string escape', start);
      default:
        return this.fail('TOML_INVALID_ESCAPE', `Invalid string escape \\${ch}`, start);
    }
  }

  readUnicodeScalar(hexCount, start) {
    const digits = this.text.slice(this.pos, this.pos + hexCount);
    if (digits.length !== hexCount || !/^[0-9A-Fa-f]+$/u.test(digits)) {
      this.fail('TOML_INVALID_ESCAPE', `Expected ${hexCount} hexadecimal digits in Unicode escape`, start);
    }
    this.pos += hexCount;
    const scalar = Number.parseInt(digits, 16);
    if (scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff)) {
      this.fail('TOML_LONE_SURROGATE', `Invalid Unicode scalar value U+${digits.toUpperCase()}`, start);
    }
    return String.fromCodePoint(scalar);
  }

  parseLiteralString() {
    this.pos += 1; // "'"
    let out = '';
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      const code = this.text.charCodeAt(this.pos);
      if (ch === "'") {
        this.pos += 1;
        return out;
      }
      if (ch === '\n' || ch === '\r') {
        this.fail('TOML_SYNTAX', 'Unterminated literal string');
      }
      if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
        this.fail('TOML_CONTROL_CHARACTER', `Control character U+${hex4(code)} in literal string`);
      }
      out += ch;
      this.pos += 1;
    }
    return this.fail('TOML_UNEXPECTED_END', 'Unterminated literal string');
  }

  parseMultilineLiteralString() {
    this.pos += 3; // "'''"
    if (this.text[this.pos] === '\n') this.pos += 1;
    else if (this.text[this.pos] === '\r' && this.text[this.pos + 1] === '\n') this.pos += 2;

    let out = '';
    while (this.pos < this.text.length) {
      if (this.text.startsWith("'''", this.pos)) {
        let quotes = 0;
        while (this.text[this.pos + quotes] === "'" && quotes < 5) quotes += 1;
        if (quotes >= 6) {
          this.fail('TOML_SYNTAX', 'Too many consecutive quotes in multiline literal string');
        }
        out += "'".repeat(quotes - 3);
        this.pos += quotes;
        return out;
      }
      const ch = this.text[this.pos];
      const code = this.text.charCodeAt(this.pos);
      if (ch === '\r' && this.text[this.pos + 1] === '\n') {
        out += '\n';
        this.pos += 2;
        continue;
      }
      if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f) {
        this.fail('TOML_CONTROL_CHARACTER', `Control character U+${hex4(code)} in multiline literal string`);
      }
      out += ch;
      this.pos += 1;
    }
    return this.fail('TOML_UNEXPECTED_END', 'Unterminated multiline literal string');
  }

  // ---- numbers & temporals ------------------------------------------------

  parseNumericOrTemporal(loc) {
    const start = this.pos;
    // Consume token until a value terminator ( noting that a space between YYYY-MM-DD and HH:MM:SS is allowed in TOML datetimes )
    let end = start;
    while (end < this.text.length && !this.isValueTerminator(end)) {
      end += 1;
    }
    // Check for space-separated date-time: YYYY-MM-DD HH:MM...
    if (
      /^\d{4}-\d{2}-\d{2}$/u.test(this.text.slice(start, end))
      && this.text[end] === ' '
      && /^\d{2}:\d{2}/u.test(this.text.slice(end + 1, end + 6))
    ) {
      end += 1;
      while (end < this.text.length && !this.isValueTerminator(end)) {
        end += 1;
      }
    }

    const token = this.text.slice(start, end);
    if (token.length === 0) {
      this.fail('TOML_SYNTAX', 'Expected a value', start, loc.path);
    }
    this.pos = end;

    // 1. Special floats: [+-]?inf, [+-]?nan
    if (token === 'inf' || token === '+inf') {
      return { type: 'scalar', kind: 'InfinityLiteral', value: 'Infinity' };
    }
    if (token === '-inf') {
      return { type: 'scalar', kind: 'InfinityLiteral', value: '-Infinity' };
    }
    if (token === 'nan' || token === '+nan') {
      return { type: 'scalar', kind: 'NaNLiteral', value: 'NaN' };
    }
    if (token === '-nan') {
      return { type: 'scalar', kind: 'NaNLiteral', value: '-NaN' };
    }

    // 2. Temporal values (Date, Time, Date-Time)
    if (/^\d{4}-\d{2}-\d{2}/u.test(token) || /^\d{2}:\d{2}:/u.test(token)) {
      return this.parseTemporalToken(token, start, loc);
    }

    // 3. Numeric literal (check length limit first)
    if (token.length > this.limits.maxNumericLiteralCharacters) {
      throw limitError('maxNumericLiteralCharacters', token.length, this.limits, this.where(start, loc.path));
    }

    // 3a. Radix integers: 0x..., 0o..., 0b... (no leading sign allowed in TOML)
    if (token.startsWith('0x') || token.startsWith('0o') || token.startsWith('0b')) {
      return this.parseRadixToken(token, start, loc);
    }

    // 3b. Decimal integer or float
    if (!isValidTomlDecimalOrFloat(token)) {
      this.fail('TOML_INVALID_NUMBER', `Invalid TOML number ${JSON.stringify(token)}`, start, loc.path);
    }
    if (!/[.eE]/u.test(token) && !isTomlIntegerInRange(token)) {
      this.fail('TOML_INTEGER_OUT_OF_RANGE', 'TOML integers must be between -9223372036854775808 and 9223372036854775807', start, loc.path);
    }
    return { type: 'scalar', kind: 'NumberLiteral', value: normalizeTomlNumber(token) };
  }

  parseRadixToken(token, start, loc) {
    const prefix = token.slice(0, 2);
    const body = token.slice(2);
    const spec = prefix === '0b'
      ? { base: '2', pattern: /^[01](?:_?[01])*$/u }
      : prefix === '0o'
        ? { base: '8', pattern: /^[0-7](?:_?[0-7])*$/u }
        : { base: '16', pattern: /^[0-9A-Fa-f](?:_?[0-9A-Fa-f])*$/u };

    if (!spec.pattern.test(body)) {
      this.fail('TOML_INVALID_NUMBER', `Invalid TOML ${prefix} integer ${JSON.stringify(token)}`, start, loc.path);
    }
    if (!isTomlIntegerInRange(token)) {
      this.fail('TOML_INTEGER_OUT_OF_RANGE', 'TOML integers must be between -9223372036854775808 and 9223372036854775807', start, loc.path);
    }
    return {
      type: 'scalar',
      kind: 'RadixLiteral',
      datatype: 'radix',
      generics: [],
      clarifiers: [{ kind: 'NumberLiteral', value: spec.base }],
      value: body.replace(/_/g, '').toUpperCase(),
    };
  }

  parseTemporalToken(token, start, loc) {
    if (token.startsWith('0000-')) {
      this.fail('TOML_UNSUPPORTED_YEAR', 'Year 0000 is not supported; date and date-time years must be 0001 through 9999', start, loc.path);
    }
    // Local Date: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/u.test(token)) {
      if (!isValidCalendarDate(token)) {
        this.fail('TOML_INVALID_DATETIME', `Invalid calendar date ${token}`, start, loc.path);
      }
      return { type: 'scalar', kind: 'DateLiteral', value: token };
    }

    // Local Time: HH:MM:SS(.frac)?
    if (/^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(token)) {
      if (!isValidClockTime(token)) {
        this.fail('TOML_INVALID_DATETIME', `Invalid local time ${token}`, start, loc.path);
      }
      return { type: 'scalar', kind: 'TimeLiteral', value: token };
    }

    // Local or Offset Date-Time: YYYY-MM-DD[Tt ]HH:MM:SS(.frac)?(Z|z|[+-]HH:MM)?
    const match = token.match(
      /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|z|[+-]\d{2}:\d{2})?$/iu,
    );
    if (!match) {
      this.fail('TOML_INVALID_DATETIME', `Invalid TOML date-time ${JSON.stringify(token)}`, start, loc.path);
    }
    const [, datePart, timePart, offsetPart] = match;
    if (!isValidCalendarDate(datePart) || !isValidClockTime(timePart)) {
      this.fail('TOML_INVALID_DATETIME', `Invalid calendar date or time in ${token}`, start, loc.path);
    }
    let normalizedOffset = '';
    if (offsetPart !== undefined) {
      if (offsetPart === 'Z' || offsetPart === 'z') {
        normalizedOffset = 'Z';
      } else {
        const offHour = Number(offsetPart.slice(1, 3));
        const offMin = Number(offsetPart.slice(4, 6));
        if (offHour > 23 || offMin > 59) {
          this.fail('TOML_INVALID_DATETIME', `Invalid UTC offset ${offsetPart} in ${token}`, start, loc.path);
        }
        normalizedOffset = offsetPart;
      }
    }
    return {
      type: 'scalar',
      kind: 'DateTimeLiteral',
      value: `${datePart}T${timePart}${normalizedOffset}`,
    };
  }

  // ---- tree -> flat AES emission ------------------------------------------

  emitTree(rootTable) {
    if (!this.native) {
      const loc = this.childPath({ path: '$', segments: 0, chars: 1 }, '.[""]', 0);
      this.emitNode(loc, rootTable, 0);
      if (this.sourceMetadata) {
        const metadata = [
          {key: 'source', kind: 'SymbolicLiteral', value: 'TOML'},
          {key: 'version', kind: 'StringLiteral', value: '1.0'},
        ];
        for (const {key, kind, value} of metadata) {
          this.checkCodepoints('maxKeySegmentCodepoints', key, 0, loc.path);
          if (kind === 'StringLiteral') this.checkCodepoints('maxStringCodepoints', value, 0, loc.path);
          const attr = this.childPath(loc, `.@.${key}`, 0);
          this.pushRecord(attr, {path: attr.path, kind, value});
        }
        this.records.splice(1, 0, ...this.records.splice(-metadata.length));
      }
      return this.records;
    }
    for (const [key, child] of rootTable.entries) {
      const childLoc = this.childPath({ path: '$', segments: 0, chars: 1 }, memberSegment(key), child.pos ?? 0);
      this.emitNode(childLoc, child, 0);
    }
    return this.records;
  }

  emitNode(loc, node, nesting) {
    if (node.type === 'scalar') {
      const record = { path: loc.path, kind: node.kind };
      if (node.datatype !== undefined) {
        record.datatype = node.datatype;
        record.generics = node.generics;
        record.clarifiers = node.clarifiers;
      }
      record.value = node.value;
      this.pushRecord(loc, record);
      return;
    }

    if (nesting + 1 > this.limits.maxValueNestingDepth) {
      throw limitError('maxValueNestingDepth', nesting + 1, this.limits, this.where(node.pos ?? 0, loc.path));
    }

    if (node.type === 'table') {
      this.pushRecord(loc, { path: loc.path, kind: 'ObjectNode' });
      for (const [key, child] of node.entries) {
        const childLoc = this.childPath(loc, memberSegment(key), child.pos ?? node.pos ?? 0);
        this.emitNode(childLoc, child, nesting + 1);
      }
      return;
    }

    if (node.type === 'array' || node.type === 'aot') {
      this.pushRecord(loc, { path: loc.path, kind: 'ListNode' });
      for (let i = 0; i < node.items.length; i += 1) {
        const item = node.items[i];
        const itemLoc = this.childPath(loc, `[${i}]`, item.pos ?? node.pos ?? 0);
        this.emitNode(itemLoc, item, nesting + 1);
      }
    }
  }

  pushRecord(loc, record) {
    if (this.records.length + 1 > this.limits.maxEvents) {
      throw limitError('maxEvents', this.records.length + 1, this.limits, this.where(this.pos, loc.path));
    }
    this.records.push(record);
  }

  // ---- helpers ------------------------------------------------------------

  childPath(loc, segment, at) {
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

  checkCodepoints(limitKey, value, at, path) {
    const maximum = this.limits[limitKey];
    if (value.length <= maximum) return;
    const observed = codepointLength(value);
    if (observed > maximum) throw limitError(limitKey, observed, this.limits, this.where(at, path));
  }

  isValueTerminator(index) {
    const ch = this.text[index];
    return (
      ch === undefined
      || ch === ' '
      || ch === '\t'
      || ch === '\n'
      || ch === '\r'
      || ch === ','
      || ch === ']'
      || ch === '}'
      || ch === '#'
    );
  }

  skipSpaces() {
    while (this.text[this.pos] === ' ' || this.text[this.pos] === '\t') {
      this.pos += 1;
    }
  }

  skipSpacesAndComment() {
    this.skipSpaces();
    if (this.text[this.pos] === '#') {
      this.pos += 1;
      while (this.pos < this.text.length && this.text[this.pos] !== '\n') {
        const code = this.text.charCodeAt(this.pos);
        if (this.text[this.pos] === '\r' && this.text[this.pos + 1] === '\n') break;
        if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
          this.fail('TOML_CONTROL_CHARACTER', `Control character U+${hex4(code)} in comment`);
        }
        this.pos += 1;
      }
    }
  }

  skipWsAndComments(allowNewlines) {
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === ' ' || ch === '\t') {
        this.pos += 1;
      } else if (allowNewlines && ch === '\n') {
        this.pos += 1;
      } else if (allowNewlines && ch === '\r' && this.text[this.pos + 1] === '\n') {
        this.pos += 2;
      } else if (ch === '#') {
        this.skipSpacesAndComment();
      } else {
        return;
      }
    }
  }

  fail(code, message, at = this.pos, path) {
    throw new TomlAesError(code, message, this.where(at, path));
  }

  where(at, path) {
    return locate(this.text, at, path);
  }
}

function isValidTomlDecimalOrFloat(token) {
  const intPart = '(?:0|[1-9](?:_?[0-9])*)';
  const fracPart = '(?:\\.[0-9](?:_?[0-9])*)';
  const expPart = '(?:[eE][+-]?[0-9](?:_?[0-9])*)';
  const pattern = new RegExp(`^[+-]?${intPart}${fracPart}?${expPart}?$`, 'u');
  return pattern.test(token);
}

function isValidCalendarDate(dateText) {
  const [y, m, d] = dateText.split('-').map(Number);
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const maxDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= maxDays;
}

function isValidClockTime(timeText) {
  const [hms] = timeText.split('.');
  const [h, m, s] = hms.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 60;
}

function memberSegment(key) {
  return BARE_MEMBER.test(key) ? `.${key}` : `.[${JSON.stringify(key)}]`;
}

function limitError(limitKey, observed, limits, where) {
  const limit = LIMIT_NAMES[limitKey];
  return new TomlAesError(
    'TOML_LIMIT_EXCEEDED',
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
    if (i + needed >= bytes.length) return i;
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

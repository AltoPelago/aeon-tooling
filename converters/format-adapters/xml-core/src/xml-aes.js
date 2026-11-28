/**
 * Dependency-free strict XML 1.0 to AES (`aes.events.v1` / `aes.complete.v1`)
 * source-format adapter.
 *
 * Implements Section 6 of `source-format-adapters.md` and the five mandatory
 * Aeonite third-format adapter principles:
 * 1. No coercion: XML attribute values and element character data remain `StringLiteral`.
 * 2. No repair: Duplicate attributes, mismatched end tags, malformed names, and
 *    unknown entities are rejected with exact offset/line/column diagnostics.
 * 3. No silent data loss: Significant character data, CDATA content and boundaries (by default), and exact
 *    attribute string values (e.g., `"3.30"`, `"03.30"`) are preserved verbatim.
 * 4. No invented semantics: Element and attribute names never trigger hidden
 *    AEON header/directive semantics (`aeon:mode`, etc.).
 * 5. No structural reinterpretation: Repeated child elements and mixed content
 *    remain ordered indexed children under their tagged node.
 */

import { Buffer } from 'node:buffer';
import {
  formatAttributePath,
  formatRootMemberPath,
  formatTelex,
} from './telex.js';

export const DEFAULT_XML_AES_LIMITS = Object.freeze({
  maxInputBytes: 16_777_216,
  maxEvents: 100_000,
  maxValueNestingDepth: 256,
  maxPathDepth: 1_024,
  maxPathCharacters: 8_192,
  maxStringCodepoints: 1_048_576,
  maxKeySegmentCodepoints: 1_024,
  maxNodeChildren: 65_536,
});

export const XML_ADAPTER_PRINCIPLES = Object.freeze({
  noCoercion: true,
  noRepair: true,
  noSilentDataLoss: true,
  noInventedSemantics: true,
  noStructuralReinterpretation: true,
});

export const XML_DOCUMENT_TAG = 'xml';
export const XML_DECLARATION_TAG = '?xml';
export const XML_COMMENT_TAG = '!--';

const PREDEFINED_ENTITIES = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['apos', "'"],
  ['quot', '"'],
]);

export class XmlAesError extends Error {
  /**
   * @param {string} message
   * @param {{
   *   code?: string,
   *   offset?: number,
   *   line?: number,
   *   column?: number,
   *   path?: string,
   *   counter?: string,
   *   observed?: number,
   *   limit?: number
   * }} [details]
   */
  constructor(message, details = {}) {
    const loc =
      details.line !== undefined && details.column !== undefined
        ? ` (line ${details.line}, column ${details.column})`
        : '';
    super(`${message}${loc}`);
    this.name = 'XmlAesError';
    this.code = details.code ?? 'XML_SYNTAX_ERROR';
    if (details.offset !== undefined) this.offset = details.offset;
    if (details.line !== undefined) this.line = details.line;
    if (details.column !== undefined) this.column = details.column;
    if (details.path !== undefined) this.path = details.path;
    if (details.counter !== undefined) this.counter = details.counter;
    if (details.observed !== undefined) this.observed = details.observed;
    if (details.limit !== undefined) this.limit = details.limit;
  }
}

/**
 * Normalizes user-supplied options and Aeonic limits.
 *
 * @param {object} [options]
 */
export function normalizeXmlAesLimits(options = {}) {
  const raw = options?.limits ?? options ?? {};
  const pick = (key, fallback) => {
    const val = raw[key];
    if (val === undefined) return fallback;
    if (!Number.isInteger(val) || val < 0) {
      throw new RangeError(`Limit '${key}' must be a non-negative integer`);
    }
    return val;
  };
  return {
    maxInputBytes: pick('maxInputBytes', DEFAULT_XML_AES_LIMITS.maxInputBytes),
    maxEvents: pick('maxEvents', DEFAULT_XML_AES_LIMITS.maxEvents),
    maxValueNestingDepth: pick(
      'maxValueNestingDepth',
      DEFAULT_XML_AES_LIMITS.maxValueNestingDepth,
    ),
    maxPathDepth: pick('maxPathDepth', DEFAULT_XML_AES_LIMITS.maxPathDepth),
    maxPathCharacters: pick(
      'maxPathCharacters',
      DEFAULT_XML_AES_LIMITS.maxPathCharacters,
    ),
    maxStringCodepoints: pick(
      'maxStringCodepoints',
      DEFAULT_XML_AES_LIMITS.maxStringCodepoints,
    ),
    maxKeySegmentCodepoints: pick(
      'maxKeySegmentCodepoints',
      DEFAULT_XML_AES_LIMITS.maxKeySegmentCodepoints,
    ),
    maxNodeChildren: pick(
      'maxNodeChildren',
      DEFAULT_XML_AES_LIMITS.maxNodeChildren,
    ),
  };
}

/**
 * Checks whether a Unicode code point is a valid XML 1.0 `Char` (§2.2):
 * `#x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]`
 *
 * @param {number} cp
 * @returns {boolean}
 */
function isXmlChar(cp) {
  return (
    cp === 0x09 ||
    cp === 0x0a ||
    cp === 0x0d ||
    (cp >= 0x20 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd) ||
    (cp >= 0x10000 && cp <= 0x10ffff)
  );
}

/**
 * Checks whether a Unicode code point is a valid XML 1.0 `NameStartChar` (§2.3).
 *
 * @param {number} cp
 * @returns {boolean}
 */
function isNameStartChar(cp) {
  return (
    cp === 0x3a || // ':'
    (cp >= 0x41 && cp <= 0x5a) || // A-Z
    cp === 0x5f || // '_'
    (cp >= 0x61 && cp <= 0x7a) || // a-z
    (cp >= 0xc0 && cp <= 0xd6) ||
    (cp >= 0xd8 && cp <= 0xf6) ||
    (cp >= 0xf8 && cp <= 0x2ff) ||
    (cp >= 0x370 && cp <= 0x37d) ||
    (cp >= 0x37f && cp <= 0x1fff) ||
    (cp >= 0x200c && cp <= 0x200d) ||
    (cp >= 0x2070 && cp <= 0x218f) ||
    (cp >= 0x2c00 && cp <= 0x2fef) ||
    (cp >= 0x3001 && cp <= 0xd7ff) ||
    (cp >= 0xf900 && cp <= 0xfdcf) ||
    (cp >= 0xfdf0 && cp <= 0xfffd) ||
    (cp >= 0x10000 && cp <= 0xeffff)
  );
}

/**
 * Checks whether a Unicode code point is a valid XML 1.0 `NameChar` (§2.3).
 *
 * @param {number} cp
 * @returns {boolean}
 */
function isNameChar(cp) {
  return (
    isNameStartChar(cp) ||
    cp === 0x2d || // '-'
    cp === 0x2e || // '.'
    (cp >= 0x30 && cp <= 0x39) || // 0-9
    cp === 0xb7 ||
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x203f && cp <= 0x2040)
  );
}

/**
 * Validates that a parsed XML Name is also well-formed with respect to colons
 * (cannot start or end with `:`, and cannot contain `::`).
 *
 * @param {string} name
 * @returns {boolean}
 */
function hasValidColonPlacement(name) {
  if (name.startsWith(':') || name.endsWith(':')) return false;
  if (name.includes('::')) return false;
  return true;
}

export function isXmlName(name, qualified = true) {
  if (typeof name !== 'string' || !isNameStartChar(name.codePointAt(0))) return false;
  for (const ch of name) {
    if (!isNameChar(ch.codePointAt(0))) return false;
  }
  return !qualified || hasValidColonPlacement(name);
}

function isXmlWhitespace(code) {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isAllXmlWhitespace(str) {
  for (let i = 0; i < str.length; i += 1) {
    if (!isXmlWhitespace(str.charCodeAt(i))) return false;
  }
  return true;
}

/**
 * Trims leading and trailing newline+indentation runs on inter-element mixed
 * text while preserving inline spaces (e.g. `<p>Hello <b>world</b>!</p>`).
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeInterElementMixedText(text) {
  let start = 0;
  let end = text.length;

  // Check if leading whitespace contains a newline (indentation before text)
  let firstNonWs = 0;
  let leadingHasNewline = false;
  while (firstNonWs < end && isXmlWhitespace(text.charCodeAt(firstNonWs))) {
    if (text.charCodeAt(firstNonWs) === 0x0a) leadingHasNewline = true;
    firstNonWs += 1;
  }
  if (leadingHasNewline) {
    start = firstNonWs;
  }

  // Check if trailing whitespace contains a newline (indentation after text)
  let lastNonWs = end;
  let trailingHasNewline = false;
  while (lastNonWs > start && isXmlWhitespace(text.charCodeAt(lastNonWs - 1))) {
    if (text.charCodeAt(lastNonWs - 1) === 0x0a) trailingHasNewline = true;
    lastNonWs -= 1;
  }
  if (trailingHasNewline) {
    end = lastNonWs;
  }

  return text.slice(start, end);
}

function countCodepoints(str) {
  let count = 0;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
    }
    count += 1;
  }
  return count;
}

/**
 * Parses an XML 1.0 document string and returns portable AES event records.
 *
 * @param {string} input
 * @param {{
 *   mapping?: 'root' | 'native',
 *   sourceMetadata?: boolean,
 *   rootName?: string,
 *   preserveWhitespace?: boolean,
 *   preserveCdata?: boolean,
 *   includeDeclarationMetadata?: boolean,
 *   limits?: Partial<typeof DEFAULT_XML_AES_LIMITS>
 * }} [options]
 * @returns {Array<{path: string, kind: string, tag?: string, datatype?: string, value?: string}>}
 */
export function xmlToAes(input, options = {}) {
  if (typeof input !== 'string') {
    throw new TypeError('XML input must be a string');
  }

  const limits = normalizeXmlAesLimits(options);
  if (options.mapping !== undefined && !['native', 'root'].includes(options.mapping)) throw new TypeError('Unknown mapping mode');
  const rootName = options.rootName ?? XML_DOCUMENT_TAG;
  if (typeof rootName !== 'string' || !rootName || rootName === XML_DECLARATION_TAG || !rootName.isWellFormed()) {
    throw new XmlAesError('The XML document wrapper requires a non-empty Unicode tag distinct from ?xml', {
      code: 'XML_INVALID_ROOT_NAME',
      offset: 0,
      line: 1,
      column: 1,
      path: '$',
    });
  }
  const preserveWhitespaceOption = options.preserveWhitespace === true;
  const preserveCdata = options.preserveCdata !== false;
  const includeDeclarationMetadata = options.includeDeclarationMetadata !== false;

  const byteLength = Buffer.byteLength(input, 'utf8');
  if (byteLength > limits.maxInputBytes) {
    throw new XmlAesError(
      `XML input exceeds max_input_bytes (${byteLength} > ${limits.maxInputBytes})`,
      {
        code: 'XML_LIMIT_EXCEEDED',
        counter: 'max_input_bytes',
        observed: byteLength,
        limit: limits.maxInputBytes,
        offset: 0,
        line: 1,
        column: 1,
        path: '$',
      },
    );
  }

  if (input.startsWith('\uFEFF')) {
    throw new XmlAesError('UTF-8 byte-order mark (BOM) is not allowed', {
      code: 'XML_BOM',
      offset: 0,
      line: 1,
      column: 1,
      path: '$',
    });
  }

  // Validate XML 1.0 characters and reject lone surrogates across the input
  {
    let ln = 1;
    let col = 1;
    for (let i = 0; i < input.length; i += 1) {
      const code = input.charCodeAt(i);
      if (code === 0x0d) {
        if (i + 1 < input.length && input.charCodeAt(i + 1) === 0x0a) {
          i += 1;
        }
        ln += 1;
        col = 1;
        continue;
      }
      if (code === 0x0a) {
        ln += 1;
        col = 1;
        continue;
      }
      let cp = code;
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
        if (next < 0xdc00 || next > 0xdfff) {
          throw new XmlAesError('Lone high surrogate in XML input', {
            code: 'XML_LONE_SURROGATE',
            offset: i,
            line: ln,
            column: col,
            path: '$',
          });
        }
        cp = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        i += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new XmlAesError('Lone low surrogate in XML input', {
          code: 'XML_LONE_SURROGATE',
          offset: i,
          line: ln,
          column: col,
          path: '$',
        });
      }
      if (!isXmlChar(cp)) {
        throw new XmlAesError(
          `Invalid XML 1.0 character U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
          {
            code: 'XML_INVALID_CHARACTER',
            offset: i,
            line: ln,
            column: col,
            path: '$',
          },
        );
      }
      col += 1;
    }
  }

  let pos = 0;
  let line = 1;
  let column = 1;
  const len = input.length;

  function currentLoc() {
    return { offset: pos, line, column };
  }

  function fail(message, code, path = '$', loc = currentLoc(), extra = {}) {
    throw new XmlAesError(message, {
      code,
      offset: loc.offset,
      line: loc.line,
      column: loc.column,
      path,
      ...extra,
    });
  }

  function advance(count = 1) {
    for (let k = 0; k < count && pos < len; k += 1) {
      const ch = input.charCodeAt(pos);
      if (ch === 0x0d) {
        pos += 1;
        if (pos < len && input.charCodeAt(pos) === 0x0a) {
          pos += 1;
        }
        line += 1;
        column = 1;
      } else if (ch === 0x0a) {
        pos += 1;
        line += 1;
        column = 1;
      } else {
        if (ch >= 0xd800 && ch <= 0xdbff && pos + 1 < len) {
          pos += 2;
        } else {
          pos += 1;
        }
        column += 1;
      }
    }
  }

  function advanceRawCodeUnits(units) {
    for (let k = 0; k < units && pos < len; k += 1) {
      const ch = input.charCodeAt(pos);
      if (ch === 0x0d) {
        pos += 1;
        if (k + 1 < units && pos < len && input.charCodeAt(pos) === 0x0a) {
          pos += 1;
          k += 1;
        }
        line += 1;
        column = 1;
      } else if (ch === 0x0a) {
        pos += 1;
        line += 1;
        column = 1;
      } else {
        pos += 1;
        column += 1;
      }
    }
  }

  function skipWhitespace() {
    let skipped = false;
    while (pos < len && isXmlWhitespace(input.charCodeAt(pos))) {
      advance(1);
      skipped = true;
    }
    return skipped;
  }

  function startsWith(prefix) {
    return input.startsWith(prefix, pos);
  }

  function readXmlName(path, contextLabel = 'XML name', qualified = true) {
    const startLoc = currentLoc();
    const startPos = pos;
    if (pos >= len) {
      fail(`Expected ${contextLabel}`, 'XML_EXPECTED_NAME', path, startLoc);
    }
    const firstCp = input.codePointAt(pos);
    if (!isNameStartChar(firstCp)) {
      fail(`Invalid ${contextLabel}`, 'XML_INVALID_NAME', path, startLoc);
    }
    advance(1);
    while (pos < len) {
      const cp = input.codePointAt(pos);
      if (!isNameChar(cp)) break;
      advance(1);
    }
    const name = input.slice(startPos, pos);
    if (qualified && !hasValidColonPlacement(name)) {
      fail(
        `Invalid qualified ${contextLabel} '${name}'`,
        'XML_INVALID_QNAME',
        path,
        startLoc,
      );
    }
    return name;
  }

  function readEntityOrCharRef(path) {
    const startLoc = currentLoc();
    // Assumes input[pos] === '&'
    advanceRawCodeUnits(1);
    const semiIdx = input.indexOf(';', pos);
    if (semiIdx === -1) {
      fail("Unterminated reference (missing ';')", 'XML_UNTERMINATED_REFERENCE', path, startLoc);
    }
    const rawRef = input.slice(pos, semiIdx);
    if (rawRef.length === 0) {
      fail('Empty reference', 'XML_INVALID_REFERENCE', path, startLoc);
    }
    advanceRawCodeUnits(rawRef.length + 1);

    if (rawRef.startsWith('#x')) {
      const hex = rawRef.slice(2);
      if (!/^[0-9A-Fa-f]+$/u.test(hex)) {
        fail(`Invalid hexadecimal character reference '&#${rawRef};'`, 'XML_INVALID_CHAR_REF', path, startLoc);
      }
      const cp = Number.parseInt(hex, 16);
      if (!Number.isSafeInteger(cp) || !isXmlChar(cp)) {
        fail(`Character reference '&#${rawRef};' is not a valid XML 1.0 character`, 'XML_INVALID_CHAR_REF', path, startLoc);
      }
      return String.fromCodePoint(cp);
    }

    if (rawRef.startsWith('#')) {
      const dec = rawRef.slice(1);
      if (!/^[0-9]+$/u.test(dec)) {
        fail(`Invalid decimal character reference '&#${rawRef};'`, 'XML_INVALID_CHAR_REF', path, startLoc);
      }
      const cp = Number.parseInt(dec, 10);
      if (!Number.isSafeInteger(cp) || !isXmlChar(cp)) {
        fail(`Character reference '&#${rawRef};' is not a valid XML 1.0 character`, 'XML_INVALID_CHAR_REF', path, startLoc);
      }
      return String.fromCodePoint(cp);
    }

    if (PREDEFINED_ENTITIES.has(rawRef)) {
      return PREDEFINED_ENTITIES.get(rawRef);
    }

    fail(
      `Unknown or unexpanded entity reference '&${rawRef};'`,
      'XML_UNKNOWN_ENTITY',
      path,
      startLoc,
    );
  }

  function readAttributeValue(path, allowReferences = true) {
    const quoteLoc = currentLoc();
    if (pos >= len || (input[pos] !== '"' && input[pos] !== "'")) {
      fail('Expected quoted attribute value', 'XML_EXPECTED_ATTRIBUTE_VALUE', path, quoteLoc);
    }
    const quote = input[pos];
    advanceRawCodeUnits(1);
    let out = '';
    while (pos < len) {
      const ch = input[pos];
      if (ch === quote) {
        advanceRawCodeUnits(1);
        return out;
      }
      if (ch === '<') {
        fail("Unescaped '<' is not allowed inside attribute values", 'XML_UNEXPECTED_LT_IN_ATTRIBUTE', path);
      }
      if (ch === '&') {
        if (!allowReferences) {
          fail('XML declaration values must be literal', 'XML_INVALID_DECLARATION', path);
        }
        out += readEntityOrCharRef(path);
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code === 0x0d || code === 0x0a || code === 0x09) {
        // XML 1.0 §3.3.3 attribute-value normalization turns literal whitespace into 0x20
        advance(1);
        out += ' ';
        continue;
      }
      if (code >= 0xd800 && code <= 0xdbff) {
        out += input.slice(pos, pos + 2);
        advance(1);
      } else {
        out += ch;
        advance(1);
      }
    }
    fail('Unterminated attribute value', 'XML_UNTERMINATED_ATTRIBUTE', path, quoteLoc);
  }

  function readMiscNode(path, valueDepth) {
    const startLoc = currentLoc();
    checkNodeDepth(valueDepth, path, startLoc);
    const comment = startsWith('<!--');
    let tagName = XML_COMMENT_TAG;
    if (comment) {
      advanceRawCodeUnits(4);
    } else {
      advanceRawCodeUnits(2);
      const target = readXmlName(path, 'processing instruction target', false);
      if (target.toLowerCase() === 'xml') {
        fail('The XML declaration is reserved for the start of the document',
          target === 'xml' ? 'XML_MISPLACED_DECLARATION' : 'XML_RESERVED_PI_TARGET', path, startLoc);
      }
      if (!skipWhitespace() && !startsWith('?>')) {
        fail('Expected whitespace or ?> after the processing instruction target',
          'XML_INVALID_PI', path);
      }
      tagName = '?' + target;
    }
    const closer = comment ? '-->' : '?>';
    const closeIdx = input.indexOf(closer, pos);
    if (closeIdx === -1) {
      fail(comment ? 'Unterminated XML comment' : 'Unterminated processing instruction',
        comment ? 'XML_UNTERMINATED_COMMENT' : 'XML_UNTERMINATED_PI', path, startLoc);
    }
    const body = input.slice(pos, closeIdx);
    if (comment && (body.includes('--') || body.endsWith('-'))) {
      fail("XML comment must not contain '--' or end with '--->'", 'XML_INVALID_COMMENT', path, startLoc);
    }
    const children = comment || body.length ? [{
      type: 'text', value: body.replace(/\r\n?/gu, '\n'), loc: currentLoc(),
    }] : [];
    advanceRawCodeUnits(body.length + closer.length);
    return { tagName, attributes: [], children, hasElementChildren: false, loc: startLoc };
  }

  function parseXmlDeclaration(rootPath) {
    const startLoc = currentLoc();
    // Assumes startsWith('<?xml')
    advanceRawCodeUnits(5);
    if (pos >= len || (!isXmlWhitespace(input.charCodeAt(pos)) && !startsWith('?>'))) {
      fail('Invalid XML declaration or processing instruction', 'XML_INVALID_DECLARATION', rootPath, startLoc);
    }

    const declAttrs = new Map();
    const order = ['version', 'encoding', 'standalone'];
    let minOrderIdx = 0;

    while (pos < len) {
      const hadWs = skipWhitespace();
      if (startsWith('?>')) {
        advanceRawCodeUnits(2);
        if (!declAttrs.has('version')) {
          fail("XML declaration requires a 'version' attribute", 'XML_INVALID_DECLARATION', rootPath, startLoc);
        }
        return declAttrs;
      }
      if (!hadWs) {
        fail('Expected whitespace between XML declaration attributes', 'XML_INVALID_DECLARATION', rootPath);
      }
      const attrLoc = currentLoc();
      const name = readXmlName(rootPath, 'XML declaration attribute');
      if (declAttrs.has(name)) {
        fail(`Duplicate XML declaration attribute '${name}'`, 'XML_INVALID_DECLARATION', rootPath, attrLoc);
      }
      const orderIdx = order.indexOf(name);
      if (orderIdx === -1 || orderIdx < minOrderIdx) {
        fail(
          `Invalid or out-of-order XML declaration attribute '${name}'`,
          'XML_INVALID_DECLARATION',
          rootPath,
          attrLoc,
        );
      }
      minOrderIdx = orderIdx + 1;

      skipWhitespace();
      if (pos >= len || input[pos] !== '=') {
        fail("Expected '=' in XML declaration", 'XML_INVALID_DECLARATION', rootPath);
      }
      advanceRawCodeUnits(1);
      skipWhitespace();
      const valLoc = currentLoc();
      const val = readAttributeValue(rootPath, false);

      if (name === 'version') {
        if (val !== '1.0') {
          fail(`Unsupported XML version '${val}' (only '1.0' is supported)`, 'XML_UNSUPPORTED_VERSION', rootPath, valLoc);
        }
      } else if (name === 'encoding') {
        if (!/^[A-Za-z][A-Za-z0-9._-]*$/u.test(val)) {
          fail(`Invalid XML encoding declaration '${val}'`, 'XML_INVALID_DECLARATION', rootPath, valLoc);
        }
      } else if (name === 'standalone') {
        if (val !== 'yes' && val !== 'no') {
          fail(`Invalid XML standalone declaration '${val}' (expected 'yes' or 'no')`, 'XML_INVALID_DECLARATION', rootPath, valLoc);
        }
      }
      declAttrs.set(name, { value: val, loc: attrLoc });
    }

    fail('Unterminated XML declaration', 'XML_INVALID_DECLARATION', rootPath, startLoc);
  }

  function checkNodeDepth(valueDepth, path, loc) {
    if (valueDepth > limits.maxValueNestingDepth) {
      fail(
        `XML node nesting exceeds max_value_nesting_depth (${valueDepth} > ${limits.maxValueNestingDepth})`,
        'XML_LIMIT_EXCEEDED',
        path,
        loc,
        {
          counter: 'max_value_nesting_depth',
          observed: valueDepth,
          limit: limits.maxValueNestingDepth,
        },
      );
    }
  }

  /**
   * Parses an XML element into an intermediate representation before emitting
   * depth-first preorder AES records.
   */
  function parseElement(parentPath, valueDepth) {
    const startLoc = currentLoc();
    checkNodeDepth(valueDepth, parentPath, startLoc);

    // Assumes input[pos] === '<'
    advanceRawCodeUnits(1);
    const tagName = readXmlName(parentPath, 'element name');
    const attributes = [];
    const seenAttrs = new Set();

    while (pos < len) {
      const hadWs = skipWhitespace();
      if (startsWith('/>')) {
        advanceRawCodeUnits(2);
        return {
          tagName,
          attributes,
          children: [],
          hasElementChildren: false,
          loc: startLoc,
        };
      }
      if (input[pos] === '>') {
        advanceRawCodeUnits(1);
        break;
      }
      if (!hadWs) {
        fail(
          `Expected whitespace before attribute in <${tagName}>`,
          'XML_EXPECTED_WHITESPACE',
          parentPath,
        );
      }
      const attrLoc = currentLoc();
      const attrName = readXmlName(parentPath, 'attribute name');
      if (seenAttrs.has(attrName)) {
        fail(
          `Duplicate attribute '${attrName}' on element <${tagName}>`,
          'XML_DUPLICATE_ATTRIBUTE',
          parentPath,
          attrLoc,
        );
      }
      seenAttrs.add(attrName);
      skipWhitespace();
      if (pos >= len || input[pos] !== '=') {
        fail(
          `Expected '=' after attribute name '${attrName}'`,
          'XML_EXPECTED_EQUALS',
          parentPath,
        );
      }
      advanceRawCodeUnits(1);
      skipWhitespace();
      const attrValue = readAttributeValue(parentPath);
      attributes.push({ name: attrName, value: attrValue, loc: attrLoc });
    }

    // Parse element content until matching </tagName>
    const rawItems = [];
    let currentText = '';
    let currentTextHasCdata = false;
    let currentTextHasNonWsCharRef = false;
    let currentTextLoc = currentLoc();
    let hasElementChildren = false;
    let structuralChildren = 0;

    function flushText() {
      if (currentText.length > 0 || currentTextHasCdata) {
        rawItems.push({
          type: 'text',
          value: currentText,
          hasCdata: currentTextHasCdata,
          hasNonWsCharRef: currentTextHasNonWsCharRef,
          loc: currentTextLoc,
        });
        currentText = '';
        currentTextHasCdata = false;
        currentTextHasNonWsCharRef = false;
      }
    }

    while (pos < len) {
      if (startsWith('</')) {
        flushText();
        const closeLoc = currentLoc();
        advanceRawCodeUnits(2);
        const closeName = readXmlName(parentPath, 'closing tag name');
        skipWhitespace();
        if (pos >= len || input[pos] !== '>') {
          fail(`Expected '>' in closing tag </${closeName}>`, 'XML_UNEXPECTED_TOKEN', parentPath, closeLoc);
        }
        advanceRawCodeUnits(1);
        if (closeName !== tagName) {
          fail(
            `Mismatched closing tag </${closeName}> for <${tagName}>`,
            'XML_MISMATCHED_TAG',
            parentPath,
            closeLoc,
          );
        }
        return {
          tagName,
          attributes,
          children: rawItems,
          hasElementChildren,
          loc: startLoc,
        };
      }

      if (startsWith('<!--') || startsWith('<?')) {
        checkChildCount(++structuralChildren, parentPath, currentLoc());
        flushText();
        const element = readMiscNode(parentPath, valueDepth + 1);
        rawItems.push({ type: 'element', element });
        continue;
      }

      if (startsWith('<![CDATA[')) {
        if (preserveCdata) checkChildCount(++structuralChildren, parentPath, currentLoc());
        if (preserveCdata) flushText();
        if (currentText.length === 0 && !currentTextHasCdata) {
          currentTextLoc = currentLoc();
        }
        const cdataLoc = currentLoc();
        advanceRawCodeUnits(9);
        const closeIdx = input.indexOf(']]>', pos);
        if (closeIdx === -1) {
          fail('Unterminated CDATA section', 'XML_UNTERMINATED_CDATA', parentPath, cdataLoc);
        }
        const rawCdata = input.slice(pos, closeIdx);
        // Normalize \r\n and \r inside CDATA to \n per XML 1.0 §2.11
        const normalizedCdata = rawCdata.replace(/\r\n?/gu, '\n');
        if (preserveCdata) {
          rawItems.push({type: 'text', value: normalizedCdata, hasCdata: true, isCdata: true,
            hasNonWsCharRef: false, loc: cdataLoc});
        } else {
          currentText += normalizedCdata;
          currentTextHasCdata = true;
        }
        advanceRawCodeUnits(rawCdata.length + 3);
        if (preserveCdata) currentTextLoc = currentLoc();
        continue;
      }

      if (startsWith('<!')) {
        fail(
          'DTD and markup declarations (<!DOCTYPE>, <!ENTITY>, etc.) are forbidden',
          'XML_DTD_FORBIDDEN',
          parentPath,
        );
      }

      if (input[pos] === '<') {
        checkChildCount(++structuralChildren, parentPath, currentLoc());
        flushText();
        hasElementChildren = true;
        const childElem = parseElement(parentPath, valueDepth + 1);
        rawItems.push({ type: 'element', element: childElem });
        currentTextLoc = currentLoc();
        continue;
      }

      if (input[pos] === '&') {
        if (currentText.length === 0 && !currentTextHasCdata) {
          currentTextLoc = currentLoc();
        }
        const isCharRef = input[pos + 1] === '#';
        const expanded = readEntityOrCharRef(parentPath);
        if (isCharRef) {
          currentTextHasNonWsCharRef = true;
        }
        currentText += expanded;
        continue;
      }

      // Read regular character data up to next '<' or '&'
      if (currentText.length === 0 && !currentTextHasCdata) {
        currentTextLoc = currentLoc();
      }
      let chunkStart = pos;
      while (pos < len) {
        const c = input.charCodeAt(pos);
        if (c === 0x3c /* < */ || c === 0x26 /* & */) break;
        if (c === 0x5d /* ] */ && startsWith(']]>')) {
          fail(
            "Character data must not contain literal ']]>'",
            'XML_UNEXPECTED_CDATA_END',
            parentPath,
          );
        }
        advance(1);
      }
      const rawChunk = input.slice(chunkStart, pos);
      currentText += rawChunk.replace(/\r\n?/gu, '\n');
    }

    fail(`Unclosed element <${tagName}>`, 'XML_UNCLOSED_ELEMENT', parentPath, startLoc);
  }

  const rootPath = formatRootMemberPath(rootName);
  const declarationPath = formatRootMemberPath(XML_DECLARATION_TAG);
  const documentLoc = currentLoc();
  checkNodeDepth(1, rootPath, documentLoc);

  let declarationAttrs = null;
  if (startsWith('<?xml') && (pos + 5 >= len || isXmlWhitespace(input.charCodeAt(pos + 5)) || input.startsWith('<?xml?>', pos))) {
    declarationAttrs = parseXmlDeclaration(declarationPath);
  }

  const documentChildren = [];
  let hasRootElement = false;
  while (pos < len) {
    skipWhitespace();
    if (pos >= len) break;
    const childPath = `${rootPath}[${documentChildren.length}]`;
    if (startsWith('<!--') || startsWith('<?')) {
      checkChildCount(documentChildren.length + 1, rootPath, currentLoc());
      documentChildren.push(readMiscNode(childPath, 2));
      continue;
    }
    if (startsWith('<!')) {
      fail('DTD declarations are forbidden', 'XML_DTD_FORBIDDEN', rootPath);
    }
    if (!hasRootElement && input[pos] === '<' && !startsWith('</')) {
      checkChildCount(documentChildren.length + 1, rootPath, currentLoc());
      documentChildren.push(parseElement(childPath, 2));
      hasRootElement = true;
      continue;
    }
    if (!hasRootElement) {
      fail('Expected root element start tag', 'XML_EXPECTED_ROOT_ELEMENT', rootPath);
    }
    if (input[pos] === '<') fail('Multiple root elements are not allowed in an XML document', 'XML_MULTIPLE_ROOTS', rootPath);
    fail('Unexpected character data after root element', 'XML_TRAILING_CONTENT', rootPath);
  }
  if (!hasRootElement) fail('XML document must contain a root element', 'XML_EMPTY_DOCUMENT', rootPath);

  // --- Emit portable AES records in canonical depth-first preorder ---
  const records = [];

  function checkPathLimits(path, pathDepth, loc) {
    if (pathDepth > limits.maxPathDepth) {
      fail(
        `AES path depth exceeds max_path_depth (${pathDepth} > ${limits.maxPathDepth})`,
        'XML_LIMIT_EXCEEDED',
        path,
        loc,
        {
          counter: 'max_path_depth',
          observed: pathDepth,
          limit: limits.maxPathDepth,
        },
      );
    }
    const pathChars = countCodepoints(path);
    if (pathChars > limits.maxPathCharacters) {
      fail(
        `AES path length exceeds max_path_characters (${pathChars} > ${limits.maxPathCharacters})`,
        'XML_LIMIT_EXCEEDED',
        path,
        loc,
        {
          counter: 'max_path_characters',
          observed: pathChars,
          limit: limits.maxPathCharacters,
        },
      );
    }
  }

  function checkKeyLimit(key, path, loc) {
    const keyCps = countCodepoints(key);
    if (keyCps > limits.maxKeySegmentCodepoints) {
      fail(
        `Key segment exceeds max_key_segment_codepoints (${keyCps} > ${limits.maxKeySegmentCodepoints})`,
        'XML_LIMIT_EXCEEDED',
        path,
        loc,
        {
          counter: 'max_key_segment_codepoints',
          observed: keyCps,
          limit: limits.maxKeySegmentCodepoints,
        },
      );
    }
  }

  function checkStringLimit(str, path, loc) {
    const cps = countCodepoints(str);
    if (cps > limits.maxStringCodepoints) {
      fail(
        `String value exceeds max_string_codepoints (${cps} > ${limits.maxStringCodepoints})`,
        'XML_LIMIT_EXCEEDED',
        path,
        loc,
        {
          counter: 'max_string_codepoints',
          observed: cps,
          limit: limits.maxStringCodepoints,
        },
      );
    }
  }

  function emitRecord(rec, pathDepth, loc) {
    if (records.length + 1 > limits.maxEvents) {
      fail(
        `AES event count exceeds max_events (${records.length + 1} > ${limits.maxEvents})`,
        'XML_LIMIT_EXCEEDED',
        rec.path,
        loc,
        {
          counter: 'max_events',
          observed: records.length + 1,
          limit: limits.maxEvents,
        },
      );
    }
    checkPathLimits(rec.path, pathDepth, loc);
    if (rec.value !== undefined) {
      checkStringLimit(rec.value, rec.path, loc);
    }
    records.push(rec);
  }

  function emitNode(tag, path, depth, loc) {
    checkKeyLimit(tag, path, loc);
    emitRecord({ path, kind: 'NodeLiteral', tag }, depth, loc);
  }

  function emitAttribute(name, value, ownerPath, depth, loc, kind = 'StringLiteral') {
    const path = formatAttributePath(ownerPath, name);
    checkKeyLimit(name, path, loc);
    emitRecord({ path, kind, value }, depth, loc);
  }

  function checkChildCount(count, path, loc) {
    if (count > limits.maxNodeChildren) {
      fail(`XML node child count exceeds max_node_children (${count} > ${limits.maxNodeChildren})`,
        'XML_LIMIT_EXCEEDED', path, loc, {
          counter: 'max_node_children', observed: count, limit: limits.maxNodeChildren,
        });
    }
  }

  function emitElement(elem, nodePath, nodePathDepth, inheritedPreserveWs) {
    emitNode(elem.tagName, nodePath, nodePathDepth, elem.loc);

    let localPreserveWs = inheritedPreserveWs;
    for (const attr of elem.attributes) {
      if (attr.name === 'xml:space') {
        if (attr.value === 'preserve') localPreserveWs = true;
        else if (attr.value === 'default') localPreserveWs = preserveWhitespaceOption;
      }
      emitAttribute(attr.name, attr.value, nodePath, nodePathDepth + 1, attr.loc);
    }

    const normalizedChildren = [];
    for (const item of elem.children) {
      if (item.type === 'element' || !elem.hasElementChildren || localPreserveWs
        || item.hasCdata || item.hasNonWsCharRef) {
        normalizedChildren.push(item);
      } else if (!isAllXmlWhitespace(item.value)) {
        const cleaned = normalizeInterElementMixedText(item.value);
        if (cleaned.length > 0) normalizedChildren.push({ ...item, value: cleaned });
      }
    }
    checkChildCount(normalizedChildren.length, nodePath, elem.loc);

    for (let i = 0; i < normalizedChildren.length; i += 1) {
      const child = normalizedChildren[i];
      const childPath = `${nodePath}[${i}]`;
      const childDepth = nodePathDepth + 1;
      if (child.type === 'text') {
        emitRecord(
          { path: childPath, kind: 'StringLiteral', ...(child.isCdata ? {datatype: 'cdata'} : {}), value: child.value },
          childDepth,
          child.loc,
        );
      } else {
        emitElement(child.element, childPath, childDepth, localPreserveWs);
      }
    }
  }

  if (declarationAttrs !== null && includeDeclarationMetadata) {
    emitNode(XML_DECLARATION_TAG, declarationPath, 1, documentLoc);
    for (const [name, attr] of declarationAttrs) {
      emitAttribute(name, attr.value, declarationPath, 2, attr.loc);
    }
  }
  emitNode(rootName, rootPath, 1, documentLoc);
  if (options.mapping !== 'native' && options.sourceMetadata !== false) {
    emitAttribute('source', 'XML', rootPath, 2, documentLoc, 'SymbolicLiteral');
  }
  for (const [index, child] of documentChildren.entries()) {
    emitElement(child, `${rootPath}[${index}]`, 2, preserveWhitespaceOption);
  }

  return records;
}

/**
 * Converts an XML 1.0 document string directly into a canonical `telex.aes=1` stream.
 *
 * @param {string} input
 * @param {Parameters<typeof xmlToAes>[1]} [options]
 * @returns {string}
 */
export function xmlToTelex(input, options = {}) {
  return formatTelex(xmlToAes(input, options));
}

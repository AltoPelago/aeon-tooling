/**
 * Minimal canonical Telex v1 encoder for the records produced by `tomlToAes`.
 *
 * TOML-derived records carry `path`, `kind`, optional `datatype` + `generics`
 * + `clarifiers` (for `radix[2]`, `radix[8]`, `radix[16]`), and optional
 * `value`. Fields are emitted in canonical Telex order (`path`, `kind`,
 * `datatype`, `value`).
 */

const VERSION_LINE = 'telex.aes=1';
const ALLOWED_FIELDS = new Set(['path', 'kind', 'datatype', 'generics', 'clarifiers', 'value']);

/**
 * @param {readonly import('./index.js').TomlAesRecord[]} records
 * @returns {string}
 */
export function encodeTelex(records) {
  if (!Array.isArray(records)) throw new TypeError('Telex records must be an array');
  if (records.length === 0) return `${VERSION_LINE}\n`;
  const stanzas = records.map((record, index) => {
    for (const field of Object.keys(record)) {
      if (!ALLOWED_FIELDS.has(field)) {
        throw new TypeError(`Record ${index + 1} has unsupported field: ${field}`);
      }
    }
    let stanza = `path=${encodePayload(record.path)}\nkind=${encodePayload(record.kind)}`;
    if (record.datatype !== undefined) {
      stanza += `\ndatatype=${encodePayload(formatDatatype(record))}`;
    }
    if (record.value !== undefined) {
      stanza += `\nvalue=${encodePayload(record.value)}`;
    }
    return stanza;
  });
  return `${VERSION_LINE}\n\n${stanzas.join('\n\n')}\n`;
}

function formatDatatype(record) {
  const { datatype, generics = [], clarifiers = [] } = record;
  if (typeof datatype !== 'string' || datatype.length === 0) {
    throw new TypeError('Record datatype must be a non-empty string');
  }
  const genText = generics.length > 0
    ? `<${generics.map(formatDatatype).join(', ')}>`
    : '';
  const clarText = clarifiers.length > 0
    ? `[${clarifiers.map((c) => (c.kind === 'StringLiteral' ? JSON.stringify(c.value) : c.value)).join(', ')}]`
    : '';
  return `${datatype}${genText}${clarText}`;
}

/** Telex v1 payload escaping (identical to the AES reference codec). */
function encodePayload(payload) {
  if (typeof payload !== 'string') throw new TypeError('Telex payloads must be strings');
  let encoded = '';
  for (const character of payload) {
    const scalar = character.codePointAt(0);
    if (scalar >= 0xd800 && scalar <= 0xdfff) {
      throw new TypeError('Telex payloads must contain Unicode scalar values');
    }
    switch (character) {
      case '\\': encoded += '\\\\'; break;
      case '\n': encoded += '\\n'; break;
      case '\r': encoded += '\\r'; break;
      case '\t': encoded += '\\t'; break;
      case '\0': encoded += '\\0'; break;
      default:
        encoded += scalar < 0x20 || scalar === 0x7f
          ? `\\u{${scalar.toString(16).toUpperCase()}}`
          : character;
    }
  }
  return encoded;
}

/**
 * Canonical `telex.aes` v1 encoder for portable AES event arrays emitted by
 * `@altopelago/xml-core`.
 */

const BARE_MEMBER_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export const TELEX_VERSION_LINE = 'telex.aes=1';

/**
 * Formats an attribute segment `.@.<key>` or `.@.["<escaped>"]` onto `basePath`.
 *
 * @param {string} basePath
 * @param {string} key
 * @returns {string}
 */
export function formatAttributePath(basePath, key) {
  if (BARE_MEMBER_KEY.test(key)) {
    return `${basePath}.@.${key}`;
  }
  return `${basePath}.@.[${escapeQuotedPathKey(key)}]`;
}

/**
 * Formats a root member segment `$.<key>` or `$.["<escaped>"]`.
 *
 * @param {string} key
 * @returns {string}
 */
export function formatRootMemberPath(key) {
  if (BARE_MEMBER_KEY.test(key)) {
    return `$.${key}`;
  }
  return `$.[${escapeQuotedPathKey(key)}]`;
}

/**
 * Escapes a quoted SANSA path member/attribute key according to `aes.events.md` §5.2.
 *
 * @param {string} key
 * @returns {string}
 */
export function escapeQuotedPathKey(key) {
  let out = '"';
  for (let i = 0; i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    if (code === 0x22) {
      out += '\\"';
    } else if (code === 0x5c) {
      out += '\\\\';
    } else if (code === 0x08) {
      out += '\\b';
    } else if (code === 0x09) {
      out += '\\t';
    } else if (code === 0x0a) {
      out += '\\n';
    } else if (code === 0x0c) {
      out += '\\f';
    } else if (code === 0x0d) {
      out += '\\r';
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += key[i];
    }
  }
  out += '"';
  return out;
}

/**
 * Encodes a Telex field payload according to `telex.aes.md` §7.
 *
 * @param {string} value
 * @returns {string}
 */
export function encodeTelexPayload(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) {
        throw new Error('Lone high surrogate in Telex payload');
      }
      out += value[i] + value[i + 1];
      i += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error('Lone low surrogate in Telex payload');
    }
    if (code === 0x5c) {
      out += '\\\\';
    } else if (code === 0x0a) {
      out += '\\n';
    } else if (code === 0x0d) {
      out += '\\r';
    } else if (code === 0x09) {
      out += '\\t';
    } else if (code === 0) {
      out += '\\0';
    } else if (code < 0x20 || code === 0x7f) {
      out += `\\u{${code.toString(16).toUpperCase()}}`;
    } else {
      out += value[i];
    }
  }
  return out;
}

/**
 * Formats an array of portable AES event records into a canonical `telex.aes=1` text stream.
 *
 * @param {Array<{path: string, kind: string, tag?: string, datatype?: string, value?: string}>} records
 * @returns {string}
 */
export function formatTelex(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('records must be an array of AES event objects');
  }
  if (records.length === 0) {
    return `${TELEX_VERSION_LINE}\n`;
  }
  const blocks = [TELEX_VERSION_LINE, ''];
  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i];
    const lines = [
      `path=${encodeTelexPayload(rec.path)}`,
      `kind=${encodeTelexPayload(rec.kind)}`,
    ];
    if (rec.tag !== undefined) {
      lines.push(`tag=${encodeTelexPayload(rec.tag)}`);
    }
    if (rec.datatype !== undefined) {
      lines.push(`datatype=${encodeTelexPayload(rec.datatype)}`);
    }
    if (rec.value !== undefined) {
      lines.push(`value=${encodeTelexPayload(rec.value)}`);
    }
    blocks.push(lines.join('\n'));
    if (i + 1 < records.length) {
      blocks.push('');
    }
  }
  return `${blocks.join('\n')}\n`;
}

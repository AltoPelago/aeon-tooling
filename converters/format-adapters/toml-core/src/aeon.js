/**
 * Converts portable AES (`aes.events.v1`) records into canonical AEON source
 * text matching `@altopelago/aeon-canonical` (`reference-safe-v1`).
 */

const BARE_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const RESERVED_NULL_REASONS = new Set(['none', 'notSet', 'notApplicable', 'tombstone']);

const CANONICAL_HEADER_LINES = [
  'aeon:header = {',
  '  encoding = "utf-8"',
  '  mode = "transport"',
  '  profile = "core"',
  '  version = "1.0"',
  '}',
];

/**
 * Compares two strings by Unicode scalar (code point) order, matching
 * `compareScalarKeys` in `@altopelago/aeon-canonical`.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareScalarKeys(left, right) {
  const a = left[Symbol.iterator]();
  const b = right[Symbol.iterator]();
  for (;;) {
    const x = a.next();
    const y = b.next();
    if (x.done || y.done) return x.done ? (y.done ? 0 : -1) : 1;
    const diff = x.value.codePointAt(0) - y.value.codePointAt(0);
    if (diff !== 0) return diff;
  }
}

/**
 * Parses a canonical SANSA path (`$.a.["b"][0].@.c`) into structural segments.
 *
 * @param {string} path
 * @returns {Array<{type: 'member' | 'attr', key: string} | {type: 'index', index: number}>}
 */
export function parseAesPath(path) {
  if (typeof path !== 'string' || !path.startsWith('$')) {
    throw new Error(`Invalid AES path: ${path}`);
  }
  const segments = [];
  let i = 1;
  const len = path.length;

  while (i < len) {
    if (path.startsWith('.@.', i)) {
      i += 3;
      if (path[i] === '[') {
        const closeIdx = findClosingBracket(path, i);
        const key = JSON.parse(path.slice(i + 1, closeIdx));
        segments.push({ type: 'attr', key });
        i = closeIdx + 1;
      } else {
        const start = i;
        while (i < len && path[i] !== '.' && path[i] !== '[') i += 1;
        segments.push({ type: 'attr', key: path.slice(start, i) });
      }
      continue;
    }

    if (path[i] === '.') {
      i += 1;
      if (path[i] === '[') {
        const closeIdx = findClosingBracket(path, i);
        const key = JSON.parse(path.slice(i + 1, closeIdx));
        segments.push({ type: 'member', key });
        i = closeIdx + 1;
      } else {
        const start = i;
        while (i < len && path[i] !== '.' && path[i] !== '[') i += 1;
        segments.push({ type: 'member', key: path.slice(start, i) });
      }
      continue;
    }

    if (path[i] === '[') {
      const closeIdx = path.indexOf(']', i);
      if (closeIdx === -1) throw new Error(`Unterminated index segment in path: ${path}`);
      const digits = path.slice(i + 1, closeIdx);
      const idx = Number(digits);
      if (!/^(0|[1-9][0-9]*)$/u.test(digits) || !Number.isSafeInteger(idx)) {
        throw new Error(`Invalid index segment in path: ${path}`);
      }
      segments.push({ type: 'index', index: idx });
      i = closeIdx + 1;
      continue;
    }

    throw new Error(`Unexpected path character '${path[i]}' in path: ${path}`);
  }

  return segments;
}

function findClosingBracket(path, openBracketIdx) {
  let i = openBracketIdx + 1;
  if (path[i] !== '"') throw new Error(`Expected quoted key at index ${i} in path: ${path}`);
  i += 1;
  while (i < path.length) {
    if (path[i] === '\\') {
      i += 2;
      continue;
    }
    if (path[i] === '"') {
      if (path[i + 1] !== ']') {
        throw new Error(`Expected closing ']' after quoted key in path: ${path}`);
      }
      return i + 1;
    }
    i += 1;
  }
  throw new Error(`Unterminated quoted key in path: ${path}`);
}

function createTreeEntry(record, segment) {
  if (!isSimpleEntry(record) && !['ObjectNode', 'ListNode', 'NodeLiteral'].includes(record.kind)) {
    throw new Error(`Unsupported AES kind in AEON renderer: ${record.kind} at ${record.path}`);
  }
  if (record.kind === 'NodeLiteral') {
    if (typeof record.tag !== 'string' || !record.tag || /[\uD800-\uDFFF]/u.test(record.tag)
      || (segment.type !== 'index' && segment.key !== record.tag) || record.value !== undefined) {
      throw new Error(`Invalid intrinsic node record at ${record.path}`);
    }
  } else if (record.tag !== undefined) {
    throw new Error(`Unexpected intrinsic tag at ${record.path}`);
  }
  if (record.identity !== undefined && (typeof record.identity !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(record.identity))) {
    throw new Error(`Invalid structural identity at ${record.path}`);
  }
  if (record.generics?.length) {
    throw new Error(`The AEON renderer cannot preserve generic datatypes at ${record.path}`);
  }

  let datatype = record.datatype ?? null;
  if (datatype && record.clarifiers?.length && !datatype.includes('[')) {
    const clarifiers = record.clarifiers.map(({kind, value}) => kind === 'StringLiteral' ? formatString(value) : value);
    datatype = `${datatype}[${clarifiers.join(', ')}]`;
  }
  return {
    kind: record.kind,
    datatype,
    value: record.value,
    tag: record.tag,
    identity: record.identity,
    attributes: new Map(),
    bindings: record.kind === 'ObjectNode' ? new Map() : null,
    elements: record.kind === 'ListNode' || record.kind === 'NodeLiteral' ? [] : null,
  };
}

/** Reconstructs the document body from preorder portable AES records. */
function buildTreeFromAes(records) {
  const root = {bindings: new Map()};
  const identities = new Set();

  for (const record of records) {
    const segments = parseAesPath(record.path);
    if (segments[0]?.type !== 'member') {
      throw new Error(`Top-level segment must be a member: ${record.path}`);
    }

    let parent = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      parent = segment.type === 'member' ? parent.bindings?.get(segment.key)
        : segment.type === 'attr' ? parent.attributes?.get(segment.key)
          : parent.elements?.[segment.index];
      if (!parent) throw new Error(`Missing parent for path: ${record.path}`);
    }

    const last = segments.at(-1);
    const entry = createTreeEntry(record, last);
    if (entry.identity !== undefined) {
      if (identities.has(entry.identity)) throw new Error(`Duplicate structural identity at ${record.path}`);
      identities.add(entry.identity);
    }
    if (last.type === 'index') {
      if (!parent.elements || last.index !== parent.elements.length) {
        throw new Error(`Invalid or out-of-order child at ${record.path}`);
      }
      parent.elements.push(entry);
    } else {
      const members = last.type === 'member' ? parent.bindings : parent.attributes;
      if (!members || members.has(last.key)) throw new Error(`Invalid or duplicate record at ${record.path}`);
      members.set(last.key, entry);
    }
  }

  return root.bindings;
}

function formatString(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    switch (ch) {
      case '"':
        out += '\\"';
        break;
      case '\\':
        out += '\\\\';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      default: {
        const code = ch.charCodeAt(0);
        if (code < 0x20) {
          out += `\\u${code.toString(16).padStart(4, '0')}`;
        } else {
          out += ch;
        }
        break;
      }
    }
  }
  return `"${out}"`;
}

function formatKey(key, hasDatatype, hasAttributes) {
  if (key === 'aeon' && hasDatatype && !hasAttributes) {
    return formatString(key);
  }
  return BARE_KEY.test(key) ? key : formatString(key);
}

function formatDatatype(datatype) {
  return datatype ? `:${datatype}` : '';
}

function isSimpleEntry(entry) {
  switch (entry.kind) {
    case 'StringLiteral':
    case 'NumberLiteral':
    case 'InfinityLiteral':
    case 'NaNLiteral':
    case 'NullLiteral':
    case 'BooleanLiteral':
    case 'ToggleLiteral':
    case 'HexLiteral':
    case 'RadixLiteral':
    case 'EncodingLiteral':
    case 'SeparatorLiteral':
    case 'SymbolicLiteral':
    case 'SansaAddressLiteral':
    case 'DateLiteral':
    case 'TimeLiteral':
    case 'DateTimeLiteral':
    case 'WTCDateTimeLiteral':
      return true;
    default:
      return false;
  }
}

function renderScalar(entry) {
  switch (entry.kind) {
    case 'StringLiteral':
      return formatString(entry.value);
    case 'NumberLiteral':
    case 'InfinityLiteral':
    case 'NaNLiteral':
    case 'BooleanLiteral':
    case 'ToggleLiteral':
    case 'DateLiteral':
    case 'TimeLiteral':
    case 'DateTimeLiteral':
    case 'WTCDateTimeLiteral':
    case 'SansaAddressLiteral':
      return entry.value;
    case 'EncodingLiteral':
      return `&${entry.value}`;
    case 'SeparatorLiteral':
      return entry.value.startsWith('^') ? entry.value : `^${entry.value}`;
    case 'SymbolicLiteral':
      return `|${formatString(entry.value).slice(1, -1).replaceAll('\\"', '"').replaceAll('|', '\\|')}|`;
    case 'NullLiteral':
      return `!${RESERVED_NULL_REASONS.has(entry.value) ? entry.value : formatString(entry.value)}`;
    case 'RadixLiteral':
      return `%${entry.value}`;
    case 'HexLiteral':
      return `#${entry.value.toLowerCase()}`;
    default:
      throw new Error(`Unsupported AES kind in AEON renderer: ${entry.kind}`);
  }
}

function renderAttributes(attrMap, sortKeys) {
  if (!attrMap || attrMap.size === 0) return '';
  const entries = Array.from(attrMap.entries());
  if (sortKeys) {
    entries.sort(([a], [b]) => compareScalarKeys(a, b));
  }
  const parts = entries.map(([key, entry]) => renderBinding(key, entry, 0, sortKeys).join('\n'));
  return `@{${parts.join(', ')}}`;
}

function renderBinding(key, entry, indent, sortKeys) {
  const prefix = ' '.repeat(indent);
  if (entry.kind === 'NodeLiteral') {
    const lines = renderNodeValue(entry, indent, {inlineOnly: true}, sortKeys);
    if (lines.length === 1) lines[0] = prefix + lines[0];
    return lines;
  }

  const head = formatKey(key, Boolean(entry.datatype), entry.attributes.size > 0) + renderMetadata(entry, sortKeys);

  if (entry.kind === 'ObjectNode') {
    const lines = [`${prefix}${head} = {`];
    const children = Array.from(entry.bindings.entries());
    if (sortKeys) {
      children.sort(([a], [b]) => compareScalarKeys(a, b));
    }
    for (const [childKey, childEntry] of children) {
      for (const line of renderBinding(childKey, childEntry, indent + 2, sortKeys)) lines.push(line);
    }
    lines.push(`${prefix}}`);
    return lines;
  }

  if (entry.kind === 'ListNode') {
    const elements = entry.elements;
    if (elements.every(isSimpleEntry)) {
      const rendered = elements
        .map((el) => renderValue(el, indent + 1, { inlineOnly: true }, sortKeys)[0])
        .join(', ');
      return [`${prefix}${head} = [${rendered}]`];
    }
    const lines = [`${prefix}${head} = [`];
    elements.forEach((el, idx) => {
      const itemLines = renderValue(el, indent + 2, { inlineOnly: false }, sortKeys);
      if (itemLines.length > 0 && !itemLines[0].startsWith(' '.repeat(indent + 2))) {
        itemLines[0] = `${' '.repeat(indent + 2)}${itemLines[0]}`;
      }
      if (idx < elements.length - 1 && itemLines.length > 0) {
        itemLines[itemLines.length - 1] = `${itemLines[itemLines.length - 1]},`;
      }
      for (const line of itemLines) lines.push(line);
    });
    lines.push(`${prefix}]`);
    return lines;
  }

  return [`${prefix}${head} = ${renderScalar(entry)}`];
}

function renderMetadata(entry, sortKeys) {
  const identity = entry.identity === undefined ? '' : `\\${entry.identity}\\`;
  return identity + renderAttributes(entry.attributes, sortKeys) + formatDatatype(entry.datatype);
}

function renderValue(entry, indent, opts, sortKeys) {
  if (entry.kind === 'NodeLiteral') return renderNodeValue(entry, indent, opts, sortKeys);

  const prefix = ' '.repeat(indent);
  const metadata = renderMetadata(entry, sortKeys);
  const head = metadata ? `${metadata} = ` : '';

  if (entry.kind === 'ObjectNode') {
    const lines = [`${prefix}${head}{`];
    const children = Array.from(entry.bindings.entries());
    if (sortKeys) {
      children.sort(([a], [b]) => compareScalarKeys(a, b));
    }
    for (const [childKey, childEntry] of children) {
      for (const line of renderBinding(childKey, childEntry, indent + 2, sortKeys)) lines.push(line);
    }
    lines.push(`${prefix}}`.trimEnd());
    return lines;
  }

  if (entry.kind === 'ListNode') {
    const elements = entry.elements;
    if (opts.inlineOnly && elements.every(isSimpleEntry)) {
      const rendered = elements
        .map((el) => renderValue(el, indent + 1, { inlineOnly: true }, sortKeys)[0])
        .join(', ');
      return [`${head}[${rendered}]`];
    }
    const lines = [`${prefix}${head}[`];
    elements.forEach((el, idx) => {
      const itemLines = renderValue(el, indent + 2, { inlineOnly: false }, sortKeys);
      if (itemLines.length > 0 && !itemLines[0].startsWith(' '.repeat(indent + 2))) {
        itemLines[0] = `${' '.repeat(indent + 2)}${itemLines[0]}`;
      }
      if (idx < elements.length - 1 && itemLines.length > 0) {
        itemLines[itemLines.length - 1] = `${itemLines[itemLines.length - 1]},`;
      }
      for (const line of itemLines) lines.push(line);
    });
    lines.push(`${prefix}]`.trimEnd());
    return lines;
  }

  return [head + renderScalar(entry)];
}

function renderNodeValue(entry, indent, opts, sortKeys) {
  const prefix = ' '.repeat(indent);
  const tag = formatKey(entry.tag, Boolean(entry.datatype), entry.attributes.size > 0);
  const head = `<${tag}${renderMetadata(entry, sortKeys)}`;
  const children = entry.elements;

  if (children.length === 0) {
    return [`${head}>`];
  }

  if (opts.inlineOnly && children.every(isSimpleEntry)) {
    const rendered = children
      .map((child) => renderValue(child, indent + 1, { inlineOnly: true }, sortKeys)[0])
      .join(', ');
    return [`${head}(${rendered})>`];
  }

  const lines = [`${prefix}${head}(`.trimEnd()];
  children.forEach((child, idx) => {
    const itemLines = renderValue(child, indent + 2, { inlineOnly: true }, sortKeys);
    if (itemLines.length > 0 && !itemLines[0].startsWith(' '.repeat(indent + 2))) {
      itemLines[0] = `${' '.repeat(indent + 2)}${itemLines[0]}`;
    }
    if (idx < children.length - 1 && itemLines.length > 0) {
      itemLines[itemLines.length - 1] = `${itemLines[itemLines.length - 1]},`;
    }
    for (const line of itemLines) lines.push(line);
  });
  lines.push(`${prefix})>`.trimEnd());
  return lines;
}

/**
 * Renders portable AES records into canonical AEON source text.
 *
 * @param {Array<{path: string, kind: string, tag?: string, identity?: string, datatype?: string, value?: string}>} records Valid preorder portable body records.
 * @param {{ includeHeader?: boolean, sortKeys?: boolean }} [options]
 * @returns {string}
 */
export function aesToAeon(records, options = {}) {
  const includeHeader = options.includeHeader !== false;
  const sortKeys = options.sortKeys !== false;
  const rootBindings = buildTreeFromAes(records);

  const lines = [];
  if (includeHeader) {
    lines.push(...CANONICAL_HEADER_LINES);
  }

  const entries = Array.from(rootBindings.entries());
  if (sortKeys) {
    entries.sort(([a], [b]) => compareScalarKeys(a, b));
  }

  for (const [key, entry] of entries) {
    for (const line of renderBinding(key, entry, 0, sortKeys)) lines.push(line);
  }

  return `${lines.join('\n')}\n`;
}

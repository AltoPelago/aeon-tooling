/**
 * Converts portable AES (`aes.events.v1`) records into canonical AEON source
 * text matching `@altopelago/aeon-canonical` (`reference-safe-v1`).
 */

const BARE_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

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
      const idx = Number.parseInt(path.slice(i + 1, closeIdx), 10);
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

function createTreeEntry(record) {
  let dt = record.datatype ?? null;
  if (dt && Array.isArray(record.clarifiers) && record.clarifiers.length > 0 && !dt.includes('[')) {
    const clar = record.clarifiers.map((c) => c.value).join(', ');
    dt = `${dt}[${clar}]`;
  }
  return {
    kind: record.kind,
    datatype: dt,
    value: record.value,
    attributes: new Map(),
    bindings: record.kind === 'ObjectNode' ? new Map() : null,
    elements: record.kind === 'ListNode' ? [] : null,
    nodeHead: null,
  };
}

/**
 * Reconstructs a hierarchical document tree from portable AES records.
 *
 * @param {Array<{path: string, kind: string, datatype?: string, value?: string}>} records
 */
function buildTreeFromAes(records, comments = new Map()) {
  const rootBindings = new Map();
  const makeEntry = record => ({ ...createTreeEntry(record), semanticComment: comments.get(record.path) });

  for (const record of records) {
    const segments = parseAesPath(record.path);
    if (segments.length === 0) {
      throw new Error('Root path $ cannot be an event record');
    }

    if (segments.length === 1) {
      const seg = segments[0];
      if (seg.type !== 'member') {
        throw new Error(`Top-level segment must be a member: ${record.path}`);
      }
      rootBindings.set(seg.key, makeEntry(record));
      continue;
    }

    // Navigate to the parent target
    let current = rootBindings.get(segments[0].key);
    if (!current) {
      throw new Error(`Missing root parent for path: ${record.path}`);
    }

    for (let s = 1; s < segments.length - 1; s += 1) {
      const seg = segments[s];
      if (seg.type === 'member') {
        current = current.bindings.get(seg.key);
      } else if (seg.type === 'attr') {
        if (current.kind === 'NodeHead') {
          current = current.attributes.get(seg.key);
        } else {
          current = current.attributes.get(seg.key);
        }
      } else if (seg.type === 'index') {
        if (current.kind === 'NodeLiteral') {
          if (seg.index !== 0 || !current.nodeHead) {
            throw new Error(`Missing NodeHead at ${record.path}`);
          }
          current = current.nodeHead;
        } else if (current.kind === 'NodeHead') {
          current = current.children[seg.index];
        } else {
          current = current.elements[seg.index];
        }
      }
      if (!current) {
        throw new Error(`Missing intermediate parent for path: ${record.path}`);
      }
    }

    const last = segments[segments.length - 1];
    if (last.type === 'member') {
      current.bindings.set(last.key, makeEntry(record));
    } else if (last.type === 'attr') {
      current.attributes.set(last.key, makeEntry(record));
    } else if (last.type === 'index') {
      if (current.kind === 'NodeLiteral') {
        if (record.kind !== 'NodeHead' || last.index !== 0) {
          throw new Error(`Expected NodeHead at index 0 of NodeLiteral: ${record.path}`);
        }
        current.nodeHead = {
          kind: 'NodeHead',
          tag: record.value,
          datatype: record.datatype ?? null,
          attributes: new Map(),
          children: [],
        };
      } else if (current.kind === 'NodeHead') {
        current.children[last.index] = makeEntry(record);
      } else {
        current.elements[last.index] = makeEntry(record);
      }
    }
  }

  return rootBindings;
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
  const text = renderScalarValue(entry);
  return entry.semanticComment ? `${entry.semanticComment} ${text}` : text;
}

function renderScalarValue(entry) {
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
      return entry.value === 'none' ? '!none' : `!${formatString(entry.value)}`;
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
  const parts = entries.map(([key, valEntry]) => {
    const nestedAttrs = renderAttributes(valEntry.attributes, sortKeys);
    const dt = formatDatatype(valEntry.datatype);
    const formattedKey = formatKey(key, Boolean(valEntry.datatype), valEntry.attributes.size > 0);
    return `${formattedKey}${nestedAttrs}${dt} = ${renderScalar(valEntry)}`;
  });
  return `@{${parts.join(', ')}}`;
}

function renderBinding(key, entry, indent, sortKeys) {
  const prefix = ' '.repeat(indent);
  const attrs = renderAttributes(entry.attributes, sortKeys);
  const dt = formatDatatype(entry.datatype);
  const head = `${formatKey(key, Boolean(entry.datatype), entry.attributes.size > 0)}${attrs}${dt}`;

  if (entry.kind === 'ObjectNode') {
    const lines = [`${prefix}${head} = {`];
    const children = Array.from(entry.bindings.entries());
    if (sortKeys) {
      children.sort(([a], [b]) => compareScalarKeys(a, b));
    }
    for (const [childKey, childEntry] of children) {
      lines.push(...renderBinding(childKey, childEntry, indent + 2, sortKeys));
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
      lines.push(...itemLines);
    });
    lines.push(`${prefix}]`);
    return lines;
  }

  if (entry.kind === 'NodeLiteral') {
    const renderedNode = renderNodeValue(entry, indent, { inlineOnly: false }, sortKeys);
    if (renderedNode.length === 1) {
      return [`${prefix}${head} = ${renderedNode[0].trimStart()}`];
    }
    const [first, ...rest] = renderedNode;
    return [`${prefix}${head} = ${first.trimStart()}`, ...rest];
  }

  return [`${prefix}${head} = ${renderScalar(entry)}`];
}

function renderValue(entry, indent, opts, sortKeys) {
  const prefix = ' '.repeat(indent);

  if (entry.kind === 'ObjectNode') {
    const lines = [`${prefix}{`.trimEnd()];
    const children = Array.from(entry.bindings.entries());
    if (sortKeys) {
      children.sort(([a], [b]) => compareScalarKeys(a, b));
    }
    for (const [childKey, childEntry] of children) {
      lines.push(...renderBinding(childKey, childEntry, indent + 2, sortKeys));
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
      return [`[${rendered}]`];
    }
    const lines = [`${prefix}[`.trimEnd()];
    elements.forEach((el, idx) => {
      const itemLines = renderValue(el, indent + 2, { inlineOnly: false }, sortKeys);
      if (itemLines.length > 0 && !itemLines[0].startsWith(' '.repeat(indent + 2))) {
        itemLines[0] = `${' '.repeat(indent + 2)}${itemLines[0]}`;
      }
      if (idx < elements.length - 1 && itemLines.length > 0) {
        itemLines[itemLines.length - 1] = `${itemLines[itemLines.length - 1]},`;
      }
      lines.push(...itemLines);
    });
    lines.push(`${prefix}]`.trimEnd());
    return lines;
  }

  if (entry.kind === 'NodeLiteral') {
    return renderNodeValue(entry, indent, opts, sortKeys);
  }

  const anonymousHead = renderAttributes(entry.attributes, sortKeys) + formatDatatype(entry.datatype);
  return [anonymousHead ? `${anonymousHead} = ${renderScalar(entry)}` : renderScalar(entry)];
}

function renderNodeValue(entry, indent, opts, sortKeys) {
  const prefix = ' '.repeat(indent);
  const headInfo = entry.nodeHead;
  if (!headInfo) {
    throw new Error('NodeLiteral is missing its NodeHead child');
  }
  const formattedTag = formatKey(
    headInfo.tag,
    Boolean(headInfo.datatype),
    headInfo.attributes.size > 0,
  );
  const attrs = renderAttributes(headInfo.attributes, sortKeys);
  const dt = formatDatatype(headInfo.datatype);
  const head = `<${formattedTag}${attrs}${dt}`;
  const children = headInfo.children;

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
    lines.push(...itemLines);
  });
  lines.push(`${prefix})>`.trimEnd());
  return lines;
}

/**
 * Renders portable AES records into canonical AEON source text.
 *
 * @param {Array<{path: string, kind: string, datatype?: string, value?: string}>} records
 * Optional path-targeted block annotations produce annotated source, not bare canonical text.
 * @param {{ includeHeader?: boolean, sortKeys?: boolean, annotations?: Array<object> }} [options]
 * @returns {string}
 */
export function aesToAeon(records, options = {}) {
  const includeHeader = options.includeHeader !== false;
  const sortKeys = options.sortKeys !== false;
  const comments = new Map();
  const stringPaths = new Set(records.filter(record => record.kind === 'StringLiteral').map(record => record.path));
  if (options.annotations !== undefined && !Array.isArray(options.annotations)) throw new TypeError('annotations must be an array');
  for (const annotation of options.annotations ?? []) {
    const path = annotation?.target?.path;
    const raw = annotation?.raw;
    if (annotation?.kind !== 'annotation' || annotation.form !== 'block'
      || annotation.target?.kind !== 'path' || typeof raw !== 'string'
      || !raw.startsWith('/@') || !raw.endsWith('@/') || raw.slice(2, -2).includes('@/')
      || raw.slice(2, -2).includes('/@')
      || !stringPaths.has(path)) {
      throw new TypeError('Expected a safe block annotation targeting an existing string scalar');
    }
    comments.set(path, [comments.get(path), raw].filter(Boolean).join(' '));
  }
  const rootBindings = buildTreeFromAes(records, comments);

  const lines = [];
  if (includeHeader) {
    lines.push(...CANONICAL_HEADER_LINES);
  }

  const entries = Array.from(rootBindings.entries());
  if (sortKeys) {
    entries.sort(([a], [b]) => compareScalarKeys(a, b));
  }

  for (const [key, entry] of entries) {
    lines.push(...renderBinding(key, entry, 0, sortKeys));
  }

  return `${lines.join('\n')}\n`;
}

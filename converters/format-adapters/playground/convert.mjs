import { jsonToAes } from '../json-core/src/index.js';
import { tomlToAes } from '../toml-core/src/index.js';
import { isTomlIntegerInRange } from '../toml-core/src/number.js';
import { quoteTomlString } from '../toml-core/src/string.js';
import { aesToAeon as xmlAesToAeon, xmlToAes } from '../xml-core/src/index.js';
import { isXmlName, XML_COMMENT_TAG, XML_DECLARATION_TAG, XML_DOCUMENT_TAG } from '../xml-core/src/xml-aes.js';
import { alogToAes } from '../alog-core/src/index.js';
import { yamlToAes, yamlToAesWithAnnotations } from '../yaml-core/src/index.js';
import { aesToAeon, parseAesPath } from '../json-core/src/aeon.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const formats = ['aeon', 'json', 'xml', 'toml', 'yaml', 'alog'];
const imports = { json: jsonToAes, toml: tomlToAes, xml: xmlToAes, yaml: yamlToAes, alog: alogToAes };
export class ConversionError extends Error {
  constructor(message, path, code = 'UNREPRESENTABLE') { super(message); this.name = 'ConversionError'; this.code = code; this.path = path; }
}
const reject = (node, message) => { throw new ConversionError(message, node.path); };

// The local runtime is explicit and overrideable; it is never served to browsers.
export async function loadCompiler() {
  const url = process.env.AEON_CORE_MODULE
    ? pathToFileURL(resolve(process.env.AEON_CORE_MODULE))
    : new URL('../../../../aeon/implementations/typescript/packages/core/dist/index.js', import.meta.url);
  try {
    const core = await import(url.href);
    const check = core.compileToTelex('"" = 1');
    if (check.compile.errors.length) throw new Error('Compiler lacks empty-key support');
    const nodes = core.compileToTelex('<xml(<element>)>');
    if (nodes.compile.errors.length || !nodes.records.some(record =>
      record.path === '$.xml[0]' && record.kind === 'NodeLiteral' && record.tag === 'element')) {
      throw new Error('Compiler lacks tagged-node support');
    }
    return core;
  } catch (error) {
    throw new Error(`An AEON compiler with empty-key and tagged-node support is required. Build the sibling aeon TypeScript packages or set AEON_CORE_MODULE to its built core/dist/index.js. ${error.message}`);
  }
}

// These are output-profile reservations, never AEON Core key restrictions.
// Keep this warning list aligned with aeon-finalize's JSON/node materializers.
const JSON_MATERIALIZER_KEYS = new Set(['@', '$', '$node', '$children', '__proto__', 'constructor', 'prototype']);
function materializerWarnings(records) {
  const collisions = new Map();
  for (const record of records) {
    const last = parseAesPath(record.path).at(-1);
    if (last?.type !== 'member' || !JSON_MATERIALIZER_KEYS.has(last.key)) continue;
    let entry = collisions.get(last.key);
    if (!entry) { entry = {key: last.key, paths: [], occurrences: 0}; collisions.set(last.key, entry); }
    entry.occurrences++;
    if (entry.paths.length < 5) entry.paths.push(record.path);
  }
  return [...collisions.values()].map(entry => ({
    ...entry,
    code: 'JSON_MATERIALIZER_RESERVED_KEY',
    message: `The member key ${JSON.stringify(entry.key)} is valid AEON, but the standard JSON/node materializers reject it. This source-format conversion preserves it; each materializer must enforce its own output and runtime restrictions.`,
  }));
}

function tree(records) {
  const root = { path: '$', kind: 'ObjectNode', members: new Map(), items: [], attrs: new Map() };
  const nodes = new Map([['$', root]]);
  for (const record of records) {
    const segments = parseAesPath(record.path);
    const last = segments.at(-1);
    // Parent paths are reconstructed from the actual parsed segments, so dots,
    // brackets and quotes inside keys never become hierarchy delimiters.
    let parent = root;
    for (const segment of segments.slice(0, -1)) {
      parent = segment.type === 'member' ? parent.members.get(segment.key)
        : segment.type === 'attr' ? parent.attrs.get(segment.key) : parent.items[segment.index];
      if (!parent) throw new ConversionError('Missing parent', record.path, 'INVALID_AES');
    }
    if (!last || nodes.has(record.path)) throw new ConversionError('Invalid or duplicate assignment', record.path, 'INVALID_AES');
    const node = { ...record, members: new Map(), items: [], attrs: new Map() };
    if (last.type === 'member') parent.members.set(last.key, node);
    else if (last.type === 'attr') parent.attrs.set(last.key, node);
    else parent.items[last.index] = node;
    nodes.set(record.path, node);
  }
  return root;
}
function plain(node, allowedAttrs = []) {
  if (node.datatype !== undefined) reject(node, 'Explicit datatypes cannot be preserved in this output profile.');
  for (const [key] of node.attrs) if (!allowedAttrs.includes(key)) reject(node, `Attribute ${JSON.stringify(key)} cannot be preserved in this output format.`);
}
function number(node, target = 'JSON') {
  // Portable NumberLiteral values can be arbitrary precision. Never use Number
  // or JSON.stringify on their payloads.
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(node.value)) reject(node, `This numeric value cannot be represented as a ${target} number.`);
  return node.value;
}
function json(node, depth = 0, target = 'JSON') {
  plain(node);
  const indent = '  '.repeat(depth), childIndent = indent + '  ';
  if (node.kind === 'ObjectNode') {
    if (!node.members.size) return '{}';
    return '{\n' + [...node.members].map(([k, v]) => `${childIndent}${JSON.stringify(k)}: ${json(v, depth + 1, target)}`).join(',\n') + `\n${indent}}`;
  }
  if (node.kind === 'ListNode') {
    if (!node.items.length) return '[]';
    return '[\n' + node.items.map(n => childIndent + json(n, depth + 1, target)).join(',\n') + `\n${indent}]`;
  }
  switch (node.kind) {
    case 'StringLiteral': return JSON.stringify(node.value);
    case 'NumberLiteral': return number(node, target);
    case 'BooleanLiteral': return node.value;
    case 'NullLiteral': if (node.value === 'none') return 'null'; break;
  }
  reject(node, `${node.kind} cannot be represented in ${target} without losing its meaning. Select lossy mode to export it as a string.`);
}
function yaml(node, depth = 0) {
  plain(node);
  const pad = '  '.repeat(depth);
  if (node.kind === 'ObjectNode' && node.members.size) {
    return [...node.members].map(([k, v]) => {
      if (k === '<<') reject(v, 'The merge key is outside the YAML adapter profile.');
      const nested = (v.kind === 'ObjectNode' && v.members.size) || (v.kind === 'ListNode' && v.items.length);
      return `${pad}${JSON.stringify(k)}:${nested ? '\n' + yaml(v, depth + 1) : ' ' + yaml(v, 0)}`;
    }).join('\n');
  }
  if (node.kind === 'ListNode' && node.items.length) {
    return node.items.map(v => {
      const nested = (v.kind === 'ObjectNode' && v.members.size) || (v.kind === 'ListNode' && v.items.length);
      return `${pad}-${nested ? '\n' + yaml(v, depth + 1) : ' ' + yaml(v, 0)}`;
    }).join('\n');
  }
  return json(node, 0, 'YAML');
}
function toml(node, resolveRadixBase) {
  if (node.kind === 'RadixLiteral') {
    if (node.attrs.size || node.generics?.length) reject(node, 'TOML radix integers cannot preserve extra attributes or generic datatype claims.');
    const base = resolveRadixBase(node);
    const spec = {2: ['0b', /^[01]+$/u], 8: ['0o', /^[0-7]+$/u], 16: ['0x', /^[0-9A-F]+$/u]}[base];
    const digits = node.value.replaceAll('_', '');
    if (!spec || !spec[1].test(digits)) reject(node, 'TOML radix export requires an explicit base 2, 8 or 16 and unsigned integer digits valid in the AEON radix alphabet.');
    const value = spec[0] + digits;
    if (!isTomlIntegerInRange(value)) reject(node, 'TOML integers must be between -9223372036854775808 and 9223372036854775807.');
    return value;
  }
  plain(node);
  if (node.kind === 'NumberLiteral' && /^-?\d+$/u.test(node.value) && !isTomlIntegerInRange(node.value)) {
    reject(node, 'TOML integers must be between -9223372036854775808 and 9223372036854775807.');
  }
  if (node.kind === 'ObjectNode') return '{ ' + [...node.members].map(([k, v]) => `${quoteTomlString(k)} = ${toml(v, resolveRadixBase)}`).join(', ') + ' }';
  if (node.kind === 'ListNode') return '[' + node.items.map(item => toml(item, resolveRadixBase)).join(', ') + ']';
  if (node.kind === 'StringLiteral') return quoteTomlString(node.value);
  if (['DateLiteral', 'TimeLiteral', 'DateTimeLiteral'].includes(node.kind)) return node.value;
  if (node.kind === 'InfinityLiteral') return node.value.startsWith('-') ? '-inf' : 'inf';
  if (node.kind === 'NaNLiteral') return 'nan';
  if (node.kind === 'NullLiteral') reject(node, 'TOML has no null value.');
  return json(node, 0, 'TOML');
}
const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\r', '&#13;').replaceAll('\n', '&#10;').replaceAll('\t', '&#9;');
function xmlPlain(node, allowedAttrs = []) {
  plain(node, allowedAttrs);
  if (node.identity !== undefined || node.generics?.length || node.clarifiers?.length) {
    reject(node, 'XML cannot preserve AEON identity or datatype metadata.');
  }
}
function xmlString(node) {
  xmlPlain(node);
  if (node.kind !== 'StringLiteral') reject(node, 'XML data must be a string.');
  return node.value;
}
function xmlSpecialTag(tag) {
  return tag === XML_COMMENT_TAG || tag?.startsWith('?');
}
function xmlMisc(node) {
  xmlPlain(node);
  const comment = node.tag === XML_COMMENT_TAG;
  if (node.items.length > 1 || (comment && node.items.length !== 1)) {
    reject(node, comment ? 'An XML comment requires one string child.' : 'An XML processing instruction admits at most one string child.');
  }
  const data = node.items.length ? xmlString(node.items[0]) : '';
  if (data.includes('\r')) reject(node, 'XML comments and processing instructions cannot preserve carriage returns.');
  if (comment) {
    if (data.includes('--') || data.endsWith('-')) reject(node, 'Invalid XML comment text.');
    return `<!--${data}-->`;
  }
  const target = node.tag.slice(1);
  if (!isXmlName(target, false) || target.toLowerCase() === 'xml') reject(node, 'Invalid or reserved XML processing instruction target.');
  if (data.includes('?>') || /^[ \n\t]/u.test(data) || (node.items.length && !data)) {
    reject(node, 'Processing instruction data must be non-empty, cannot start with whitespace, and cannot contain ?>.');
  }
  return data ? `<?${target} ${data}?>` : `<?${target}?>`;
}
function xmlNode(node) {
  if (node.kind !== 'NodeLiteral') reject(node, 'XML requires a tagged node.');
  if (xmlSpecialTag(node.tag)) return xmlMisc(node);
  xmlPlain(node, [...node.attrs.keys()]);
  if (!isXmlName(node.tag)) reject(node, 'Invalid XML element name.');
  let attrs = '';
  for (const [key, value] of node.attrs) {
    if (!isXmlName(key)) reject(value, 'Invalid XML attribute name.');
    attrs += ` ${key}="${escapeXml(xmlString(value))}"`;
  }
  let content = '';
  for (const child of node.items) {
    if (child.kind === 'NodeLiteral') {
      content += xmlNode(child);
    } else if (child.kind === 'StringLiteral' && child.datatype === 'cdata') {
      if (child.attrs.size || child.identity !== undefined || child.generics?.length || child.clarifiers?.length) reject(child, 'CDATA markers cannot carry attributes, identity, generics or clarifiers.');
      if (child.value.includes('\r')) reject(child, 'CDATA cannot preserve carriage returns: XML normalizes them to newlines. Use ordinary text for character references.');
      content += '<![CDATA[' + child.value.replaceAll(']]>', ']]]]><![CDATA[>') + ']]>';
    } else {
      content += escapeXml(xmlString(child));
    }
  }
  return `<${node.tag}${attrs}${content ? `>${content}</${node.tag}>` : '/>'}`;
}
function xmlDeclaration(node) {
  if (node.kind !== 'NodeLiteral' || node.tag !== XML_DECLARATION_TAG || node.items.length) {
    reject(node, 'The XML declaration must be a tagged node with attributes and no children.');
  }
  const order = ['version', 'encoding', 'standalone'];
  xmlPlain(node, order);
  if (!node.attrs.has('version')) reject(node, 'The XML declaration requires a version attribute.');
  let output = '<?xml';
  for (const key of order) {
    const attr = node.attrs.get(key);
    if (!attr) continue;
    const value = xmlString(attr);
    if (key === 'encoding' && !/^utf-?8$/iu.test(value)) reject(attr, 'Text export uses UTF-8.');
    if (key === 'version' && value !== '1.0') reject(attr, 'Expected XML version 1.0.');
    if (key === 'standalone' && value !== 'yes' && value !== 'no') reject(attr, 'Expected XML standalone yes or no.');
    output += ` ${key}="${value}"`;
  }
  return output + '?>\n';
}
function xml(document, notes) {
  const wrapper = document.members.get(XML_DOCUMENT_TAG);
  const declaration = document.members.get(XML_DECLARATION_TAG);
  if (wrapper?.kind !== 'NodeLiteral' || wrapper.tag !== XML_DOCUMENT_TAG
    || document.members.size !== 1 + Number(Boolean(declaration))) {
    reject(document, 'XML output requires an xml document wrapper and an optional ?xml declaration.');
  }
  xmlPlain(wrapper, ['source']);
  const provenance = wrapper.attrs.get('source');
  if (provenance) {
    xmlPlain(provenance);
    if (provenance.kind !== 'SymbolicLiteral' || provenance.value !== 'XML') reject(provenance, 'The XML document wrapper only admits symbolic XML provenance.');
    notes.push('Source provenance is omitted from the exported document.');
  }
  let elementCount = 0;
  for (const child of wrapper.items) {
    if (child.kind !== 'NodeLiteral') reject(child, 'XML document children must be tagged nodes.');
    if (!xmlSpecialTag(child.tag)) elementCount++;
    if (elementCount > 1) reject(child, 'XML output requires exactly one document element.');
  }
  if (elementCount !== 1) reject(wrapper, 'XML output requires exactly one document element.');
  return (declaration ? xmlDeclaration(declaration) : '') + wrapper.items.map(xmlNode).join('');
}
function alog(node) {
  plain(node);
  if (node.kind !== 'ListNode') reject(node, 'ALOG requires a list of scalar record lists.');
  return '&LOG v1\n' + node.items.map(record => {
    plain(record);
    if (record.kind !== 'ListNode' || !record.items.length) reject(record, 'Each ALOG record must be a nonempty scalar list.');
    return record.items.map(field => {
      plain(field);
      if (['ObjectNode', 'ListNode', 'NodeLiteral', 'TupleNode'].includes(field.kind)) reject(field, 'ALOG fields must be scalars.');
      return aesToAeon([{...field, path: '$.field'}], {includeHeader: false}).trim().slice('field = '.length);
    }).join(', ');
  }).join('\n') + (node.items.length ? '\n' : '');
}

const SCALAR_KINDS = new Set(['StringLiteral', 'NumberLiteral', 'BooleanLiteral', 'NullLiteral',
  'SymbolicLiteral', 'ToggleLiteral', 'HexLiteral', 'RadixLiteral', 'EncodingLiteral',
  'SeparatorLiteral', 'DateLiteral', 'TimeLiteral', 'DateTimeLiteral', 'WTCDateTimeLiteral',
  'SansaAddressLiteral', 'InfinityLiteral', 'NaNLiteral']);

function scalarSpelling(node) {
  return aesToAeon([{path: '$.value', kind: node.kind, value: node.value}], {includeHeader: false})
    .trim().slice('value = '.length);
}

function stringifyUnsupportedScalars(root, target, resolveRadixBase) {
  const losses = new Map();
  function visit(node, role = 'value') {
    if (target === 'xml' && node.kind === 'NodeLiteral' && xmlSpecialTag(node.tag)) return;
    if (SCALAR_KINDS.has(node.kind)) {
      const cdata = target === 'xml' && role === 'child' && node.kind === 'StringLiteral'
        && node.datatype === 'cdata' && !node.generics?.length && !node.clarifiers?.length
        && !node.value.includes('\r');
      let native = node.datatype === undefined || cdata;
      if (target === 'json' || target === 'yaml') {
        native &&= ['StringLiteral', 'NumberLiteral', 'BooleanLiteral'].includes(node.kind)
          || (node.kind === 'NullLiteral' && node.value === 'none');
      } else if (target === 'toml') {
        if (node.kind === 'RadixLiteral') {
          try { toml(node, resolveRadixBase); native = true; } catch { native = false; }
        } else native &&= ['StringLiteral', 'NumberLiteral', 'BooleanLiteral', 'DateLiteral',
          'TimeLiteral', 'DateTimeLiteral', 'InfinityLiteral', 'NaNLiteral'].includes(node.kind);
      } else if (target === 'xml') native &&= node.kind === 'StringLiteral';
      if (native && target === 'toml' && node.kind === 'NumberLiteral' && /^-?\d+$/u.test(node.value)) native = isTomlIntegerInRange(node.value);
      // A temporal family can still contain a value outside TOML's syntax
      // (for example an AEON year-only date or minute-precision time).
      if (native && target === 'toml' && ['DateLiteral', 'TimeLiteral', 'DateTimeLiteral'].includes(node.kind)) {
        try { tomlToAes(`value = ${node.value}`, {sourceMetadata: false}); } catch { native = false; }
      }
      // The ALOG parser deliberately pins its scalar grammar to an older Core.
      // Probe its actual supported value domain rather than assuming that every
      // scalar accepted by the playground compiler is already supported there.
      if (native && target === 'alog') {
        try { alogToAes('&LOG v1\n' + scalarSpelling(node), {sourceMetadata: false}); } catch { native = false; }
      }
      if (!native) {
        const key = `${node.kind}:${node.datatype ?? ''}`;
        let loss = losses.get(key);
        if (!loss) {
          loss = {code: 'SCALAR_STRINGIFIED', kind: node.kind, datatype: node.datatype,
            paths: [], occurrences: 0,
            message: `Converted ${node.kind}${node.datatype ? ` (${node.datatype})` : ''} to a string for ${target.toUpperCase()}. Reverse conversion cannot restore its original scalar type or datatype annotation.`};
          losses.set(key, loss);
        }
        loss.occurrences++;
        if (loss.paths.length < 5) loss.paths.push(node.path);
        // Keep existing strings' decoded contents. Other scalars use their AEON
        // value spelling, including literal markers. Never stringify containers,
        // references or object keys, discard attribute metadata, or round host numbers.
        const text = node.kind === 'StringLiteral' ? node.value : scalarSpelling(node);
        node.kind = 'StringLiteral'; node.value = text;
        delete node.datatype; delete node.generics; delete node.clarifiers;
      }
    }
    for (const [key, child] of node.members) {
      visit(child, target === 'xml' && node === root && key === XML_DOCUMENT_TAG ? 'document' : 'value');
    }
    for (const child of node.items) visit(child, node.kind === 'NodeLiteral' && role !== 'document' ? 'child' : 'value');
    // XML element attributes carry source scalar values. Other AEON attributes
    // remain governed by the exporter's existing checks, never silently dropped.
    if (target === 'xml' && node.kind === 'NodeLiteral' && role !== 'document') {
      for (const attribute of node.attrs.values()) visit(attribute, 'attribute');
    }
  }
  visit(root);
  return [...losses.values()];
}

export function createConverter(core) {
  const resolveRadixBase = node => {
    // Only radix-family descriptors have numeric-base meaning. A custom claim
    // or extra alias clarifier must not be discarded to make an export fit.
    if (node.datatype !== 'radix' && !['radix2', 'radix8'].includes(node.datatype)) return undefined;
    if (node.datatype !== 'radix' && node.clarifiers?.length) return undefined;
    const resolution = core.resolveAeonRadixBaseFromComponents(node.datatype, node.clarifiers);
    return resolution.kind === 'base' ? resolution.base : undefined;
  };
  return function convert({from, to, source, mode = 'lossless'}) {
    if (!formats.includes(from) || !formats.includes(to) || typeof source !== 'string') throw new ConversionError('Choose valid input and output formats.', undefined, 'INVALID_REQUEST');
    if (!['lossless', 'lossy'].includes(mode)) throw new ConversionError('Choose lossless or lossy mode.', undefined, 'INVALID_REQUEST');
    let records;
    let annotations = [];
    if (from === 'aeon') {
      const result = core.compileToTelex(source, {maxInputBytes: 1_048_576, maxEvents: 100_000});
      if (result.compile.errors.length) {
        const first = result.compile.errors[0];
        const error = new ConversionError(first.message, first.path, first.code ?? 'AEON_PARSE');
        error.line = first.span?.start?.line; error.column = first.span?.start?.column;
        throw error;
      }
      records = result.records;
      annotations = (result.compile.annotations ?? []).filter(annotation =>
        annotation.kind === 'annotation' && /^\/@\s*yaml\.tag\(/u.test(annotation.raw));
    } else if (from === 'yaml') {
      ({ records, annotations } = yamlToAesWithAnnotations(source));
    } else records = imports[from](source);
    if (annotations.length && to !== 'aeon') throw new ConversionError(
      'YAML tag annotations require an annotation-aware exporter; this output cannot preserve them.',
      undefined, 'YAML_ANNOTATIONS_REQUIRED');
    const warnings = materializerWarnings(records);
    if (mode === 'lossy') {
      warnings.unshift({code: 'LOSSY_MODE', paths: [], occurrences: 0,
        message: 'Lossy mode: unsupported scalar values become strings. Round-trip preservation is not guaranteed; reverse conversion does not infer their original types.'});
    }
    if (to === 'aeon' && records.some(record => record.generics?.length)) throw new ConversionError('Canonical export of generic datatypes is not supported by this adapter renderer.');
    if (to === 'aeon') {
      const render = from === 'xml' ? xmlAesToAeon : aesToAeon;
      return {output: render(records, {includeHeader: false, annotations}), annotations,
        events: records.length, notes: [], warnings, mode, stringifiedScalars: 0};
    }
    const document = tree(records);
    let root = document;
    const notes = [];
    if (to !== 'xml' && document.members.size === 1 && document.members.has('')) {
      root = document.members.get('');
      const provenance = root.attrs.get('source');
      if (provenance?.kind === 'SymbolicLiteral' && ['JSON', 'XML', 'TOML', 'YAML', 'ALOG'].includes(provenance.value) && !provenance.attrs.size && !provenance.datatype) {
        if (provenance.value === 'YAML') {
          for (const [key, expected] of [['support', 'limited'], ['version', '1.2']]) {
            const attribute = root.attrs.get(key);
            if (attribute?.kind === 'StringLiteral' && attribute.value === expected && !attribute.attrs.size && !attribute.datatype) root.attrs.delete(key);
          }
        }
        if (provenance.value === 'TOML') {
          const version = root.attrs.get('version');
          if (version?.kind === 'StringLiteral' && version.value === '1.0' && !version.attrs.size && !version.datatype) root.attrs.delete('version');
        }
        root.attrs.delete('source');
        notes.push('Source provenance is omitted from the exported document.');
      }
      notes.push('Exported the imported root at $.[""].');
    }
    if (mode === 'lossy') {
      warnings.push(...stringifyUnsupportedScalars(root, to, resolveRadixBase));
    }
    let output;
    if (to === 'json') output = json(root) + '\n';
    if (to === 'yaml') output = yaml(root) + '\n';
    if (to === 'xml') { output = xml(document, notes) + '\n'; xmlToAes(output, {preserveWhitespace: true}); }
    if (to === 'toml') {
      plain(root);
      if (root.kind !== 'ObjectNode') reject(root, 'TOML requires an object root.');
      output = [...root.members].map(([key, value]) => `${quoteTomlString(key)} = ${toml(value, resolveRadixBase)}`).join('\n') + '\n';
      tomlToAes(output);
    }
    if (to === 'alog') { output = alog(root); alogToAes(output); }
    if (to === 'yaml') yamlToAes(output);
    return {output, events: records.length, notes, warnings, mode,
      stringifiedScalars: warnings.filter(w => w.code === 'SCALAR_STRINGIFIED').reduce((sum, w) => sum + w.occurrences, 0)};
  };
}

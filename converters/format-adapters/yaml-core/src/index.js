import { parseDocument, isAlias, isMap, isSeq, isScalar } from 'yaml';
import { jsonToAes, DEFAULT_JSON_AES_LIMITS } from '../../json-core/src/json-aes.js';
import { aesToAeon } from '../../json-core/src/aeon.js';
import { encodeTelex } from '../../toml-core/src/telex.js';
export { aesToAeon, encodeTelex };
export class YamlAesError extends Error {
  constructor(code, message) { super(message); this.name = 'YamlAesError'; this.code = code; }
}
const fail = (code, message) => { throw new YamlAesError(code, message); };
/**
 * Convert YAML to portable AES plus span-free, path-targeted annotation descriptors.
 * Unknown custom scalar tags are retained as yaml.tag(...) comments, never types.
 * No YAML constructors run; the parser's decoded scalar text is preserved.
 */
export function yamlToAesWithAnnotations(input, options = {}) {
  if (Object.hasOwn(options, 'tagMappings')) {
    fail('YAML_OPTION', 'tagMappings has been removed; custom scalar tags use semantic comments');
  }
  if (options.mode !== undefined && options.mode !== 'transport') {
    fail('YAML_MODE', 'The adapter renders transport mode only');
  }
  const annotations = [];
  const allowedWarnings = new Set();
  let text;
  if (typeof input === 'string') text = input;
  else if (input instanceof Uint8Array) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(input); }
    catch { fail('YAML_INVALID_UTF8', 'Invalid UTF-8'); }
  } else throw new TypeError('YAML input must be text or UTF-8 bytes');
  const limits = { ...DEFAULT_JSON_AES_LIMITS, ...options.limits };
  if (Buffer.byteLength(text) > limits.maxInputBytes) fail('YAML_LIMIT_EXCEEDED', 'maxInputBytes exceeded');
  const doc = parseDocument(text, { version: '1.2', schema: 'core', intAsBigInt: true,
    strict: true, uniqueKeys: true, resolveKnownTags: false, prettyErrors: false });
  if (doc.errors.length) fail('YAML_PARSE', doc.errors[0].message);
  if (doc.directives.yaml.version !== '1.2') fail('YAML_VERSION', 'Only YAML 1.2 is supported');
  function value(node, depth = 0, path = '$.[""]') {
    if (!node) return 'null';
    if (depth > limits.maxValueNestingDepth) fail('YAML_LIMIT_EXCEEDED', 'maxValueNestingDepth exceeded');
    if (isAlias(node) || node.anchor) fail('YAML_GRAPH', 'Anchors and aliases are unsupported');
    if (node.tag) {
      if (node.tag === '!' || node.tag.startsWith('tag:yaml.org,2002:')
        || !isScalar(node) || typeof node.source !== 'string') {
        fail('YAML_TAG', 'Only custom scalar tags can be preserved as semantic comments');
      }
      if ([...node.tag].length > limits.maxStringCodepoints) fail('YAML_LIMIT_EXCEEDED', 'Tag exceeds maxStringCodepoints');
      // Unknown scalar tags fall back to text in the YAML AST. Permit only that
      // exact warning after rejecting tagged keys, collections and graph nodes.
      allowedWarnings.add(`Unresolved tag: ${node.tag}`);
      // Block terminators and Unicode line separators cannot escape the comment.
      const encoded = JSON.stringify(node.tag).replaceAll('@', '\\u0040')
        .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
      annotations.push({ kind: 'annotation', form: 'block',
        raw: `/@ yaml.tag(${encoded}) @/`, target: { kind: 'path', path } });
      return JSON.stringify(node.source);
    }
    if (isMap(node)) {
      const seen = new Set();
      return '{' + node.items.map(({ key, value: child }) => {
        if (!isScalar(key) || typeof key.value !== 'string') fail('YAML_KEY', 'Mapping keys must be strings');
        if (key.tag || key.anchor) fail('YAML_KEY', 'Tagged or anchored keys are unsupported');
        if (key.value === '<<') fail('YAML_MERGE', 'Merge keys are unsupported');
        if (seen.has(key.value)) fail('YAML_DUPLICATE_KEY', 'Duplicate mapping key');
        seen.add(key.value);
        const segment = /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key.value)
          ? `.${key.value}` : `.[${JSON.stringify(key.value)}]`;
        return JSON.stringify(key.value) + ':' + value(child, depth + 1, path + segment);
      }).join(',') + '}';
    }
    if (isSeq(node)) return '[' + node.items.map((n, i) => value(n, depth + 1, `${path}[${i}]`)).join(',') + ']';
    if (!isScalar(node)) fail('YAML_VALUE', 'Unsupported YAML node');
    if (typeof node.value === 'string' || typeof node.value === 'boolean' || node.value === null) return JSON.stringify(node.value);
    if (typeof node.value === 'bigint') {
      if (node.source.length > limits.maxNumericLiteralCharacters) fail('YAML_LIMIT_EXCEEDED', 'maxNumericLiteralCharacters exceeded');
      return node.value.toString();
    }
    if (typeof node.value === 'number') {
      // Use source even when the library's Number has overflowed or rounded.
      let raw = node.source;
      if (/^[-+]?\.(?:inf|nan)$/iu.test(raw)) fail('YAML_NONFINITE', 'Nonfinite floats are outside the initial profile');
      if (raw.length > limits.maxNumericLiteralCharacters) fail('YAML_LIMIT_EXCEEDED', 'maxNumericLiteralCharacters exceeded');
      raw = raw.replace(/^\+/, '').replace(/^(-?)\./, '$10.').replace(/\.(?=[eE]|$)/, '.0');
      raw = raw.replace(/^(-?)0+(?=\d)/, '$1');
      return raw;
    }
    fail('YAML_VALUE', 'Unsupported scalar');
  }
  // Existing JSON parser provides Unicode, numeric and portable path validation.
  const metadata = options.sourceMetadata === false ? [] : [
    { path: '$.[""].@.source', kind: 'SymbolicLiteral', value: 'YAML' },
    { path: '$.[""].@.support', kind: 'StringLiteral', value: 'limited' },
    { path: '$.[""].@.version', kind: 'StringLiteral', value: '1.2' },
  ];
  if (limits.maxEvents < 1 + metadata.length) fail('YAML_LIMIT_EXCEEDED', 'maxEvents exceeded');
  for (const record of metadata) {
    const key = record.path.slice(record.path.lastIndexOf('.') + 1);
    if (key.length > limits.maxKeySegmentCodepoints) fail('YAML_LIMIT_EXCEEDED', 'maxKeySegmentCodepoints exceeded');
    if (record.kind === 'StringLiteral' && record.value.length > limits.maxStringCodepoints) fail('YAML_LIMIT_EXCEEDED', 'maxStringCodepoints exceeded');
    if (limits.maxPathDepth < 2 || record.path.length > limits.maxPathCharacters) fail('YAML_LIMIT_EXCEEDED', 'Source metadata exceeds path limits');
  }
  const json = value(doc.contents);
  if (limits.maxEvents < 1 + metadata.length + annotations.length) fail('YAML_LIMIT_EXCEEDED', 'maxEvents exceeded');
  const records = jsonToAes(json, { ...options, mapping: 'root', sourceMetadata: false,
    limits: { ...options.limits, maxInputBytes: Infinity,
      maxEvents: limits.maxEvents - metadata.length - annotations.length } });
  for (const warning of doc.warnings) {
    if (warning.code !== 'TAG_RESOLVE_FAILED' || !allowedWarnings.has(warning.message)) {
      fail('YAML_PARSE', warning.message);
    }
  }
  records.splice(1, 0, ...metadata);
  return { records, annotations };
}

/** AES-only APIs fail rather than silently dropping source tag annotations. */
export function yamlToAes(input, options = {}) {
  const result = yamlToAesWithAnnotations(input, options);
  if (result.annotations.length) fail('YAML_ANNOTATIONS_REQUIRED', 'Tagged YAML requires yamlToAesWithAnnotations or yamlToAeon; AES/Telex alone cannot preserve tags');
  return result.records;
}
export function yamlToAeon(input, options = {}) {
  const { records, annotations } = yamlToAesWithAnnotations(input, options);
  return aesToAeon(records, { ...options, annotations });
}
export const yamlToTelex = (input, options) => encodeTelex(yamlToAes(input, options));

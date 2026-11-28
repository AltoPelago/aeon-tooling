import { renderAesDocument } from '../../toml-core/src/aeon.js';
export { compareScalarKeys, parseAesPath } from '../../toml-core/src/aeon.js';

/**
 * Renders valid preorder portable AES body records as AEON source.
 * Optional path-targeted block annotations are preserved at supported scalars.
 *
 * @param {Array<{path: string, kind: string, tag?: string, identity?: string, datatype?: string, value?: string}>} records
 * @param {{includeHeader?: boolean, sortKeys?: boolean, annotations?: Array<object>}} [options]
 */
export function aesToAeon(records, options = {}) {
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
    const group = comments.get(path);
    if (group) group.push(raw);
    else comments.set(path, [raw]);
  }
  return renderAesDocument(records, options, comments);
}

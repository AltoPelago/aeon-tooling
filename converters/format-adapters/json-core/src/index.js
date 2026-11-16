/**
 * @typedef {object} JsonAesRecord
 * A portable AES body record (`aes.events.v1`) derived from JSON.
 * @property {string} path  Canonical SANSA data address, e.g. `$.a.["b c"][0]`.
 * @property {'ObjectNode' | 'ListNode' | 'StringLiteral' | 'NumberLiteral' | 'BooleanLiteral' | 'NullLiteral'} kind
 * @property {string} [value] Present for every kind except `ObjectNode` and `ListNode`.
 */

import { jsonToAes } from './json-aes.js';
import { encodeTelex } from './telex.js';
import { aesToAeon } from './aeon.js';

export { jsonToAes, JsonAesError, DEFAULT_JSON_AES_LIMITS } from './json-aes.js';
export { normalizeJsonNumber } from './number.js';
export { encodeTelex } from './telex.js';
export { aesToAeon, compareScalarKeys, parseAesPath } from './aeon.js';

/**
 * Convert JSON text directly into a canonical `telex.aes` v1 stream
 * (default `aes.complete.v1` profile, body-only projection).
 *
 * @param {string | Uint8Array} input
 * @param {Parameters<typeof jsonToAes>[1]} [options]
 * @returns {string}
 */
export function jsonToTelex(input, options) {
  return encodeTelex(jsonToAes(input, options));
}

/**
 * Convert JSON text directly into canonical AEON source text matching
 * `@altopelago/aeon-canonical` (`reference-safe-v1`).
 *
 * @param {string | Uint8Array} input
 * @param {Parameters<typeof jsonToAes>[1] & { includeHeader?: boolean, sortKeys?: boolean }} [options]
 * @returns {string}
 */
export function jsonToAeon(input, options) {
  return aesToAeon(jsonToAes(input, options), options);
}

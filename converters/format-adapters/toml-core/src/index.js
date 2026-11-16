/**
 * @typedef {object} TomlAesRecord
 * A portable AES body record (`aes.events.v1`) derived from TOML.
 * @property {string} path Canonical SANSA data address.
 * @property {'ObjectNode' | 'ListNode' | 'StringLiteral' | 'NumberLiteral' | 'RadixLiteral' | 'InfinityLiteral' | 'NaNLiteral' | 'BooleanLiteral' | 'DateLiteral' | 'TimeLiteral' | 'DateTimeLiteral'} kind
 * @property {string} [datatype] Present for `RadixLiteral` (`"radix"`).
 * @property {readonly unknown[]} [generics] Present when `datatype` is present.
 * @property {readonly { kind: 'NumberLiteral', value: string }[]} [clarifiers] Present when `datatype` is present.
 * @property {string} [value] Present for every kind except `ObjectNode` and `ListNode`.
 */

import { tomlToAes } from './toml-aes.js';
import { encodeTelex } from './telex.js';
import { aesToAeon } from './aeon.js';

export { tomlToAes, TomlAesError, DEFAULT_TOML_AES_LIMITS } from './toml-aes.js';
export { normalizeTomlNumber } from './number.js';
export { encodeTelex } from './telex.js';
export { aesToAeon, compareScalarKeys, parseAesPath } from './aeon.js';

/**
 * Convert TOML v1.0 text directly into a canonical `telex.aes` v1 stream
 * (default `aes.complete.v1` profile, body-only projection).
 *
 * @param {string | Uint8Array} input
 * @param {Parameters<typeof tomlToAes>[1]} [options]
 * @returns {string}
 */
export function tomlToTelex(input, options) {
  return encodeTelex(tomlToAes(input, options));
}

/**
 * Convert TOML v1.0 text directly into canonical AEON source text matching
 * `@altopelago/aeon-canonical` (`reference-safe-v1`).
 *
 * @param {string | Uint8Array} input
 * @param {Parameters<typeof tomlToAes>[1] & { includeHeader?: boolean, sortKeys?: boolean }} [options]
 * @returns {string}
 */
export function tomlToAeon(input, options) {
  return aesToAeon(tomlToAes(input, options), options);
}

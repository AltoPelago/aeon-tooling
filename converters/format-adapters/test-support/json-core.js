// Existing pre-migration vectors explicitly exercise the legacy mapping.
export * from '../json-core/src/index.js';
import * as adapter from '../json-core/src/index.js';
export const jsonToAes = (input, options) => adapter.jsonToAes(input, { ...options, mapping: 'native' });
export const jsonToTelex = (input, options) => adapter.jsonToTelex(input, { ...options, mapping: 'native' });
export const jsonToAeon = (input, options) => adapter.jsonToAeon(input, { ...options, mapping: 'native' });

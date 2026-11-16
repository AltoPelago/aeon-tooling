// Existing pre-migration vectors explicitly exercise the legacy mapping.
export * from '../xml-core/src/index.js';
import * as adapter from '../xml-core/src/index.js';
export const xmlToAes = (input, options) => adapter.xmlToAes(input, { preserveCdata: false, ...options, mapping: 'native' });
export const xmlToTelex = (input, options) => adapter.xmlToTelex(input, { preserveCdata: false, ...options, mapping: 'native' });
export const xmlToAeon = (input, options) => adapter.xmlToAeon(input, { preserveCdata: false, ...options, mapping: 'native' });

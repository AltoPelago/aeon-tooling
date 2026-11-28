// These vectors focus on XML structure with provenance disabled and CDATA treated as text.
export * from '../xml-core/src/index.js';
import * as adapter from '../xml-core/src/index.js';
export const xmlToAes = (input, options) => adapter.xmlToAes(input, { preserveCdata: false, ...options, mapping: 'native' });
export const xmlToTelex = (input, options) => adapter.xmlToTelex(input, { preserveCdata: false, ...options, mapping: 'native' });
export const xmlToAeon = (input, options) => adapter.xmlToAeon(input, { preserveCdata: false, ...options, mapping: 'native' });

// Existing pre-migration vectors explicitly exercise the legacy mapping.
export * from '../toml-core/src/index.js';
import * as adapter from '../toml-core/src/index.js';
export const tomlToAes = (input, options) => adapter.tomlToAes(input, { ...options, mapping: 'native' });
export const tomlToTelex = (input, options) => adapter.tomlToTelex(input, { ...options, mapping: 'native' });
export const tomlToAeon = (input, options) => adapter.tomlToAeon(input, { ...options, mapping: 'native' });

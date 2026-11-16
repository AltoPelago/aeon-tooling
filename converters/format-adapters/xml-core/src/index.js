import { xmlToAes } from './xml-aes.js';
import { aesToAeon } from './aeon.js';

export {
  DEFAULT_XML_AES_LIMITS,
  XML_ADAPTER_PRINCIPLES,
  XmlAesError,
  normalizeXmlAesLimits,
  xmlToAes,
  xmlToTelex,
} from './xml-aes.js';

export {
  TELEX_VERSION_LINE,
  encodeTelexPayload,
  escapeQuotedPathKey,
  formatAttributePath,
  formatRootMemberPath,
  formatTelex,
} from './telex.js';

export { aesToAeon, compareScalarKeys, parseAesPath } from './aeon.js';

/**
 * Converts an XML 1.0 document string directly into canonical AEON source text
 * matching `@altopelago/aeon-canonical` (`reference-safe-v1`).
 *
 * @param {string} input
 * @param {Parameters<typeof xmlToAes>[1] & { includeHeader?: boolean, sortKeys?: boolean }} [options]
 * @returns {string}
 */
export function xmlToAeon(input, options = {}) {
  return aesToAeon(xmlToAes(input, options), options);
}

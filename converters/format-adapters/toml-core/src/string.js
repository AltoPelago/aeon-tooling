/** Encode one TOML 1.0 basic string, also valid as a quoted key.
 * JSON handles the shared quote/backslash/C0 escapes, but leaves U+007F raw;
 * TOML requires that character to be escaped in both values and quoted keys.
 */
export function quoteTomlString(value) {
  if (typeof value !== 'string') throw new TypeError('TOML strings must be strings');
  return JSON.stringify(value).replaceAll('\u007f', '\\u007F');
}

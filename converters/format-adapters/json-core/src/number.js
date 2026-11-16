/**
 * Canonicalize a JSON number lexeme into AES `NumberLiteral` value text.
 *
 * This mirrors AEON's `normalizeNumberLiteral` (parser/src/number.ts) so that a
 * JSON number and the identical AEON number lexeme produce the same AES value.
 * The lexeme is never converted to a host number: precision, magnitude, and
 * negative zero are preserved exactly.
 *
 *   1.50   -> 1.5      1E+5  -> 1e5      1.0e3 -> 1e3
 *   -0     -> -0       1e-07 -> 1e-7     0e10  -> 0e0
 *
 * @param {string} lexeme A lexeme already accepted by the RFC 8259 grammar.
 * @returns {string}
 */
export function normalizeJsonNumber(lexeme) {
  const value = lexeme.replace(/E/g, 'e');
  const [rawMantissa, rawExponent] = value.split('e');
  let mantissa = rawMantissa;
  if (mantissa.includes('.')) {
    const [intPart, fractionRaw] = mantissa.split('.');
    const fraction = trimTrailingZeros(fractionRaw) || '0';
    mantissa = rawExponent !== undefined && fraction === '0'
      ? intPart
      : `${intPart}.${fraction}`;
  }
  if (rawExponent === undefined) return mantissa;
  if (mantissa === '0' || mantissa === '-0') return `${mantissa}e0`;

  const exponent = rawExponent.replace(/^\+/, '');
  const negative = exponent.startsWith('-');
  const digits = (negative ? exponent.slice(1) : exponent).replace(/^0+/, '') || '0';
  return digits === '0' ? `${mantissa}e0` : `${mantissa}e${negative ? '-' : ''}${digits}`;
}

function trimTrailingZeros(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '0') end -= 1;
  return value.slice(0, end);
}

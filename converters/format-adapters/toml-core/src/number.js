/**
 * Canonicalize a TOML decimal integer or float lexeme into AES `NumberLiteral` value text.
 *
 * Strips underscores and leading `+`, normalizes `E` -> `e`, trims superfluous
 * trailing fractional zeros (keeping `.0` when there is no exponent), and
 * normalizes exponent leading zeros—matching AEON's `normalizeNumberLiteral`
 * without ever converting to a host IEEE-754 float.
 *
 * @param {string} lexeme
 * @returns {string}
 */
export function normalizeTomlNumber(lexeme) {
  let value = lexeme.replace(/_/g, '').replace(/E/g, 'e');
  if (value.startsWith('+')) value = value.slice(1);

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

export const TOML_INTEGER_MIN = -(1n << 63n);
export const TOML_INTEGER_MAX = (1n << 63n) - 1n;

/** Check an already syntax-validated TOML integer without host-number rounding. */
export function isTomlIntegerInRange(lexeme) {
  const value = BigInt(lexeme.replaceAll('_', ''));
  return value >= TOML_INTEGER_MIN && value <= TOML_INTEGER_MAX;
}

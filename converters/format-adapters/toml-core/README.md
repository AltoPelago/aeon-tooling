See the [current language feature support matrix](../../../docs/format-adapter-support.md) for import/export coverage and limitations.

# Current TOML adapter mapping

The adapter targets TOML 1.0.0. The default mapping places the source root under
`""` with `source = |TOML|` and `version = "1.0"` as binding attributes. Pass `{ mapping: 'native' }`
(or CLI `--native`) for the previous mapping. Root mode accepts empty source keys;
JSON also accepts arrays and scalar roots. Set `sourceMetadata: false` to omit
both provenance attributes. See the [migration proposal](../../../docs/format-adapters.md).

The reference below describes the **legacy native profile** and its original
pipeline evidence. Unqualified API calls now use the root mapping above.

---

# toml-core

Converts TOML v1.0 documents into portable AES (`aes.events.v1`) records and
canonical `telex.aes` v1, so TOML configuration and data files can use Aeonite
tooling such as AEOS schema validation and SANSA queries.

## Value mapping

| TOML                             | AES `kind`        | `datatype`  | `value`                                |
| -------------------------------- | ----------------- | ----------- | -------------------------------------- |
| Table / inline table             | `ObjectNode`      | (absent)    | (absent)                               |
| Array / `[[array.of.tables]]`    | `ListNode`        | (absent)    | (absent)                               |
| String (basic/literal/multiline) | `StringLiteral`   | (absent)    | decoded string                         |
| Decimal integer / float          | `NumberLiteral`   | (absent)    | canonical AEON number lexeme           |
| `0b...` binary integer           | `RadixLiteral`    | `radix[2]`  | digits without `0b` or `_`             |
| `0o...` octal integer            | `RadixLiteral`    | `radix[8]`  | digits without `0o` or `_`             |
| `0x...` hexadecimal integer      | `RadixLiteral`    | `radix[16]` | digits without `0x` or `_`             |
| `[+-]?inf`                       | `InfinityLiteral` | (absent)    | `Infinity` / `-Infinity`               |
| `[+-]?nan`                       | `NaNLiteral`      | (absent)    | `NaN` / `-NaN`                         |
| Boolean                          | `BooleanLiteral`  | (absent)    | `true` / `false`                       |
| Local Date                       | `DateLiteral`     | (absent)    | `YYYY-MM-DD`                           |
| Local Time                       | `TimeLiteral`     | (absent)    | `HH:MM:SS[.frac]`                      |
| Local / Offset Date-Time         | `DateTimeLiteral` | (absent)    | `YYYY-MM-DDTHH:MM:SS[.frac][Z\|±HH:MM]` |

- **Table assembly before emission:** Because TOML permits non-contiguous
  `[table]` headers, implicit parent tables (`[a.b]` followed later by `[a]`),
  dotted keys (`a.b.c = 1`), and `[[array.of.tables]]`, the adapter assembles
  the full table hierarchy and validates TOML's redefinition/immutability rules
  before emitting events in canonical depth-first preorder.
- **No timezone invention:** Local dates, local times, local date-times, and
  offset date-times preserve their declared precision and offset without
  inventing a timezone or converting to `WTCDateTimeLiteral`.
- **Radix integers:** `0b`, `0o`, and `0x` integer literals are numeric bases
  in TOML (rather than opaque byte encodings), so they map to `RadixLiteral`
  with `datatype="radix"` and clarifiers `[2]`, `[8]`, and `[16]`.

## Third-format adapter principles

- **No coercion:** A date-looking or reference-looking string remains a `StringLiteral`.
- **No repair:** Empty keys (`"" = 1`, `'' = 1`), duplicate keys (after escape decoding), and illegal table redefinitions are rejected, not renamed or merged.
- **No silent data loss:** Decimal and float lexemes are normalized as text without IEEE-754 float conversion; fractional-second precision on times is preserved.
- **No invented semantics:** Property names like `"@"`, `"$"`, or `"aeon:mode"` remain ordinary object members.
- **No structural reinterpretation:** Every TOML document is already a root table, mapping directly to `$`.

## Usage

```js
import { tomlToAes, tomlToTelex } from '@altopelago/toml-core';

const records = tomlToAes(`
[server]
port = 8080
mask = 0b1010
started = 2026-10-19T03:30:00Z
`);

const telex = tomlToTelex(recordsOrTomlText);
```

### CLI

```bash
node bin/toml-aes.js examples/cluster.toml > examples/cluster.telex.aes
node bin/toml-aes.js examples/inventory.toml > examples/inventory.telex.aes
node bin/toml-aes.js --records < examples/cluster.toml
```

### With the Aeonite ecosystem

```bash
# SANSA query (from the sansa checkout)
npm run query -- --fixture ../format-adapters/toml-core/examples/cluster.telex.aes \
  --query 'from $.nodes.* where .role == "replica" and .load < 0.5 select { id = .id load = .load }'
```

```js
// AEOS schema validation
import { validateTelex } from '@altopelago/aeon-aeos';
validateTelex(tomlToTelex(tomlText), {
  rules: [
    { path: '$.snapshot_date', constraints: { required: true, type: 'DateLiteral' } },
    { selector: '$.nodes.*.flags', constraints: { required: true, type: 'RadixLiteral', radix: 2 } },
  ],
});
```

## Tests

```bash
npm test
```

## Current integer and reverse-export support

Import enforces the signed 64-bit range exactly for decimal, binary, octal and
hexadecimal integers. Out-of-range source integers fail with
`TOML_INTEGER_OUT_OF_RANGE`; floats and exponent forms remain separate from this
integer check. Binary/octal/hex spellings are unsigned and cannot exceed
`9223372036854775807`.

TOML's case-insensitive hexadecimal digits are normalized to uppercase AEON
radix digits. The playground reverse exporter supports explicit AEON integer
radix bases 2/8/16 and compatible radix2/radix8 aliases, emitting `0b`/`0o`/`0x`.
It preserves the base and leading zeros, but not source underscore placement or
hex-letter case. Unsupported bases, fractions, signs and extra metadata fail in
lossless mode. Out-of-range AEON export values become strings only when lossy
mode is explicitly selected.

## Strings and supported years

Reverse export escapes TOML basic strings and quoted keys, including `U+007F`
as `\u007F`; control characters, quotes, backslashes and Unicode preserve their
values through a round trip.

Date and datetime years must be `0001` through `9999`. The adapter deliberately
rejects year `0000` with `TOML_UNSUPPORTED_YEAR`, matching the AEON Core date range.
The restriction also applies inside arrays and inline tables, and in lossy mode.
Quoted strings such as `"0000-01-01"` are unaffected.

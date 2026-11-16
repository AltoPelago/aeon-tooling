See the [current language feature support matrix](../../../docs/format-adapter-support.md) for import/export coverage and limitations.

# Current JSON adapter mapping

The default mapping now places the source root under `""` with
`source = |JSON|` as a binding attribute. Pass `{ mapping: 'native' }`
(or CLI `--native`) for the previous mapping. Root mode accepts empty source keys;
JSON also accepts arrays and scalar roots. Set `sourceMetadata: false` to omit
provenance. See the [migration proposal](../../../docs/format-adapters.md).

The reference below describes the **legacy native profile** and its original
pipeline evidence. Unqualified API calls now use the root mapping above.

---

# json-core

Converts JSON into portable AES (`aes.events.v1`) records and canonical
`telex.aes` v1, so JSON data can use Aeonite tooling such as AEOS schema
validation and SANSA queries.

This package has no runtime dependencies. It works because almost all of JSON
fits inside the AEON value model. Where JSON allows something that AEON or AES
does not, the converter rejects the input with a diagnostic. It never drops,
renames, or coerces data to make the input fit.

## Value mapping

| JSON    | AES `kind`       | `value`                                   |
| ------- | ---------------- | ----------------------------------------- |
| object  | `ObjectNode`     | not present                               |
| array   | `ListNode`       | not present                               |
| string  | `StringLiteral`  | the decoded string                        |
| number  | `NumberLiteral`  | canonical AEON number lexeme (see below)  |
| boolean | `BooleanLiteral` | `true` / `false`                          |
| `null`  | `NullLiteral`    | `none`, i.e. AEON `!none`. JSON gives no reason for a null. |

- **No datatypes are emitted.** AEON emits none for the same untyped document.
- **Paths** are canonical SANSA addresses. Bare keys stay bare (`$.a.b`).
  Other keys are quoted (`$.["weird key"]`, `$.["1"]`). List items are indexed
  (`$.items[0]`).
- **Numbers** stay in text form and are never converted to a JS number, so
  precision, magnitude, and `-0` are kept exactly. They are canonicalized the
  same way AEON canonicalizes the identical lexeme: `1.50 → 1.5`,
  `1E+5 → 1e5`, `1.0e3 → 1e3`. JSON has no NaN or Infinity, so every number
  maps to `NumberLiteral`.
- **Order** is depth-first preorder: a parent comes before its children, and
  object members and list items keep their source order. This is the canonical
  AEON projection order.
- The stream uses the default `aes.complete.v1` profile with the body-only
  projection.

## Third-format adapter principles

- **No coercion:** A date-looking, reference-looking, or hex-looking string remains a `StringLiteral`.
- **No repair:** Empty or duplicate keys (including keys that collide after escape decoding, such as `"name"` and `"\u006eame"`) are rejected, not renamed or discarded.
- **No silent data loss:** Numeric precision must not be silently reduced.
- **No invented semantics:** JSON properties do not acquire special meaning because of their names (`"@"` does not create an attribute plane, `"aeon:mode"` does not emit a header record).
- **No structural reinterpretation:** An array or scalar root is not automatically wrapped in an object.

## Where JSON is not a subset

| JSON input                           | Code                   | Why                                                    |
| ------------------------------------ | ---------------------- | ------------------------------------------------------ |
| Top-level array or scalar            | `JSON_ROOT_NOT_OBJECT` | The AES root `$` has no event of its own. Only members can sit under it. |
| Empty key `""`                       | `JSON_EMPTY_KEY`       | AEON keys and SANSA path members must be non-empty.   |
| Duplicate key in one object (after escape decoding) | `JSON_DUPLICATE_KEY`   | `aes.complete.v1` requires unique paths.              |
| Lone surrogate (`"\ud800"`)          | `JSON_LONE_SURROGATE`  | AES carries Unicode scalar values only.               |

Other diagnostics: `JSON_SYNTAX`, `JSON_UNEXPECTED_END`, `JSON_TRAILING_CONTENT`,
`JSON_INVALID_NUMBER`, `JSON_INVALID_ESCAPE`, `JSON_CONTROL_CHARACTER`,
`JSON_INVALID_UTF8`, and `JSON_LIMIT_EXCEEDED`. The parser follows RFC 8259
strictly: no comments, trailing commas, or single quotes. A leading BOM is
ignored.

Every `JsonAesError` has a `code`, a UTF-8 byte `offset`, a 1-based `line` and
`column` (columns count code points), and a `path` where one applies. Limit
errors also include `limit`, `observed`, and `maximum`.

## Usage

```js
import { jsonToAes, jsonToTelex } from '@altopelago/json-core';

jsonToAes('{"a":[1.50,null]}');
// [ { path: '$.a',    kind: 'ListNode' },
//   { path: '$.a[0]', kind: 'NumberLiteral', value: '1.5' },
//   { path: '$.a[1]', kind: 'NullLiteral',   value: 'none' } ]

jsonToTelex(bytesOrString, { limits: { maxEvents: 1_000_000 } });
```

The input can be a string or a `Uint8Array` of UTF-8 bytes. The default limits
(`DEFAULT_JSON_AES_LIMITS`) follow `altopelago.aeonic-limits.v1`.

### CLI

```bash
node bin/json-aes.js examples/inventory.json > examples/inventory.telex.aes
node bin/json-aes.js --records < data.json     # portable records as JSON
```

### With the Aeonite ecosystem

```bash
# SANSA query (from the sansa checkout)
npm run query -- --fixture ../json-core/examples/inventory.telex.aes \
  --query 'from $.inventory.items.* where .qty >= 4 select .sku'
# $.inventory.items[1].sku = "B-200"
# $.inventory.items[2].sku = "B-210"
```

```js
// AEOS schema validation
import { validateTelex } from '@altopelago/aeon-aeos';
validateTelex(jsonToTelex(json), {
  rules: [{ path: '$.inventory.warehouse', constraints: { required: true, type: 'StringLiteral' } }],
});
```

## Tests

```bash
npm test
npm run test:cts
```

- `test/cts.test.js` runs against the shared `aeonite-cts` repository
  (`AEONITE_CTS_ROOT` or `../../aeonite-org/aeonite-cts/cts/`):
  1. **`16-aeonic-limit-boundaries.json`**: verifies `DEFAULT_JSON_AES_LIMITS`
     against `altopelago.aeonic-limits.v1` and runs every JSON-applicable
     `at-limit` and `one-over` boundary vector.
  2. **`11-next-number-normalization.json`**: verifies canonical finite numeric
     text normalization against the portable AES number normalization vectors.
  3. **`telex-cts.v1.snapshot-0.2.json`**: verifies `encodeTelex` reproduces
     exact canonical Telex bytes for JSON-subset vectors.
  4. **`aes-cts.v1.snapshot-0.4.json`**: verifies JSON-compatible projection
     vectors (including UTF-8, combining sequences, astral scalars, and
     BOM+CRLF).
- `test/ecosystem.test.js` runs 400 seeded random documents through three
  independent sibling checkouts. Each check is skipped if its checkout is
  missing:
  1. **AES reference codec.** Every output must be valid, canonical
     `aes.complete.v1` Telex.
  2. **AEON compiler.** The same document written as AEON must compile to
     byte-identical Telex. This checks the "JSON ⊂ AEON" claim directly.
  3. **AEON finalizer.** Materializing the records back to JSON must give the
     same value as `JSON.parse`.

The AEON-backed checks load the sibling `dist/` builds, so build AEON's
TypeScript packages first if they are out of date.

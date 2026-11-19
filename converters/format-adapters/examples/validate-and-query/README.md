# Import → AES → AEOS → SANSA

Runnable examples for all five source-format adapters. Each imports source text
into portable `aes.events.v1`, validates those records against a native `.aeos`
AEOS schema, and queries the validated data with SANSA.Query. Each also changes
one source field to demonstrate a validation error and skips queries on failure.

The same examples are available in the local playground's **Validate & query**
workspace, with an AES viewer, editable schemas and SANSA queries. Run
`npm run playground:adapters`; see the [UI guide](../../playground/README.md#validate--query-workspace).

## Run

From the `aeon-tooling` repository root:

```sh
npm run install:adapters
npm run examples:adapters
# Or select one or more formats:
npm run examples:adapters -- json toml
```

Use Node 20 or newer. These local development examples expect the sibling `aeon`
and `sansa` checkouts under the same parent as `aeon-tooling`. Build the AEON
TypeScript packages first if their `dist` outputs are missing or stale:

```sh
pnpm --dir ../aeon/implementations/typescript install --frozen-lockfile
pnpm --dir ../aeon/implementations/typescript build
```

SANSA runs from its JavaScript source; it needs no build. These examples use its
exported **workbench** helper `namespaceFromTelexSource`, a development integration
surface rather than a stable package-root API. The helper uses the sibling
AEON AES runtime (or its documented `SANSA_AEON_AES_MODULE` override). Keep these
checkouts compatible, including empty-key support. No server is needed.

The command prints source, schema, portable AES, validation status, queries,
matched addresses/kinds/values, and the rejected variant. It checks the expected
results and exits unsuccessfully if an assertion or runtime operation fails.

## Examples

| Format | Imported features | Query results | Rejected variant |
| --- | --- | --- | --- |
| JSON | Objects, lists, booleans, exact numbers | Active item below 10 → `A1`; exact integer above 9007199254740992 → `9007199254740993` | Negative price |
| TOML 1.0 | Arrays of tables, date, hexadecimal integer | `A1`; `2026-11-18` as `DateLiteral`; `FF` as `RadixLiteral` | Date replaced with a string |
| YAML 1.2 Core subset | Mappings, sequences, boolean and numeric resolution; `yes` and date-shaped text remain strings | `A1`; `yes`; `2026-11-18` as `StringLiteral` | Boolean replaced with a quoted string |
| ALOG v1 | Positional record lists, numbers, booleans and native dates | `A1`; its date as `DateLiteral` | Price replaced with `"cheap"` |
| XML 1.0 | Node heads, attributes, text and `:cdata` strings | Active item's `sku` → `A1`; price text → `"9.5"`; original CDATA payload | Empty SKU |

The schemas demonstrate selected type, range, length and datatype constraints;
they are not complete application schemas for every possible inventory document.

## Follow the pipeline

[`cases.mjs`](cases.mjs) contains the source documents, queries, expected
values and invalid variants. The native schemas are stored in
[`schemas/`](schemas/) and loaded as editor text by both the CLI and playground.
[`pipeline.mjs`](pipeline.mjs) connects the real
adapter, AEOS and SANSA APIs. [`run.mjs`](run.mjs) prints and checks the examples.

The central calls are:

```js
const records = jsonToAes(source);
const schema = parseSchemaSource(schemaSource); // Native .aeos text.
const validation = validate(records, schema);
if (!validation.ok) return; // Application policy: reject before querying.

const mounted = await namespaceFromTelexSource(encodeTelex(records));
if (!mounted.ok) throw new Error(JSON.stringify(mounted.errors));
const result = evaluateQuery(
  'from $.[""].items.* where .active == true and .price < 10 select .sku',
  mounted.namespace,
);
if (!result.ok) throw new Error(JSON.stringify(result.errors));
```

Native schema source uses `aeos:schema = { ... }`, with `path:sansa` or
`selector:sansa` rule targets and AEON numeric literals for `min_value` /
`max_value`. Comments and datatype annotations are accepted by the AEOS schema
parser. Numeric bounds retain their exact values, including beyond JavaScript's
safe integer range. Syntax and schema errors are reported before validation.

AEOS consumes the adapter's AES directly. Telex then transports the same records
to SANSA's host namespace; it does not convert through JSON or reparse rendered
AEON. Exact numeric lexemes and distinct scalar kinds survive. Query results
retain binding addresses and representation kinds; the display keeps number
lexemes as strings instead of converting them to JavaScript numbers.

The wrapper is an ordinary empty-key binding, so source data starts at `$.[""]`.
For JSON/TOML/YAML inventory examples, item bindings are at
`$.[""].items[0]`, and `.*` expands the list. ALOG uses `$.[""][0][1]` for
the first record's price field. XML preserves structure instead of creating
named object properties: `[0]` enters a node head, whose indexed children are
content. Its first item's attributes live at `$.[""][0][0][0].@`; CDATA
is selected by `$.[""].**#cdata`.

XML price and active values are strings; the XML query compares `"true"` rather
than a boolean. YAML date-shaped text is also a string under this profile.
TOML and ALOG dates remain native dates. AEOS checks these distinctions without
coercion. Source provenance attributes remain available in the explicit `.@`
address space throughout the pipeline.

## Verification

`npm run test:adapters` includes integration coverage for every valid and invalid
case: real query results must match expected values, kinds and original AES
addresses, and invalid input must never enter SANSA. If the required sibling
runtimes are unavailable, these integration tests report explicit skips; the
example command itself fails with setup guidance.

# Local format adapter playground

Use the AEON playground's two-pane layout to convert JSON, XML, TOML,
experimental YAML and &LOG v1 to AEON, or select the reverse direction.
The swap button moves the successful output into the input pane and reverses
the format selectors. Formats can also be converted directly to each other
when their value models overlap.

From the **aeon-tooling repository root**:

```sh
npm ci --ignore-scripts
npm run install:adapters
npm run playground:adapters
```

Open [the local playground](http://127.0.0.1:4317).
Change `PORT` if that port is in use. Stop with Ctrl+C.
No build step, CDN, remote conversion service or account is needed.
The root install supplies the locked shared highlighter and lexer packages.
The server exposes only their required browser modules under `/vendor/` and
resolves their package imports to local URLs; it does not expose `node_modules`
or require an import map or a weaker content security policy. Restart the
playground server after updating its module routes or installed dependencies.
The server binds only to `127.0.0.1`; files are read only when opened explicitly,
and conversion documents are not logged or persisted.

## Local AEON compiler

AEON input needs a built compiler with empty-key support. In the documented
family workspace layout, the server loads the sibling
`aeon/implementations/typescript/packages/core/dist/index.js`. It checks that
empty keys compile before starting. This is an explicit local-development
integration: the adapter dependency on the published 0.16 compiler cannot parse
empty-key AEON and is not used as the playground's compiler.

Build that sibling's TypeScript packages using its build instructions, or point
to another built compatible Core module:

```sh
AEON_CORE_MODULE=/path/to/aeon-core/dist/index.js npm run playground:adapters
```

The Core module is loaded by Node; its own package dependencies must also resolve.
It remains server-side. Only the allowlisted highlighter and matching lexer
modules are served to the browser; filesystem paths are not exposed.

## Lossless and lossy modes

The Mode selector defaults to **Lossless**, retaining the existing rejection of
values the selected exporter cannot preserve. This means lossless within the
supported value/mapping profile, not byte-for-byte retention of formatting,
comments or other documented source distinctions.

**Lossy** mode converts unsupported scalar families or explicit scalar datatype
annotations into ordinary strings for the selected output. Supported values
retain their types. For example:

| AEON input value | Lossy JSON value |
|---|---|
| `\|active\|` | `"\|active\|"` |
| `2026-11-16` | `"2026-11-16"` |
| `on` | `"on"` |
| `!"unknown"` | `"!\"unknown\""` |
| `Infinity` | `"Infinity"` |
| `42` | `42` |
| `!none` | `null` |

Existing strings keep their decoded payload, including when their scalar datatype
is removed. Other converted scalars use their canonical AEON value spelling,
including literal markers but without datatype annotations. For example, a radix value unsupported by the selected target becomes a string
containing `%` and its digits; its radix annotation is lost. TOML supports
explicit unsigned integer radix bases 2/8/16, so those remain integers when in range. Large supported numbers are never rounded through a host Number.

Support depends on the target exporter: TOML retains its native temporal and
special-float values (partial dates/times outside TOML syntax become strings)
but turns null into `"!none"`; XML turns non-string scalar
children and element-attribute values into text; ALOG retains its native scalar
families. XML's supported `:cdata` marker remains intact. A CDATA payload with a
carriage return becomes ordinary text in lossy XML so a character reference can
preserve the character.

Diagnostics always identify lossy mode and list the paths/types actually
stringified. Reverse conversion never infers original scalar types from those
strings. Swapping remains available as another conversion, with no round-trip
guarantee. Changing mode invalidates stale output just like changing the source.

Lossy mode does not invent structural mappings, resolve references, rename keys,
drop arbitrary AEON attributes, remove container datatypes, or bypass source
validation. Unsupported structures and metadata still fail explicitly. AEON
output retains supported AEON values without scalar coercion.

The conversion service accepts `mode: "lossless" | "lossy"`, defaults to lossless,
and returns `mode`, `stringifiedScalars` and structured warnings. These modes are
playground export policies; the forward adapter library APIs are unchanged.

## Conversion behavior

- Ordinary AEON bindings export as an object. A sole empty-key binding is treated
  as an imported document root and unwrapped. Nested empty keys are retained.
- Recognized adapter `source` provenance on that wrapper is omitted on export,
  with a diagnostic note. Recognized YAML wrapper provenance also includes
  `version="1.2"` and `support="limited"`; those are omitted on export together
  with `source=|YAML|`. TOML also recognizes `version="1.0"` alongside
  `source=|TOML|`. Unrecognized metadata values are retained and validated. Other attributes or explicit datatypes are rejected
  when the selected output cannot preserve them in lossless mode.
- Diagnostics warn about exact member names reserved by the standard JSON/node
  materializers (`@`, `$`, `$node`, `$children`, `__proto__`, `constructor`,
  `prototype`). These remain valid AEON data; conversion preserves them and
  each materializer remains responsible for its own output/runtime protections.
- JSON preserves arbitrary numeric lexemes. It rejects nodes, symbols, temporal
  values, toggles, references, named null reasons and other unsupported values.
- YAML exports the same JSON-compatible value domain using block mappings and
  sequences, within the existing experimental YAML adapter profile.
- TOML requires an object root and rejects null. Nested objects use inline tables;
  ordinary temporal values and explicit integer radix bases 2/8/16 are supported.
  Binary/octal/hex export uses `0b`/`0o`/`0x` and preserves the radix base and
  leading zeros. Signed 64-bit integer limits apply on import/export. Other
  explicit datatype claims remain outside the lossless export profile.
- XML requires the adapter's node mapping. Element attributes and text stay
  strings. Declaration metadata is supported for UTF-8 XML. CDATA boundaries are preserved as `:cdata` string children. Formatting
  and comments are not preserved.
- ALOG requires nonempty scalar record lists. It preserves scalar values accepted
  by the existing ALOG adapter and rejects nested containers or annotations.
- AEON output uses the adapters' renderer. Unsupported constructs, including
  generic datatype rendering, produce a diagnostic rather than a lossy result.

Auto-conversion, examples for each format, UTF-8 file loading, copy and download
are available. Source size is limited to 1 MiB. Failed or changed inputs clear
stale output and disable swap/copy/download until a new conversion succeeds.
Ctrl/Cmd+Enter converts manually. Drafts are retained in memory per input format;
changing the target format never replaces source text.

## Verification

`npm run test:adapters` includes reverse-conversion tests for every supported
format, native and wrapped AEON roots, exact numbers, rejection of lossy outputs,
and local HTTP request boundaries. It needs loopback listening permission for
HTTP tests. Compiler-dependent tests visibly skip if a compatible local compiler
is absent; starting the playground reports an actionable error in that case.

The visual layout follows `aeon-website/html/playground.php` and the playground
rules in `aeon-website/html/assets/css/site.css`. This page is standalone and
shares tooling's existing AEON highlighter through a fixed server asset route.

See the [language feature support matrix](../../../docs/format-adapter-support.md)
for coverage by format and the CDATA representation/whitespace contract.

When the input is AEON, **Load example** selects a source suited to the current
output format: an XML node document (including CDATA) for XML, scalar record lists
for ALOG, and suitable object data for JSON/YAML/TOML. Changing the output selector
alone preserves the user's source. Diagnostics name the selected output profile;
for example, a date rejected by lossless YAML suggests selecting lossy mode to
export it as a string.

## Example catalogue

The Example menu contains 30 scenarios across JSON, XML, TOML, YAML, ALOG and
AEON. Each format includes several supported-feature samples. External-format
catalogues also include AEON export examples and comparisons that reject
unsupported scalar types in lossless mode but stringify them in lossy mode.

Examples cover nested collections, array/scalar roots, exact numbers, Unicode
and unusual keys; XML declarations, mixed content, entities and CDATA; TOML
tables, radix values, temporal types and multiline text; YAML collections, block
text and Core schema resolution; and ALOG duplicate/variable-width records,
comments and scalar families.

Selecting an example previews its route, feature description and expected outcome
in both modes without editing the source. **Load example** applies the displayed
input/output route and source, then converts it. It keeps the currently selected
mode: switch modes to compare exactly the same document. Supported-feature and
mode-comparison entries appear in separate menu groups. Browsing examples never
automatically switches modes or edits a draft.

With AEON input, the menu is scoped to the selected output format and initially
prefers an example suitable for that route. After loading a comparison, its
expected outcomes remain visible. Changing the output format alone still leaves
the editor unchanged. The browser and regression suite share the same catalogue;
every example is checked in both modes against its advertised outcome.

### TOML integer and radix boundaries

The target is TOML 1.0.0, identified by `version="1.0"` on imported wrappers.
Decimal integers must be in `[-9223372036854775808, 9223372036854775807]`.
Binary/octal/hex spellings are nonnegative and limited to the positive endpoint.
Import rejects overflow with `TOML_INTEGER_OUT_OF_RANGE` in either mode. Export
rejects overflow in lossless mode; lossy export converts the AEON value to a
string. Integer checks use exact BigInt arithmetic, not host Number rounding,
and do not apply to decimal float/exponent forms.

Hex import normalizes digits to uppercase for the case-sensitive AEON radix
alphabet. Reverse radix export validates the explicit base/digits and preserves
leading zeros. It does not infer a base for untyped radix payloads, reinterpret
negative/fractional radix payloads, or silently discard additional metadata.

TOML reverse export uses TOML-specific string/key escaping, including `\u007F`.
TOML dates and datetimes use the adapter's strict year range `0001`–`9999`;
year `0000` is rejected with `TOML_UNSUPPORTED_YEAR` before any AEON output, even
in lossy mode. This is an explicit adapter policy, not a claim of unrestricted
temporal conformance. String values containing that text remain strings.

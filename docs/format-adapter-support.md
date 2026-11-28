# Format adapter feature support

This is the current implementation support inventory for
`converters/format-adapters/`, including reverse exports in the local playground.
It describes tested capabilities and explicit restrictions, not certification of
complete language conformance. Imported package READMEs also contain historical
native-profile descriptions; this inventory describes the current defaults.

## Conversion modes

The playground offers **Lossless** (default) and **Lossy** export modes. The
per-format tables below describe lossless behavior. "Lossless" refers to the
supported mapped values; documented lexical losses still apply.

In lossy mode, scalar families and explicit scalar datatype annotations that the
target exporter cannot preserve become strings. Existing string payloads remain
unchanged; other scalars use their canonical AEON value spelling without datatype
annotations (`|active|` becomes `"|active|"`, `on` becomes `"on"`). Supported scalar
types, exact numeric text and object/list/node structure are retained. TOML
retains native temporal and special-float types. XML can stringify element
attributes and ordinary element text. Declarations, comments and processing
instructions require their defined string fields in both modes. ALOG retains
its supported scalar families.

Diagnostics identify lossy mode and report affected paths/types. Reverse
conversion does not reconstruct original scalar types from strings. Unsupported
structures, references, arbitrary attributes and container datatypes still fail;
lossy mode does not bypass source validation or materializer protections. Forward
adapter library APIs are unchanged. See [mode details and examples](../converters/format-adapters/playground/README.md#lossless-and-lossy-modes).

## Common behavior

- Import produces portable AES and can render it as AEON or Telex. The complete
  source root uses an ordinary empty key `""` for JSON, TOML, YAML and ALOG. XML
  uses a tagged `xml` wrapper and an optional `"?xml"` declaration node.
- `source=|JSON|`, `|XML|`, `|TOML|`, `|YAML|` or `|ALOG|` identifies provenance.
  `sourceMetadata: false` omits adapter provenance, not source-authored data.
- Root mode accepts empty string members. Duplicate decoded keys, malformed
  source and unsupported constructs fail rather than being renamed or coerced.
- Member names such as `$`, `@` and `__proto__` remain data. The playground warns
  about standard JSON/node materializer collisions; each materializer still
  protects its own runtime and output representation.
- Numeric adaptation avoids conversion through JavaScript Number serialization.
  Semantic values may retain precision beyond common host numeric types.
- Source formatting is generally normalized. The XML adapter preserves comments,
  processing instructions and CDATA boundaries as described below.
- Imports are finite-document conversions, except ALOG's additional pull stream.
  Configurable resource limits apply to input, structure, paths, events and
  applicable strings/numbers/collections. Playground input is limited to 1 MiB.
- Reverse converters live in the playground conversion service. They are
  restricted exporters, not independent public package APIs. Unsupported AEON
  values/attributes/datatypes produce diagnostics instead of silent loss.

## JSON

Target: ordinary JSON syntax, with an explicit duplicate-key rejection policy.

| Feature | Import into AEON/AES | Reverse export in playground |
|---|---|---|
| Objects, arrays, nested combinations | Supported | Supported |
| Strings, numbers, booleans, null | Supported | Supported; ordinary `!none` maps to null |
| Object, array or scalar root | Supported under `""` | Supported by unwrapping `""` |
| Empty/unusual member names | Preserved | Preserved with JSON escaping |
| Large integers, decimals, exponent notation | Exact lexeme-based normalization | Exact numeric text, without host-number rounding |
| Unicode/escapes | Decoded; invalid UTF-8 and lone surrogates rejected | Strings escaped as JSON |
| Leading UTF-8 BOM | Accepted and ignored | Not emitted |
| Duplicate decoded keys | Rejected | AEON Core already rejects duplicate assignments |
| Comments, trailing commas, unquoted keys | Rejected | Not emitted |
| AEON nodes, references, temporal values, symbols, toggles, named null reasons | Not JSON constructs | Rejected |
| Extra AEON attributes or explicit datatypes | Not JSON constructs | Rejected, apart from recognized adapter provenance |

This exporter preserves the source-format value domain. It is not the standard
AEON JSON materialization profile, which has additional projections and key
reservations. JSON output containing very large numbers may exceed a later
consumer's numeric precision even though the text remains exact.

## TOML

Target: [TOML 1.0.0](https://toml.io/en/v1.0.0), declared as `version="1.0"`
alongside `source=|TOML|` on the imported wrapper. This is a support inventory,
not a claim of complete TOML conformance.

| Feature | Import into AEON/AES | Reverse export in playground |
|---|---|---|
| Root table, named tables, dotted keys, implicit parents | Supported; assembled before emission | Object root required; emits key/value assignments |
| Inline tables, arrays, arrays of tables | Supported | Nested objects become inline tables; arrays preserved |
| Basic/literal strings, multiline forms and escapes | Supported | Normalized quoted strings |
| Booleans, decimal integers and floats | Supported | Supported |
| Binary/octal/hex integers and digit separators | Supported as typed radix values; hex digits normalized to uppercase | Explicit base 2/8/16 integers export as `0b`/`0o`/`0x`, preserving the base and leading zeros |
| Local dates, times, local/offset datetimes | Supported without inventing a timezone; date/datetime years restricted to 0001–9999 | Supported within the same year policy |
| Infinity and NaN | Supported | Supported with normalized spelling |
| Quoted and empty keys | Supported in root mode | Quoted keys emitted |
| Comments and original table/quote layout | Accepted, discarded | Not reconstructed |
| Duplicate keys, illegal table redefinitions, extension of sealed inline tables | Rejected | Validated through the TOML importer |
| Null, arbitrary scalar/list document roots | Not TOML constructs | Rejected |
| Signed 64-bit integer bounds | Enforced exactly for decimal and all radix forms | Enforced in lossless mode; lossy mode stringifies out-of-range AEON integers |

Date and datetime years are deliberately restricted to `0001` through `9999`,
aligned with AEON Core. Year `0000` fails explicitly with `TOML_UNSUPPORTED_YEAR`
on import in both modes; it is not silently converted to a string. This is an
adapter policy restriction. Quoted strings containing `0000` remain ordinary
strings. Reverse export uses TOML-specific escaping for both values and quoted
keys, including `U+007F` as `\u007F`.

The integer range is `-9223372036854775808` through `9223372036854775807`.
TOML binary/octal/hex spellings are unsigned, so their maximum is the positive
endpoint; they are never treated as two's-complement bit patterns. Decimal float
and exponent spellings are not subject to the integer-only range check.

Reverse radix export requires an explicit AEON radix base of 2, 8 or 16 (including
compatible `radix2`/`radix8` aliases). Untyped radix payloads, other bases,
fractions, signed radix payloads and invalid digits remain unsupported in lossless
mode. Hex import converts TOML's case-insensitive digits to AEON's uppercase
radix alphabet; original case/underscore placement is not retained. Additional
attributes and generic datatype claims are not discarded to make values fit.

## YAML

Target: **a restricted YAML 1.2 adapter using the official Core schema for type
resolution**. Core schema is not a language-feature subset or a claim that our
restrictions are official YAML conformance levels.

Wrapper metadata includes `source=|YAML|`, `version="1.2"` and
`support="limited"`. `limited` is our adapter coverage label.

| Feature | Import into AEON/AES | Reverse export in playground |
|---|---|---|
| Block/flow mappings and sequences | Supported; mapping keys must be strings | Block mappings/sequences |
| Plain, single-quoted and double-quoted strings | Supported | Quoted scalars |
| Literal/folded block text, indentation/chomping controls | Resulting string preserved | Normalized escaped quoted strings; original style not retained |
| Null, boolean, decimal integer/float, exponent, hex/octal integers | Supported with exact numeric adaptation | JSON-compatible scalar domain; radix spelling not retained |
| Mapping, sequence or scalar root; empty document | Supported; empty document maps to null | Supported |
| Quoted empty keys and empty strings | Supported | Supported |
| `yes`, `no`, `on`, `off`, date-shaped plain values | Strings under Core resolution | Strings remain strings |
| Comments and a single document's markers | Accepted, discarded | Comments/markers not reconstructed |
| Anchors, aliases, shared identity and cycles | Rejected | Not emitted |
| Explicit custom scalar tags | Decoded strings plus path-targeted `yaml.tag(...)` semantic comments; no datatype mapping | No tag reconstruction; annotated inputs require an annotation-aware exporter |
| Standard tags and tagged collections/keys | Rejected, including `!!str` | Not emitted |
| Non-string/complex keys, merge key `<<` | Rejected | Rejected |
| Multiple-document streams and YAML 1.1 directives | Rejected | One document only |
| Infinity and NaN | Rejected despite being part of Core schema | Rejected |
| Duplicate decoded keys | Rejected | Unique members only |
| AEON-specific nodes, temporal types, references, symbols, attributes/datatypes | No mappings in this profile | Rejected apart from recognized wrapper provenance |

[Official Core schema definition](https://yaml.org/spec/1.2.2/#103-core-schema).

Custom-tag import preserves a separate annotation channel in library, CLI and
playground AEON output. See the [YAML guide](../converters/format-adapters/yaml-core/README.md#custom-scalar-tags-as-semantic-comments)
for resolved namespaces and decoded-content preservation. AES/Telex-only APIs
reject tagged input; canonicalization discards comments unless annotations are
retained separately and reattached. The playground rejects other output routes
for tag-annotated inputs. No constructors, type mappings or tag-aware reverse
exporter are provided; ordinary source formatting and comments are not retained.

## XML

Target: XML 1.0 elements/attributes/character data with an ordered node mapping.
Namespace spelling is preserved; this is not a namespace-aware expanded-name
implementation or a full validating XML processor.

| Feature | Import into AEON/AES | Reverse export in playground |
|---|---|---|
| One document element, nested/repeated elements | Tagged `NodeLiteral` records under an ordered `xml` wrapper | Requires the `xml` wrapper and one document element |
| Element attributes | String attributes on their tagged element | String attributes, escaped appropriately |
| Mixed text and child elements | Ordered indexed children | Ordered text/nodes |
| CDATA sections, including empty and adjacent sections | Separate `StringLiteral` children with datatype `cdata` by default | Typed children emit `<![CDATA[...]]>` |
| XML declaration: version, encoding, standalone | Attributes on the separate `"?xml"` root node | Declaration emitted first with UTF-8 text output |
| Qualified names and `xmlns` declarations | Lexical names/declarations preserved | Preserved; no namespace URI/prefix resolution |
| Five predefined entity references and numeric character references | Decoded to strings | Escaped output; original reference spelling not retained |
| Whitespace | Leaf text retained; default inter-element formatting whitespace may be pruned/trimmed | Accepted text payloads preserved; dropped source whitespace cannot be recovered |
| `xml:space="preserve"`, `preserveWhitespace: true` | Preserve ordinary inter-element text; XML newline normalization still applies | Ordinary text uses character references where needed |
| Comments | `"!--"` nodes with one string child | Preserved before, after and inside the document element |
| CDATA delimiters under `preserveCdata: false` | Previous semantic-only mode: CDATA/text coalesce | Original boundaries cannot be recovered |
| DTDs and declared/external entities | Rejected; never fetched | No DTD/entity declarations emitted |
| Processing instructions | `"?target"` nodes with an optional data string | Repeated targets and their order are preserved |
| XML 1.1, malformed names/tags/attributes, unknown entities, multiple roots | Rejected | Reparsed by the XML importer before returning |

### CDATA representation and whitespace

`cdata` is an adapter-specific datatype claim on an ordinary string, not a new
AEON Core literal family or a general-purpose opaque XML type. It records a
serialization boundary so the XML exporter can distinguish CDATA from ordinary
text. It does not mean executable code or imply a programming language.

```aeon
<"?xml"@{version = "1.0"}>
<xml@{source = |XML|}(
  <person@{id = "42"}(
    <name("Alice")>,
    <active("true")>,
    :cdata = `

    if (a < b && c > d) {
      return "<success>";
    }
`
  )>
)>
```

Untrimmed backticks preserve the leading/trailing blank lines and indentation
in this example. They still follow AEON escape rules: escape literal backslashes
and backticks when authoring them. Do not use trimticks (`>` plus backtick) for
exact CDATA payloads: trimticks normalize surrounding whitespace and indentation.

Canonical adapter rendering uses `:cdata = "...\n..."` with escaped string content
instead of raw multiline layout. Both spellings compile to the same typed
`StringLiteral`; switching spellings does not erase the CDATA marker or payload.
`:prose` is not interpreted as CDATA: it cannot identify the original XML boundary.

Each imported CDATA section is kept separately from surrounding text and other
CDATA sections, including empty sections. XML-mandated CRLF/CR-to-LF normalization
still happens during import. The exporter splits an authored payload containing
`]]>` into adjacent legal CDATA sections. Authored carriage returns inside a
`:cdata` payload are rejected because XML would normalize them; use ordinary
text with character references if those characters must survive.

Use `{ preserveCdata: false }` or `--semantic-cdata` to coalesce CDATA and text.
`mapping: 'native'` omits wrapper provenance and keeps CDATA boundaries. The unit
suite exercises both CDATA modes.
Existing AEON that already lost its CDATA markers cannot recover those boundaries.

## &LOG v1 / ALOG

Target: the provisional `&LOG v1` scalar-record format.

| Feature | Import into AEON/AES | Reverse export in playground |
|---|---|---|
| `&LOG v1` header | Required for standalone input | Emitted |
| Headerless externally versioned context | `requireHeader: false` | No UI option; header emitted |
| Comma-separated scalar fields, varying field counts | Supported | Nonempty scalar record lists required |
| Duplicate records and ordered records/fields | Preserved | Preserved |
| AEON strings, numbers, booleans, nulls, symbols, applicable temporal and other scalar families | Validated by the pinned AEON 0.16 compiler | Supported within its scalar domain, without extra attributes/datatypes |
| LF/CRLF records and complete final record without newline | Supported | LF output |
| Blank lines and ordinary line/block comments | Accepted; comments never merge physical lines | Not reconstructed |
| UTF-8 byte chunks, bounded output batches and backpressure | Supported by `alogToAesStream` | Finite text output only |
| Empty log | Supported as an empty outer list | Header-only document |
| Empty fields, trailing commas, containers, assignments | Rejected | Rejected |
| Literal multiline/backtick/trimtick fields, semantic comments, explicit scalar annotations | Rejected | No such syntax emitted |
| Lone CR, incomplete final strings/comments, malformed UTF-8 | Rejected | Not emitted |

Whole records validate before emission. Streaming output remains provisional
until clean completion; cancellation and errors do not mean successful completion.

## AEON in the playground

Parsing uses a local AEON compiler with empty-key bindings and intrinsic node
tags. See [playground setup](../converters/format-adapters/playground/README.md).

The adapter renderer covers its mapped object, list, node and scalar domain.
A node uses its intrinsic tag as the key at the root, in objects and in attribute
blocks. Indexed children retain their order and may repeat tags. Identity,
attributes and supported datatypes render on the declaration. Anonymous
datatype and attribute heads are preserved, including `:cdata` on a string
child.

Path-targeted string annotations render on supported scalar bindings and indexed
children. The renderer reports an error for annotation paths in attribute
structures that Core cannot reliably reconstruct, including named fields below
an attribute node and children of a typed container in an attribute scope.

Generic datatypes, tuples and references require the full AEON canonicalizer.
Each external exporter enforces its own representability restrictions above.
Plain JSON, YAML and TOML output have no mapping for AEON nodes.

## Verification

`npm run test:adapters` covers legacy/default mappings, sibling Core/AEOS/SANSA
integrations, numeric precision, malformed inputs, resource limits, reverse
conversions and local HTTP boundaries. CDATA tests cover adjacent/empty sections,
mixed content, blank lines, backslashes/backticks, Unicode, XML newline handling,
canonical AEON/Telex parity, reverse export and delimiter splitting. Optional
sibling integration tests visibly skip when their built runtimes are unavailable.
A passing local suite does not imply full official JSON/TOML/YAML/XML test-suite
coverage.

## Interactive examples

The local playground's Example menu provides several feature samples for each
format and shared-source comparisons of lossless versus lossy export. Each
scenario states its input/output route and both expected outcomes before loading.
It includes exact-number/Unicode/root examples, XML CDATA and mixed content,
TOML tables/temporal values, YAML text styles/type resolution and ALOG records.
See the [catalogue instructions](../converters/format-adapters/playground/README.md#example-catalogue).

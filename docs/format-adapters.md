# Format adapters: root mapping and ALOG v1 implementation proposal

Status: implemented candidate, 2026-11-16. This records implementation choices;
related ecosystem proposals remain provisional. No package publication is implied. See the [feature support matrix](format-adapter-support.md)
for current language coverage and the XML CDATA mapping.

## Location and migration

Maintain the adapters in `converters/format-adapters/`, alongside other tooling
converters. Imported from the `format-adapters` repository at commit `4dd748c`
(Initial commit), preserving its tracked source and licenses. The original checkout
retains its Git history and a relocation README; its former tracked source is
removed. Review and commit the destination and relocation together. No Git history
was rewritten and no repository was nested inside tooling.

## Root and source metadata

All adapters default to a root-preserving mapping, including TOML:

```aeon
""@{source = |JSON|} = {
  name = "Alice"
}
```

JSON arrays and scalars use the same boundary; XML puts its existing NodeLiteral
at that boundary. ALOG maps to a list of record lists. The source attribute is an
ordinary SymbolicLiteral owned by the empty-key binding, never an XML element
attribute or an imported object's field. Values are `JSON`, `XML`, `TOML`, `YAML`
and `ALOG`. It records provenance, not an authoritative format discriminator.
Exporters must still be explicitly selected and validate their supported values.
Set `sourceMetadata: false` to omit it, for example for cross-format equivalence.

Portable AES has no event at `$`: emit the value at `$.[""]`, then its source
attribute, then descendants. Empty source keys remain ordinary nested keys and
must still be unique. Paths, schemas, queries and materializers must account for
this extra member segment. Wrapper and metadata events count toward limits.

This is an intentional default change for these experimental adapters. Existing
JSON/TOML object-root consumers can select `{ mapping: 'native' }`; XML can select
the same option for its former `xml` binding. CLI equivalents use `--native`.
XML also retains its explicit `rootName` / `--root` override. Legacy JSON/TOML
mode retains its original empty-key restrictions for compatibility. New code
should use root mode. Reverse adapters and automatic format detection are outside
this change.

## ALOG v1 decisions

`alog-core` implements standalone `&LOG v1`, ordinary AEON scalar fields,
comma separation, physical LF or CRLF records, ordinary comments, duplicate
records and varying field counts. Final finite EOF may complete a record.
Lone CR, missing/trailing fields, containers, assignments, multiline/backtick
text, semantic comments and explicit scalar annotations are rejected.
`requireHeader: false` is an explicit external-version-context option.

The parser delegates scalar validation and portable projection to the published
AEON Core 0.17.0-rc.2 compiler from the exact public RC graph, rather than implementing another scalar grammar.
Empty wrapper keys are produced directly as portable AES; the compiler never
needs to parse them. Integration checks use the selected public RC compiler in
the documented sibling layout. This is distinct from standalone adapter
packaging and from later stable adoption.

`alogToAes` validates the entire finite input before returning. `alogToAesStream`
accepts a byte iterable and yields bounded event batches under backpressure.
It buffers the pending physical line, lexical state, counters and current record;
it does not retain previous records. UTF-8 and CRLF can cross chunks. Each record
validates in full before any of its assignments are yielded. A temporary chunk
boundary does not commit a pending line. Clean completion is iterator `done`,
parse/input failure throws, and cancellation is iterator `return`. Earlier output
is provisional until clean completion. Record boundaries may cross output batches.
Consumers retaining a valid prefix after failure must choose that policy explicitly.

Limits cover total input bytes, physical line bytes, records, fields, events and
batch events. Producers should supply bounded input chunks. Infinity is allowed
for cumulative limits, but output batches must remain finite. Cancellation does
not produce successful finalization. Recovery and a source-format writer are
outside this converter implementation.

## Experimental YAML profile

`yaml-core` uses the `yaml` v2 document AST with YAML 1.2 Core schema resolution.
Its wrapper declares `source=|YAML|`, `version="1.2"` and `support="limited"`.
The support label describes our restricted adapter, not an official YAML level.
`sourceMetadata: false` omits all three attributes; all otherwise count toward
configured event, key, string and path limits. It accepts
one document containing mappings with string keys, sequences and ordinary scalars,
including block text and any root kind. Empty documents map to null. Quoted values
stay strings; `yes` and date-shaped text stay strings. Integer and decimal lexemes
are adapted without passing through JavaScript Number serialization.

Custom scalar tags become decoded strings plus path-targeted semantic comments
using the adapter convention `yaml.tag("resolved identity")`. No datatype mapping
or custom constructor is involved. YAML namespace directives resolve before the
identity is recorded; names outside AEON type syntax remain annotation text.
`yamlToAesWithAnnotations` returns `{ records, annotations }`; `yamlToAeon` renders
both. AES/Telex-only APIs reject tagged input rather than silently losing tags.
Canonical AEON discards comments, so preserve the side channel separately when
canonicalizing. The [YAML adapter guide](../converters/format-adapters/yaml-core/README.md#custom-scalar-tags-as-semantic-comments)
documents value preservation, namespaces, mode requirements and CLI output.

Reject anchors/aliases, standard explicit tags, tagged collections/keys, merge
keys, complex/non-string keys, duplicates, multiple documents, YAML 1.1 directives
and untagged nonfinite floats. These are declared profile limits, never silent
expansion or coercion. Ordinary source comments, styles,
whitespace and numeric spelling are not preserved. Graph/reference support and
multi-document policies require separate proposals.

Sources: [YAML parser document API](https://eemeli.org/yaml/#documents),
[YAML 1.2.2 specification](https://yaml.org/spec/1.2.2/).

## Validation and limits of evidence

Run `npm run install:adapters` followed by `npm run test:adapters` at repository
root. The existing native-profile vectors are retained explicitly. New vectors
exercise default roots and provenance, nested empty keys, duplicate rejection,
resource limits, exact YAML numbers, unsupported YAML constructs, ALOG comments,
record atomicity, backpressure, malformed EOF and every two-chunk byte split of
a UTF-8/CRLF fixture. Local sibling integrations remain optional and visibly skip
when unavailable. Default mapping is checked against the built sibling 0.17 Core
by recompiling emitted AEON and comparing portable Telex in source key order.
This does not claim full YAML test-suite coverage or general XML lexical fidelity.

Local verification on 2026-11-16: 100 adapter tests passed with zero skips,
including default-wrapper AEOS acceptance/rejection and SANSA queries at
`$.[""]`. The full tooling command additionally passed 11 browser tests and
3 Markdown converter tests. `git diff --check` passed. The repository cleanup
check reports installed node_modules and generated build/local files (including
pre-existing files outside these adapters); no unrelated cleanup was performed.

## XML CDATA preservation update

XML import now preserves each CDATA section as a separate StringLiteral child
with the adapter-specific `cdata` datatype. Canonical AEON renders its anonymous
`:cdata = "..."` head, and XML export restores CDATA delimiters. This supersedes
the historical semantic-only mapping. `preserveCdata: false` / `--semantic-cdata`
retains the former coalesced-text behavior explicitly. See the
[CDATA contract](format-adapter-support.md#cdata-representation-and-whitespace)
for whitespace, delimiter escaping and compatibility limits.

## TOML 1.0 radix and integer-range update

TOML wrappers now declare `source=|TOML|` and `version="1.0"` for the TOML 1.0.0
syntax target. The playground recognizes that provenance during reverse export.
Import/export enforce signed 64-bit integer bounds using exact arithmetic.
Explicit unsigned AEON integer radix bases 2/8/16 export losslessly as TOML
binary/octal/hex values. Hex import normalizes to the uppercase AEON radix
alphabet. See the [support inventory](format-adapter-support.md#toml) for the
remaining restrictions and lossy overflow behavior.

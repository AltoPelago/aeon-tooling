See the [current language feature support matrix](../../../docs/format-adapter-support.md) for import/export coverage and limitations.

# YAML adapter

See the [implementation proposal](../../../docs/format-adapters.md) for the
supported syntax, API contract, limits and verification boundaries.

Install with `npm ci --ignore-scripts` and run `npm test` in this directory.
The CLI accepts `--aeon`, `--records` or `--annotations`; default output is Telex.
Library entry: `src/index.js`, exporting `yamlToAes`, `yamlToAesWithAnnotations`,
`yamlToAeon`, `yamlToTelex`, `aesToAeon` and `encodeTelex`.

Imports declare the YAML version and the adapter's coverage on the wrapper:

```aeon
""@{source = |YAML|, support = "limited", version = "1.2"} = {
  name = "Alice"
}
```

`version` identifies the source language version. `support="limited"` is our
adapter coverage marker, not an official YAML conformance level. The adapter
uses the official Core schema for scalar resolution with additional restrictions.
`sourceMetadata: false` omits all three provenance attributes.

## Custom scalar tags as semantic comments

Custom scalar tags are preserved automatically as structured annotation comments,
without a mapping configuration or custom AEON datatype claim:

```yaml
created: !CustomDate 2026-11-16
```

The resulting transport document contains:

```aeon
""@{source = |YAML|, support = "limited", version = "1.2"} = {
  created = /@ yaml.tag("!CustomDate") @/ "2026-11-16"
}
```

`yaml.tag(<JSON string>)` is an adapter-defined annotation convention, not a Core
instruction or type declaration. The inline block form attaches to the actual
scalar path, including anonymous list elements. Applications may inspect the
annotation and choose their own interpretation. No custom constructors run.

### Values and namespace identities

Tagged scalar content is retained as decoded text. Dates do not become host Date
objects; tagged `00123`, `true`, `null` and empty scalars become strings `"00123"`,
`"true"`, `"null"` and `""`. YAML escapes, block folding/chomping and physical
newline decoding apply before preservation; original quoting and formatting are
not retained. Untagged values keep YAML 1.2 Core resolution and exact numeric
handling. Application validation and materialization remain application concerns.

Tags need not fit AEON identifier syntax. Names such as `!custom-date`,
`!acme/date`, `!ruby/object:Set` and URI tags are retained as annotation text.
Namespace directives resolve before recording the tag:

```yaml
%TAG !app! tag:example.com,2026:
---
created: !app!CustomDate 2026-11-16
```

This records `yaml.tag("tag:example.com,2026:CustomDate")`, as does the verbatim
`!<tag:example.com,2026:CustomDate>` form. A primary `%TAG !` override is also
respected. The local identity `!CustomDate` remains distinct from a global URI.
We preserve the resolved identity exposed by the YAML document AST, without
stripping namespace prefixes, URL-normalizing tags or inventing `ns` attributes.
Original handle spellings and directives are presentation details, not retained.
JSON escaping protects tag content, including block-comment delimiter characters.

Standard `!!` tags, tagged collections/keys, anchors, aliases, malformed directives
and unresolved handles remain unsupported. Ordinary source comments are not
converted into these generated tag annotations.

### Annotation side channel

Use the combined API when tag identity matters:

```js
import { yamlToAesWithAnnotations, aesToAeon } from './src/index.js';

const { records, annotations } = yamlToAesWithAnnotations(
  'created: !CustomDate 2026-11-16'
);
const text = aesToAeon(records, { annotations });
```

The value record is ordinary `StringLiteral` data with no datatype. The parallel
annotation descriptor is:

```json
{
  "kind": "annotation",
  "form": "block",
  "raw": "/@ yaml.tag(\"!CustomDate\") @/",
  "target": { "kind": "path", "path": "$.[\"\"].created" }
}
```

These are path-targeted, span-free adapter descriptors, not source-position claims.
Compiling the rendered AEON produces the normal annotation stream with AEON
source spans. `sourceMetadata: false` omits the wrapper's provenance attributes,
not tag annotations. Tags and decoded values obey `maxStringCodepoints`; AES
records and generated annotations together count against `maxEvents`.

`yamlToAeon` retains comments automatically. AES-only `yamlToAes` and Telex-only
`yamlToTelex` reject tagged input with `YAML_ANNOTATIONS_REQUIRED`; plain AES or
Telex cannot carry this side channel. Untagged inputs retain their existing API
and output behavior. The old `tagMappings` option and `--tag-map` flag are removed;
passing them fails rather than being silently ignored.

Bare canonical AEON generation discards comments. To preserve tag identity across
canonicalization or portable AES/Telex storage, retain the annotations alongside
the records and render with `aesToAeon(records, { annotations })` afterward.
Rendering with annotations is annotated source, not bare canonical text. Exact
values and semantic AES remain unchanged. Preservation covers tag identity and
decoded scalar content, not original YAML formatting or unknown custom semantics.

The playground retains these annotations for YAML → AEON and AEON → AEON.
Other output routes reject tagged input because their exporters are not annotation
aware. YAML tag reconstruction is not implemented; keeping the side channel makes
it possible for an application to implement that explicitly.

### AEON modes and CLI

The renderer still emits `mode = "transport"`. Comments introduce no custom
datatype or additional mode requirement. The adapter does not generate a fully
typed strict/custom document; explicit `mode: 'strict'` or `'custom'` requests fail.
With `includeHeader: false`, the caller supplies a compatible surrounding mode.

```sh
node bin/yaml-aes.js --aeon input.yaml
node bin/yaml-aes.js --annotations input.yaml
```

`--annotations` writes a JSON object containing `records` and `annotations`.
`--records` writes only the AES array; default output is Telex. Those last two
routes reject tagged input. Omit the input filename to read stdin. All output
modes fail closed without emitting partial stdout on conversion errors.

# XML adapter

`@altopelago/xml-core` imports XML 1.0 strings as tagged AEON nodes, portable AES
records and canonical `telex.aes=1`. A document always has an `xml` wrapper with
ordered children. The optional declaration is a separate `"?xml"` root node.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<?application mode="debug"?>
<person source="publisher"><name>Alice</name></person>
<?application done?>
```

```aeon
<"?xml"@{encoding = "UTF-8", version = "1.0"}>
<xml@{source = |XML|}(
  <"?application"("mode=\"debug\"")>,
  <person@{source = "publisher"}(<name("Alice")>)>,
  <"?application"("done")>
)>
```

| XML construct | AEON and portable AES |
| --- | --- |
| Document | Named `NodeLiteral` at `$.xml`, with one element and any surrounding comments and processing instructions as indexed children. |
| Declaration | Named `NodeLiteral` at `$.["?xml"]` with string attributes `version`, `encoding`, and `standalone` as authored. XML export places it first regardless of AEON binding order. |
| Element | `NodeLiteral` with its XML name in `tag`. Attributes and indexed children are directly below the node path. |
| Processing instruction | Indexed node tagged `?` followed by the XML target, with one string child for non-empty data. Target names may repeat before, after or inside the document element. |
| Comment | Indexed node tagged `!--`, with one string child. Empty comments retain an empty string. |
| Character data and CDATA | Ordered strings, with a `:cdata` datatype for each CDATA section by default. |

In the example, the person is at `$.xml[1]`, its `source` attribute is at
`$.xml[1].@.source`, and Alice is at `$.xml[1][0][0]`. A tag-aware SANSA
namespace, such as the AEON SDK namespace, can find the processing instructions
with `$.xml.*&tag("?application")` regardless of their indices. Repeated
elements remain separate indexed children.

Processing instruction data stays opaque. The adapter removes the XML whitespace
separator before the data and normalizes physical line endings. Element and
attribute names retain their qualified spelling. The adapter uses XML 1.0
character, comment and declaration rules and accepts predefined and numeric
character references. DTD and entity declarations are rejected with
`XML_DTD_FORBIDDEN`. [XML 1.0](https://www.w3.org/TR/xml/)

Attribute values and text remain strings after XML reference and whitespace
normalization. `preserveWhitespace: true` preserves inter-element whitespace
and `xml:space` controls it within the document. `preserveCdata: false` or CLI
`--semantic-cdata` coalesces CDATA with adjacent character data. The adapter
reports invalid syntax and resource limits with source locations and paths.
Source offsets count UTF-16 code units. Columns count Unicode scalar values.

## Import and export

```js
import { xmlToAes, xmlToAeon, xmlToTelex } from '@altopelago/xml-core';

const source = '<person source="publisher"/>';
const records = xmlToAes(source);
const aeon = xmlToAeon(source, { includeHeader: false });
const telex = xmlToTelex(source);
```

Default provenance is a symbolic `|XML|` attribute at `$.xml.@.source`.
`sourceMetadata: false` and `mapping: 'native'` omit it while keeping the
same node layout. `rootName` changes the import wrapper tag. The standard
playground XML export uses `xml`, removes wrapper provenance, and retains any
`source` attribute on an actual document element. Set `includeDeclarationMetadata` to
`false` to omit the declaration node during import. XML export writes UTF-8 text.

```sh
node bin/xml-aes.js --records examples/person.xml
node bin/xml-aes.js --aeon examples/person.xml
node bin/xml-aes.js examples/person.xml
node bin/xml-aes.js --native --semantic-cdata examples/person.xml
```

Use the [adapter playground](../playground/README.md) for AEON-to-XML export
and the [validation and query example](../examples/validate-and-query/README.md)
for AEOS and SANSA integration. The [feature support matrix](../../../docs/format-adapter-support.md)
describes the other formats.

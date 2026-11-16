See the [current language feature support matrix](../../../docs/format-adapter-support.md) for import/export coverage and limitations.

# Current XML adapter mapping

The default mapping now places the source root under `""` with
`source = |XML|` as a binding attribute. Pass `{ mapping: 'native' }`
(or CLI `--native`) for the previous mapping. Root mode accepts empty source keys;
JSON also accepts arrays and scalar roots. Set `sourceMetadata: false` to omit
provenance. See the [migration proposal](../../../docs/format-adapters.md).

CDATA boundaries are now preserved as separate `:cdata` string children by
default, including in native mapping. Set `preserveCdata: false` or CLI
`--semantic-cdata` for the former merged-text mapping. Canonical AEON uses quoted
strings; untrimmed backticks can also be authored without losing whitespace.

The reference below describes the **legacy native profile** and its original
pipeline evidence. Unqualified API calls now use the root mapping above.

---

# `@altopelago/xml-core`

Dependency-free strict XML 1.0 to AES (`aes.events.v1` / `aes.complete.v1`) and canonical `telex.aes=1` source-format adapter.

## Structural Mapping

XML's node-oriented model maps directly onto AEON/AES nodes (`NodeLiteral` + `NodeHead`), attributes (`.@.`), and ordered indexed children without artificial array wrapping or lossy object flattening:

| XML Construct | AES Representation |
| --- | --- |
| Document element | `NodeLiteral` bound to root member (`$.xml` by default) |
| XML declaration (`<?xml version="1.0" ...?>`) | `StringLiteral` attributes on root binding (`$.xml.@.version`, `$.xml.@.encoding`, `$.xml.@.standalone`) |
| Element name (`<person>`, `<user:name>`) | `NodeHead` at `<nodePath>[0]` with `value=<tagName>` |
| Element attributes (`id="123"`, `xmlns:user="..."`) | `StringLiteral` attributes on `NodeHead` (`<headPath>.@.id`, `<headPath>.@.["xmlns:user"]`) |
| Child elements | Ordered `NodeLiteral` children under `NodeHead` (`<headPath>[i]`) |
| Character data & `<![CDATA[...]]>` | Ordered `StringLiteral` children under `NodeHead` (`<headPath>[i]`) |
| Mixed content & repeated elements | Ordered indexed children under `NodeHead` (`<headPath>[0]`, `<headPath>[1]`, ...) |

## Core Adapter Principles

1. **No coercion:** XML attribute values and element character data are always emitted as `StringLiteral` (`"3.30"`, `"03"`, and `"2"` are never coerced into `NumberLiteral`).
2. **No repair:** Duplicate attributes, mismatched closing tags, invalid XML names, and unknown entity references are rejected with exact byte/line/column diagnostics.
3. **No silent data loss:** Significant character data, CDATA content, and exact lexical attribute strings are preserved without loss.
4. **No invented semantics:** XML element and attribute names never trigger hidden AEON header/directive semantics.
5. **No structural reinterpretation:** Repeated child elements and mixed text/element content remain ordered children under `NodeHead`.

## Security Controls

- **No XXE / Entity Expansion:** `<!DOCTYPE>` and `<!ENTITY>` declarations are strictly rejected (`XML_DTD_FORBIDDEN`).
- **Predefined & Numeric References Only:** Supports `&lt;`, `&gt;`, `&amp;`, `&apos;`, `&quot;`, decimal `&#...;`, and hexadecimal `&#x...;` (validated against XML 1.0 `Char` production). Unknown named entities are rejected (`XML_UNKNOWN_ENTITY`).
- **Aeonic Resource Limits:** Enforces `maxInputBytes`, `maxEvents`, `maxValueNestingDepth`, `maxPathDepth`, `maxPathCharacters`, `maxStringCodepoints`, `maxKeySegmentCodepoints`, and `maxNodeChildren`.

## Usage

```js
import { xmlToAes, xmlToTelex } from '@altopelago/xml-core';

const records = xmlToAes('<product price="3.30" quantity="2"><name>Paper</name></product>');
const telex = xmlToTelex('<product price="3.30" quantity="2"><name>Paper</name></product>');
```

### CLI

```bash
node bin/xml-aes.js examples/person.xml > examples/person.telex.aes
node bin/xml-aes.js examples/inventory.xml > examples/inventory.telex.aes
node bin/xml-aes.js --json < examples/person.xml
```

### With the Aeonite ecosystem

```bash
# SANSA query over repeated XML child nodes & attributes (from the sansa checkout)
npm run query -- --fixture ../format-adapters/xml-core/examples/person.telex.aes \
  --query 'from $.xml[0].*[0] where . == "purchase" select { item = .[0] price = .@.price }'
```

```js
// AEOS schema validation
import { validateTelex } from '@altopelago/aeon-aeos';
validateTelex(xmlToTelex(xmlText), {
  rules: [
    { path: '$.xml', constraints: { required: true, type: 'NodeLiteral' } },
    { path: '$.xml[0]', constraints: { required: true, type: 'NodeHead', pattern: '^person$' } },
    { path: '$.xml[0].@.id', constraints: { required: true, type: 'StringLiteral', pattern: '^[0-9]+$' } },
  ],
});
```

## Tests

```bash
npm test
```

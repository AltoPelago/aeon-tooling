> Historical investigation, imported unchanged below. For current behavior and the implemented candidate, see [the implementation proposal](../../docs/format-adapters.md).

Here's a preliminary proposal covering the broader adapter architecture, the findings for JSON, TOML, YAML and XML, and the unresolved questions. I've kept existing AES behaviour separate from proposed extensions, particularly YAML anchor mapping.

# Proposal: Source Format Adapters for the Aeonite Ecosystem

**Status:** Preliminary / Investigation\
**Scope:** JSON, TOML, YAML, XML and future external formats\
**Primary interface:** `aes.events.v1`\
**Related components:** AEON, AEOS, SANSA, Telex, Film

## 1. Summary

Introduce a family of source-format adapters that translate external data formats into AES assignment event streams.

AES is already the common representation at the heart of the Aeonite ecosystem. AEON is one language for expressing that representation, while Telex and Film provide additional representations and transport capabilities.

External adapters extend this architecture to established formats without requiring those formats to adopt AEON syntax or semantics.

The primary objective is to allow existing data to benefit from:

- AEOS schema validation.
- SANSA addressing, resolution and querying.
- Telex and Film representation and transport.
- AES integrity, provenance and downstream processing capabilities, where supported.

**The governing principle is that adapters preserve source meaning rather than inventing additional meaning.**

Adapters must not silently coerce, repair, restructure or reinterpret source values to make them compatible with AES.

Where a source format cannot be faithfully represented, the adapter must reject the unsupported construct or require an explicitly selected transformation.

## 2. Architectural Principles

### 2.1 AES is the common boundary

All supported source formats converge on `aes.events.v1`.

```
AEON ────────┐
JSON ────────┤
TOML ────────┤
YAML ────────┼──→ AES ──→ AEOS
XML ─────────┤          ├─→ SANSA
Other ───────┘          ├─→ Telex / Film
                        └─→ Materialisation
```

Downstream components should not require knowledge of the source format to process compatible AES events.

### 2.2 No implicit coercion

An adapter must preserve the types and meanings established by the source format.

Examples:

- A JSON string resembling a date remains a string.
- A YAML `yes` scalar under YAML 1.2 Core remains a string, not an AEON Toggle.
- An XML attribute containing `"3.30"` remains a string, not a decimal.
- A TOML date is mapped to an AEON date because TOML explicitly defines it as a temporal value.

No automatic inference of dates, custom types, references or domain-specific meanings is permitted.

### 2.3 AES invariants take precedence

A source document must satisfy the structural and identity requirements of the target AES representation.

Examples include:

- Unique binding identities.
- Non-empty object keys.
- Valid Unicode scalar values.
- Supported root structure.
- Valid event ordering and containment.

An adapter must not weaken AES constraints to accommodate a source format.

### 2.4 Reject rather than repair

Where a source construct cannot be faithfully represented, the default behaviour is rejection.

Adapters must not silently:

- Rename invalid keys.
- Resolve duplicate keys using first-wins or last-wins behaviour.
- Convert unsupported structures into invented object conventions.
- Replace unsupported references with copied values.
- Wrap incompatible root structures without an explicit rule.
- Infer types from string contents.

### 2.5 Separate parsing from transformation

Three responsibilities should remain distinct:

**Source parsing:** Recognise the source language and determine its declared structure and types.

**AES adaptation:** Translate compatible source constructs into AES events while enforcing AES invariants.

**Explicit transformation:** Apply user-declared mappings, coercions or structural changes where necessary.

The third responsibility is outside the scope of a generic adapter.

### 2.6 Semantic fidelity versus textual fidelity

Adapters should distinguish between:

- **Semantic fidelity:** Preserving the source format's represented values, types, identities and relationships.
- **Lexical fidelity:** Preserving original spelling, formatting, comments, whitespace and other source-level distinctions.

Canonical AES output may normalise lexical representation without changing meaning.

Where a format has meaningful lexical constructs that AES does not preserve, the adapter must document the limitation.

---

## 3. JSON Adapter

**Status:** Implemented and pipeline-tested.

JSON provides the simplest direct mapping into AES.

### 3.1 Value mapping

| JSON    | AES                   |
| ------- | --------------------- |
| Object  | ObjectNode            |
| Array   | ListNode              |
| String  | String                |
| Number  | Number                |
| Boolean | Boolean               |
| `null`  | NullLiteral (`!none`) |

Numbers are processed as numeric lexemes rather than materialised into IEEE-754 runtime values.

This preserves arbitrary numeric precision and avoids unintended rounding.

Canonical numeric output may differ lexically from the original JSON while preserving its numeric meaning.

### 3.2 Structural restrictions

The adapter rejects:

1. Non-object document roots.
2. Empty object keys.
3. Duplicate keys within the same object.
4. Lone UTF-16 surrogates.

Duplicate-key detection must operate on decoded key values, including escaped Unicode spellings.

These restrictions follow existing AES/AEON representation constraints rather than introducing independent JSON conventions.

### 3.3 Verified pipeline findings

The existing tests demonstrate:

- JSON → AES/Telex conversion.
- Byte-identical canonical Telex output for equivalent JSON and AEON documents, tested across 400 random documents and CTS vectors.
- AEOS validation using exact SANSA paths and wildcard selectors.
- Numeric bounds, string patterns, container constraints and null-reason validation.
- SANSA queries over imported JSON data.
- Reconstruction of the original JSON value structure from AES.

This provides concrete evidence of source-independent downstream processing.

### 3.4 Recommendation

Maintain JSON as the reference external adapter and baseline for future conformance testing.

Do not introduce JSON conventions for AEON-specific types such as NaN, Infinity, dates, Toggles, references or custom literals.

Users requiring those features can use AEON directly.

---

## 4. TOML Adapter

**Status:** Proposed / Investigation.

TOML has a largely compatible value model but introduces additional table-construction semantics.

### 4.1 Direct value mapping

| TOML             | AES / AEON                                |
| ---------------- | ----------------------------------------- |
| String           | String                                    |
| Integer          | Integer-compatible numeric representation |
| Float            | Float-compatible numeric representation   |
| Boolean          | Boolean                                   |
| Array            | List                                      |
| Table            | Object                                    |
| Local date       | Date                                      |
| Local time       | Time                                      |
| Local date-time  | DateTime without offset                   |
| Offset date-time | DateTime with offset                      |
| NaN / Infinity   | Corresponding numeric literals            |

TOML's integer-width restrictions are source-language restrictions, not limitations of AEON's numeric model.

Temporal values should preserve the precision and temporal context actually declared by TOML. No timezone should be inferred from an offset or from a local date-time.

### 4.2 Table construction

TOML supports:

- Explicit tables.
- Implicit parent tables.
- Dotted keys.
- Arrays of tables.
- Non-contiguous declarations affecting previously introduced structures.

For example:

```
[database]
host = "localhost"

[server]
port = 8080

[database.credentials]
user = "admin"
```

The adapter must assemble the correct hierarchy while enforcing TOML's table declaration and redefinition rules.

### 4.3 Event-ordering investigation

Determine whether the current AES event model supports:

- Adding children to previously emitted containers.
- Non-contiguous table assignments.
- Implicit parent creation.
- Out-of-order parent/child declarations.

This should not automatically reopen AEON phantom-parent semantics.

If direct streaming is incompatible with existing AES rules, the adapter can buffer or assemble the TOML document before emitting events.

**TOML's construction semantics belong to the adapter, not AES.**

### 4.4 Recommendation

Begin with full-document table assembly for simplicity and correctness.

Investigate streaming or partial buffering only if benchmarks demonstrate a meaningful benefit.

---

## 5. YAML Adapter

**Status:** Investigation / Higher complexity.

YAML is the most semantically complicated adapter currently under consideration.

Its mapping model, aliases, implicit scalar resolution and graph capabilities do not always align directly with AEON.

### 5.1 Baseline

Target YAML 1.2 with an explicitly selected schema, initially Core.

The adapter must not rely on implementation-specific scalar resolution.

Examples:

| YAML 1.2 Core  | AES                     |
| -------------- | ----------------------- |
| `true`         | Boolean                 |
| `false`        | Boolean                 |
| `yes`          | String                  |
| `no`           | String                  |
| `on`           | String                  |
| `off`          | String                  |
| `null` / `~`   | `!none`                 |
| Numeric scalar | Compatible numeric type |

AEON Toggle literals must not be inferred from YAML strings.

### 5.2 Complex mapping keys

YAML allows sequences and mappings to serve as keys.

```
? [en, AU]
: Australian English
```

AEON object bindings do not use structured values as member names.

Potential alternatives, such as tuples, nested objects or encoded string keys, introduce structural interpretation.

**Proposal:** Reject complex mapping keys in the generic adapter.

An explicit transformation facility may support such mappings separately.

### 5.3 Anchors and aliases

YAML anchors establish representation-node identity, while aliases refer to those nodes.

Two candidate mappings exist.

**Option A: AEON references**

Translate compatible aliases into native AEON reference semantics.

This would impose AEON's reference rules, including ordering and target constraints.

It may not support the full range of YAML relationships.

**Option B: Stable binding identities and SANSA paths**

Proposed representation:

```
person\alice\ = {
  name = "Alice"
  friend:path = $.\alice\
}
```

Corresponding YAML:

```
person: &alice
  name: Alice
  friend: *alice
```

Under this approach:

- YAML anchors become stable binding identities.
- YAML aliases become typed SANSA paths.
- The parser does not resolve the paths.
- Forward and cyclic relationships can be represented at the address level.
- AEON reference restrictions are not invoked.

This is a candidate extension and must not be treated as existing implemented behaviour.

It also requires explicit recognition that a path value is not automatically equivalent to YAML shared-node identity.

### 5.4 Anchor uniqueness

**Proposal:** Reject repeated anchor definitions within a document.

Repeated uses of the same alias remain permitted.

This is stricter than YAML's anchor-redefinition behaviour but aligns with AEON's document-wide stable identity uniqueness.

The adapter must distinguish anchor definitions from alias uses.

### 5.5 Additional YAML questions

Investigate:

- Cyclic aliases and downstream resolution.
- Alias targets attached to scalar and sequence nodes.
- Custom tags.
- Merge keys and YAML-version compatibility.
- Multiple-document streams.
- Block scalar semantics.
- Preservation of comments.
- Duplicate-key and scalar-key equivalence rules.

### 5.6 Recommendation

Develop a restricted YAML 1.2 adapter first.

Prioritise ordinary mappings, sequences and scalar types. Investigate anchor/alias preservation as a separate capability.

Do not silently expand aliases, stringify complex keys or reinterpret scalar types.

---

## 6. XML Adapter

**Status:** Proposed / Investigation.

XML is particularly interesting because AEON already has a sophisticated node model supporting named nodes, attributes, ordered children, mixed content and repeated node names.

This potentially provides a more natural structural mapping than conventional XML-to-JSON conversions.

### 6.1 Root mapping

XML has a document element, while AEON does not permit an anonymous node directly at the document root.

The proposed mapping introduces a named root binding.

Illustrative AEON:

```
xml@{version="1.0"} = <person @{id="123"} (
  <"name:user" ("Alice")>
  /* comments can be converted */
  "mixed strings between nodes"
  <age ("30")>
  <purchase @{price="3.30"} ("cards")>
  <purchase @{price="6.99"} ("paper")>
)>
```

The outer `xml` binding identifies the imported document representation; it does not introduce an additional XML element.

### 6.2 Structural mapping

| XML               | AEON                                      |
| ----------------- | ----------------------------------------- |
| Document element  | Node assigned to root binding             |
| Element name      | Node name                                 |
| XML attributes    | Node attributes                           |
| Child elements    | Node children                             |
| Text              | String children                           |
| Mixed content     | Ordered child content                     |
| Repeated elements | Repeated named nodes                      |
| Comments          | AEON comments, subject to retention rules |
| XML declaration   | Potential root-binding metadata           |

This mapping avoids converting repeated XML elements into artificial arrays or flattening mixed content into objects.

### 6.3 Preserve XML string values

XML attributes and element character content are strings unless a separate typing mechanism is explicitly applied.

For example:

```
<product price="3.30" quantity="2">
  <name>Paper</name>
</product>
```

The generic adapter must preserve:

```
xml = <product @{price="3.30", quantity="2"} (
  <name ("Paper")>
)>
```

It must not infer numeric types merely because AEON supports them.

Values such as `"3.30"`, `"3.3"` and `"03.30"` may carry distinctions important to the consuming application.

### 6.4 CDATA

> Historical baseline: current tooling preserves CDATA boundaries by default.
> See the [current CDATA contract](../../docs/format-adapter-support.md#cdata-representation-and-whitespace).

XML CDATA sections represent character data rather than a separate semantic value type.

Two approaches are possible:

**Semantic mapping:** Convert CDATA into ordinary AEON string content.

**Lexical preservation:** Preserve CDATA boundaries using an explicit representation convention, if supported.

The initial adapter should favour semantic mapping.

CDATA boundaries should not be treated as opaque semantic types merely because XML uses a special lexical notation.

### 6.5 XML namespaces

Investigate preservation of:

- Qualified element names.
- Namespace prefixes.
- Namespace URI declarations.
- Default namespaces.
- Namespace-qualified attributes.

For example:

```
<user:name xmlns:user="urn:people">Alice</user:name>
```

A quoted AEON node name can preserve `user:name`, but namespace-aware interpretation requires the relationship between the prefix and its URI.

The adapter must distinguish preserving qualified-name spelling from preserving expanded-name identity.

### 6.6 Document-level constructs

Investigate handling of:

- XML declarations.
- Comments outside the document element.
- Processing instructions.
- Document type declarations.
- Entity references and expansion.
- Whitespace and mixed-content ordering.

Security controls must be defined for external entity resolution, DTD processing and resource expansion.

### 6.7 Recommendation

Investigate XML as a high-value adapter because its node-oriented data model aligns closely with AEON.

Prioritise ordinary XML elements, attributes, mixed content and repeated child nodes.

Keep XML-specific parsing and document semantics outside AES core.

---

## 7. Tabular Data and CSV

CSV should not initially be treated as a direct structural adapter equivalent to JSON.

CSV does not consistently declare:

- Column identities.
- Column types.
- Header semantics.
- Row identity.
- Missing-value meaning.
- Structural relationships.

Different CSV dialects and applications interpret these differently.

**Proposal:** Define an AEON tabular profile independently of CSV, then support CSV imports through explicitly declared mappings.

Possible tabular representations include:

- Row-oriented objects.
- Column-oriented arrays.
- Schema plus positional tuples.

The logical tabular model may eventually be independent of these physical representations, but no new AEON primitive should be introduced without a demonstrated need.

---

## 8. Adapter Classification

| Format | Mapping category                       | Primary challenge                    |
| ------ | -------------------------------------- | ------------------------------------ |
| JSON   | Direct structural mapping              | AES boundary constraints             |
| TOML   | Direct values with structural assembly | Table construction                   |
| YAML   | Restricted semantic mapping            | Graph identity and scalar resolution |
| XML    | Node-oriented structural mapping       | Namespaces and document constructs   |
| CSV    | Explicit profile-driven import         | Undeclared structure and types       |

This classification should guide implementation rather than assuming every format requires the same adapter architecture.

## 9. Conformance and Testing

Each adapter should have a conformance suite covering four areas.

### 9.1 Source validity

Verify that the adapter correctly accepts and rejects constructs according to the selected source-language specification and supported profile.

### 9.2 AES representability

Verify that incompatible source constructs are rejected rather than silently modified.

### 9.3 Cross-format equivalence

Where two formats can express the same AEON-compatible values, compare their canonical AES/Telex output.

Byte-identical output is a useful conformance target where canonicalisation rules guarantee it.

### 9.4 Downstream interoperability

Run imported data through:

- AEOS validation.
- SANSA resolution and querying.
- Telex/Film encoding and decoding.
- Applicable AES integrity and materialisation tests.

A successful parse alone is insufficient to establish adapter correctness.

## 10. Open Architectural Questions

1. **AES event ordering:** Can TOML-style non-contiguous table construction be represented directly, or is buffering required?
2. **YAML anchor mapping:** Can stable binding identities and SANSA paths preserve the required relationship semantics without introducing new reference behaviour?
3. **XML namespaces:** Should the adapter preserve qualified names, expanded names, or both?
4. **XML document constructs:** Which constructs can be represented directly, and which require a declared preservation profile?
5. **Source metadata:** How should adapters expose source locations, diagnostics and provenance without polluting the canonical data representation?
6. **Atomicity:** Should adapters guarantee complete validation before publishing events, or support streaming consumers that may receive partial output before a failure?
7. **Canonical equivalence:** Which source distinctions are semantically meaningful, and which may be normalised during AES emission?

## 11. Proposed Implementation Sequence

**Phase 1 — Consolidate JSON**

- Retain JSON as the reference adapter.
- Formalise its strict compatibility rules.
- Preserve existing cross-format conformance tests.

**Phase 2 — TOML**

- Implement TOML value mapping.
- Assemble and validate table structure.
- Test temporal and numeric fidelity.
- Evaluate streaming feasibility.

**Phase 3 — XML**

- Validate the node-oriented mapping.
- Test mixed content, repeated elements and attributes.
- Investigate namespaces and document-level constructs.
- Establish safe XML parser defaults.

**Phase 4 — YAML**

- Implement a restricted YAML 1.2 subset.
- Establish scalar-resolution behaviour.
- Reject unsupported complex keys.
- Prototype stable-binding/SANSA-path alias mapping.
- Test cyclic and repeated-anchor edge cases.

**Phase 5 — Tabular profile**

- Define the native AEON tabular model.
- Establish explicit CSV import rules.
- Investigate other tabular sources.

## 12. Conclusion

The purpose of external adapters is not to make AEON imitate other formats.

It is to allow data expressed in other formats to participate in the Aeonite ecosystem wherever their semantics can be faithfully represented.

JSON demonstrates that this is practical: equivalent JSON and AEON documents already converge on byte-identical canonical Te
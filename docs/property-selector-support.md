# Property selectors: editor and host support

Unreleased coordination guidance, 22 November 2026. This guide describes current
boundaries; it adds no grammar, provider, parser, capability or installed bundle.

## Presentation and validation are separate

`&key("name")`, `&tag("book")` and `&headTag("book")` are accepted by the coordinated
AEON/SANSA implementation. The current VS Code/Pulsar/Sublime lexical rules retain
the earlier subset; they can color only the address prefix before a property
suffix. The Tree-sitter starter grammar likewise does not yet accept the suffix,
and Neovim consumers of that grammar inherit the limitation. Full property-literal
presentation is a remaining integration task, including escaped arguments,
chained/attribute navigation and preservation of constrained-reference rules.
Do not treat partial coloring or a starter-grammar error as the compiler's result.
These presentation patterns do not implement SANSA evaluation.

The shared web highlighter uses the selected implementation lexer/renderer.
Its source tests cover property literal text, but an old installed/vendor graph,
Quick Look app or editor extension does not acquire support from source changes.
Record and qualify the exact selected packages/bundle/platform. Nothing in this
document installs an extension, rebuilds Quick Look or deploys a website.

## Language service

The coordinated AEON language service accepts property literals inertly through
its compiler. It does not resolve them for hover, infer namespaces, or activate
stored selectors. Its trusted-schema validation currently calls the legacy
native-event AEOS API. Property rule selectors therefore return
`invalid_schema_policy`; it does not silently project into the separately
admitted portable AES/Telex profile. Existing identity-selector handling, source
spans, contract hashes and structural-only reference completion remain unchanged.

The [portable AEOS guide](https://github.com/AltoPelago/aeon/blob/main/docs/aeos-property-selectors.md)
and [SANSA property contract](https://github.com/AltoPelago/sansa/blob/main/docs/property-selectors-contract.md)
name admitted APIs. Supporting a new LSP validation representation needs its own
explicit integration; using a newer parser alone is insufficient.

See [candidate bundling](child-identity-tooling.md#verify-and-bundle) for selecting
the already-built server graph. The bundle's provenance and complete dependency
graph, rather than its directory name, determine what was actually tested.
Website/Tonics vendor pins remain separate owning inputs. Final host-artifact,
platform and registry qualification stays open after grammar integration.
Compatibility/target checks and the existing 1.15x latency / 1.20x memory budgets
are unchanged. Official releases, deployment and stable promotion remain held.

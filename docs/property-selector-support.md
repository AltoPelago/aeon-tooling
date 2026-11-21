# Property selectors: editor and host support

Unreleased source candidate, 22 November 2026. Editor property-literal rules are
implemented in this candidate; installed extensions, parsers and vendor bundles
retain their separate qualification gate. No provider, evaluator, LSP validation
representation or runtime dependency is admitted by an editor grammar.

## Presentation and validation are separate

VS Code, Pulsar and Sublime recognise complete `&key("name")`, `&tag("book")`
and `&headTag("book")` suffixes inside the existing lexical address subset.
Quoted spaces, escaped quotes/backslashes/controls, Unicode payloads, chained
properties, child identities and attribute navigation stay inside the address
scope. These are lexical rules; the implementation remains authoritative for
escapes, Unicode validity, limits, semantics and supported address forms.

Tree-sitter retains the single `sansa_address` node for complete literals, so
Neovim's existing `@string.special.path` capture continues to apply. A separate
`incomplete_sansa_address` recovery node and `@error` capture keep unfinished known
property arguments on their current line; they do not make incomplete input a
valid AEON value. TextMate/Sublime mark that unfinished suffix as
`invalid.illegal.sansa.incomplete.aeon`. The following binding remains visible.
No complete SANSA grammar, resolver or Query implementation is added to an editor.
The starter grammar's other existing omissions remain outside this slice.

Structural reference rules are unchanged. Clone/pointer references do not gain
properties, identities, recursion or expanded matching from literal highlighting.
LSP compiler diagnostics remain authoritative even when an editor colours a
malformed expression. Grammar recognition does not activate stored literals.

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

## Reproduce source checks

From the tooling repository root:

```sh
npm ci --ignore-scripts
npm run test:editor-properties
npm run test:tree-sitter
node scripts/verify-editor-property-literals.mjs --aeon-root /path/to/built-aeon --sansa-root /path/to/sansa
```

The last command calls the real compiler, canonicalizer and SANSA parser; it has
no editor-side semantic parser. It checks literal/canonical round trips and
continued reference rejection against the supplied exact source/build graph.

For headless Neovim capture and recovery checks, first generate/build the parser
in `grammar/tree-sitter-aeon` with its installed CLI, then run:

```sh
node grammar/tree-sitter-aeon/node_modules/tree-sitter-cli/cli.js build grammar/tree-sitter-aeon -o grammar/tree-sitter-aeon/parser.so
nvim --headless -u NONE -l test/property-literals.nvim.lua grammar/tree-sitter-aeon/parser.so .
```

These checks exercise real TextMate/Oniguruma engines, the generated Tree-sitter
parser and Neovim captures. Sublime's shared expression is checked with Oniguruma;
its native application, live editor extension/Neovim plugin installation, themes,
bundles, platforms and registry publication remain separate acceptance work.

Compatibility/target checks and the existing 1.15x latency / 1.20x memory budgets
are unchanged. Official releases, deployment and stable promotion remain held.

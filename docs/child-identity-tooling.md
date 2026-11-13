# Child identity editor/tooling candidate

This is an unpublished candidate for the coordinated AEON/SANSA work. Syntax
coloring does not enable a parser, resolver or consuming API.

```aeon
items = [ \item1\ = { name\name1\ = "Widget" } ]
chosen:sansa = $.items.\item1\.\name1\
copy = ~items[0].name
```

The annotation `\item1\` is occurrence metadata. The literal in `chosen` is a
SANSA selector, with one exposed direct-child relationship per identity step.
It is non-exact even when it resolves to one binding; its result path remains
structural, such as `$.items[0].name`. Rebasing the scope does not make the scope
root one of its own children. No global lookup or new recursive selector is
introduced. Clone/pointer references remain constrained structural paths;
`~$.items.\item1\` and `~>$.items.\item1\` remain rejected by the compiler.

| Surface | Candidate integration | Boundary |
| --- | --- | --- |
| VS Code / Pulsar | `entity.name.label.identity.aeon` annotation and `meta.address.sansa.aeon` literal scopes | Existing reference regexes unchanged |
| Sublime | Same lexical categories and theme colors | Highlighting, not source validation |
| Tree-sitter / Neovim | Identity-bearing member, attribute, anonymous value and node-head grammar nodes; `@label` / `@string.special.path` captures | Starter grammar remains incomplete |
| Web component / Quick Look source | `tok-identity` and `tok-sansa` spans | Quick Look picks up this source when rebuilt; no app installed |
| Website / SANSA source playground | Same annotation/literal categories in their maintained highlighter copies | Website deployment remains held |
| AEON language service | Compiler diagnostics, token-derived descriptive hovers, existing structural-only reference completion; trusted AEOS selector validation with original source spans | Requires a coordinated candidate server graph |

The lexical address subset covers `$`/`?` roots, ordinary/quoted members,
SANSA-form nonnegative indexes, chained child identities, explicit attribute and
quoted local-space transitions and existing `*` / `**` traversal spelling.
These presentation patterns are not the SANSA parser: qualifiers, patterns and
other full language forms still need the actual compiler/parser for validation.
Malformed input may receive partial color during editing. Quoted marker-shaped
keys, strings and comments are not identity annotations.

The service does not resolve selectors for hover, infer a namespace from a
literal, complete identities from the entire document, rename IDs or rewrite
references. Existing trusted-contract hash checks and compiler/schema errors
remain active. Identity selectors in schema `path` fields remain rejected.

## Verify and bundle

Run the existing web, grammar and Tree-sitter checks, plus the bundle regression:

```sh
npm run test:web
npm run test:vscode:grammar
npm run test:vscode:bundle
npm run test:tree-sitter
```

Build the language service against the selected candidate package graph. Bundle
that already-built graph explicitly from `ide/vscode/aeon`:

```sh
node scripts/bundle-server.mjs "$AEON_TYPESCRIPT_ROOT"
```

The argument is the AEON `implementations/typescript` build root. Omitting it
retains the existing sibling build default. The bundler copies import-only
SANSA exports, including `parsing/selector-cursor`, through the selected graph's
normal package search roots. A stale bundled `server/` takes priority over the
sibling fallback; rebuild it when changing the candidate. Nothing installs or
publishes an extension. The ordinary `package` command retains its default
sibling build behavior; do not use it to claim a different candidate graph.

Local verification includes built service tests, a self-contained candidate
bundle and protocol smoke checks. It does not certify every editor host, theme,
Quick Look installation or extension marketplace artifact. The release-time
platform/registry and combined-source checks remain separate.

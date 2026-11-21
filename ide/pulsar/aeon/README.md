# AEON for Pulsar

Starter package scaffold for AEON syntax support in Pulsar.

Planned contents:

- TextMate-compatible grammar
- `.aeon` file association
- optional package-local styling for AEON doc-comment markup

Status:

- TextMate-compatible grammar is copied from `ide/vscode/aeon/syntaxes/aeon.tmLanguage.json`
- grammar includes `.aeon` file association metadata for Pulsar
- grammar should stay aligned with the VS Code source grammar when syntax changes

Next steps:

1. add package activation metadata if editor-specific behavior is needed
2. add optional package-local styling for AEON `&ND` doc-comment scopes
3. test against `language-spec/examples/highlight-cases.aeon`

## Property literals (unreleased source candidate)

The grammar recognises SANSA `&key("name")`, `&tag("book")` and
`&headTag("book")` suffixes, including quoted payloads and chained navigation.
Incomplete known arguments recover at the line boundary. These are presentation
rules; the compiler owns validation and reference restrictions remain unchanged.
See the [source checks and host boundaries](../../../docs/property-selector-support.md).
Installed extension/application qualification remains separate; no release or
deployment is performed by this source change.

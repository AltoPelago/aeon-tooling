# AEON for Pulsar

Starter package scaffold for AEON syntax support in Pulsar.

Planned contents:

- TextMate-compatible grammar
- `.aeon` file association
- optional package-local styling for AEON doc-comment markup

Status:

- package skeleton only
- grammar should stay aligned with `vscode/aeon/syntaxes/aeon.tmLanguage.json`

Next steps:

1. copy or generate the grammar into `grammars/aeon.json`
2. add package activation metadata if editor-specific behavior is needed
3. test against `language-spec/examples/highlight-cases.aeon`

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

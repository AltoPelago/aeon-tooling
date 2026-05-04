# AEON Tooling Workspace

This repository is the maintained tooling workspace for AEON.

It currently groups tooling by product and integration surface:

- `vscode/`
- `tree-sitter-aeon/`
- `web/`
- `nvim/`
- `pulsar/`
- `sublime/`
- `language-spec/`
- `scripts/`
- `packages/`

Tooling in this tree should not silently depend on AEON implementation code being housed in the same repository unless that local-development workflow is documented explicitly.

## Validation

```sh
npm run test
```

The root test command covers the dependency-light browser code block tests and the `md-to-and`
package tests. Editor and grammar integrations keep their own focused commands:

- `npm run test:vscode:grammar`
- `npm run test:tree-sitter`

## Packages

- `packages/md-to-and/`: Markdown to canonical standalone `&ND` converter (CLI + library).

# AEON Tooling Workspace

This repository is the maintained tooling workspace for AEON.

It groups tooling by product and integration surface:

- `ide/`: editor and desktop integrations for VS Code, Neovim, Pulsar, Sublime Text, and macOS Quick Look.
- `grammar/`: shared grammar/parser assets, including `tree-sitter-aeon`.
- `converters/`: document and format translation tools.
- `web/highlighter/`: browser/web syntax highlighting components.
- `language-spec/`
- `scripts/`

Tooling in this tree should not silently depend on AEON implementation code being housed in the same repository unless that local-development workflow is documented explicitly.

## Validation

```sh
npm run test
```

The root test command covers the dependency-light browser code block tests and the `md-to-and`
converter tests. Editor and grammar integrations keep their own focused commands:

- `npm run test:vscode:grammar`
- `npm run test:tree-sitter`

The VS Code integration is a standalone pnpm package. Before running its grammar
tests in a fresh checkout, install its local dependencies:

```sh
npm run install:vscode
npm run test:vscode:grammar
```

Package the VS Code extension with the same hoisted install layout so `vsce`
can inspect runtime dependencies:

```sh
npm run install:vscode
npm run package:vscode
```

## macOS Quick Look

For macOS Finder preview support with official syntax highlighting for `.aeon` and `.and` files:

```sh
npm run install:quicklook
```

This compiles and registers `AEON QuickLook.app` with Launch Services and Quick Look. Once installed, pressing Spacebar on any `.aeon` or `.and` file in Finder displays a syntax-highlighted preview.

To uninstall:

```sh
npm run uninstall:quicklook
```

## Converters

- `converters/md-to-and/`: Markdown to canonical standalone `&ND` converter (CLI + library).

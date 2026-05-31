AEON VS Code integration

This folder contains a VS Code extension providing:

- a TextMate grammar for basic AEON tokenization
- a small dark color theme mapping AEON scopes
- diagnostics from `aeon-lsp`
- hover for datatype annotations and reference targets
- completion for AEON header fields, keys, reference paths, convention ids, and common convention metadata
- quick fixes for missing GP convention declarations and missing GP security/document sections
- schema/profile-aware validation via trusted registry settings

Install & test locally

```bash
cd ide/vscode/aeon
pnpm install --frozen-lockfile --node-linker=hoisted
# open in Extension Development Host
code --extensionDevelopmentPath=$(pwd)
```

Open a sample AEON file from a sibling implementation checkout, such as `../aeon/stress-tests/full/full-feature-stress.aeon`, to see highlighting.

For language features, build the server first:

```bash
cd ../../../aeon/implementations/typescript
pnpm --filter @aeon/aeon-lsp build
```

Useful local checks:

```bash
cd ide/vscode/aeon
pnpm install --frozen-lockfile --node-linker=hoisted
pnpm test:grammar
pnpm test:extension
pnpm package
```

The extension looks for a bundled server at `server/server.js` first, then falls back to the sibling implementation build at `../../../../aeon/implementations/typescript/tools/aeon-lsp/dist/server.js`.
That keeps local development working while leaving room to bundle the language server later.

`pnpm package` builds and bundles the sibling AEON language server into `server/`
before producing the `.vsix`.

Publish an already packaged VSIX with:

```bash
pnpm exec vsce publish --packagePath aeon-vscode-0.9.3.vsix
```

Language feature samples

- `test/fixtures/lsp-sample.aeon`
  - basic diagnostics, hover, and reference completion
- `test/fixtures/lsp-conventions-sample.aeon`
  - GP document/context/convention/security declarations
  - security-envelope diagnostics
  - convention-aware completions
  - quick-fix entry points for missing convention declarations or envelope sections

What the editor now helps with

- Security conventions:
  - warns when `aeon:envelope` is present but GP security conventions are missing
  - warns when declared GP security conventions are missing `integrity`, `signatures`, or `encryption`
  - quick fixes to add missing GP security conventions to `aeon:header`
  - quick fixes to insert missing envelope sections
- Document conventions:
  - warns when `aeon.gp.document.v1` is declared but `aeon:header.document` is missing
  - quick fix to add a `document` metadata block
  - completion for common document fields like `title`, `subject`, `author`, `language`, and `reference`
- Context and namespace conventions:
  - completion for context attribute keys like `role`, `domain`, `audience`, and `intent`
  - completion for convention attribute keys like `ns`, `unit`, `currency`, `precision`, and `dimensions`
  - namespace value completion for `@{ns="..."}`
  - warnings and fixes when convention/context attributes are used without declaring the corresponding GP convention

Workspace settings:

- `aeon.validation.enabled`
- `aeon.validation.contractRegistry`
- `aeon.validation.profile`
- `aeon.validation.schema`

When `contractRegistry` plus `schema`/`profile` ids are set, the editor validates using the trusted registry and fails closed on unknown ids or hash mismatches.

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

Candidate identity annotation/literal scopes and descriptive language-service
hovers are documented in [the tooling contract](../../../docs/child-identity-tooling.md).
Use a coordinated candidate server build for those hovers and validation. From
this directory, `node scripts/bundle-server.mjs "$AEON_TYPESCRIPT_ROOT"` bundles
an explicitly selected, already-built TypeScript graph. The existing package
command keeps its default sibling build behavior; no extension is installed or
published by this preparation.

## Property literals (unreleased source candidate)

The grammar recognises SANSA `&key("name")`, `&tag("book")` and
`&headTag("book")` suffixes, including quoted payloads and chained navigation.
Incomplete known arguments recover at the line boundary. These are presentation
rules; the compiler owns validation and reference restrictions remain unchanged.
See the [source checks and host boundaries](../../../docs/property-selector-support.md).
Installed extension/application qualification remains separate; no release or
deployment is performed by this source change.

## Verify a local VSIX candidate

The package includes the extension's production client dependencies as well as
the explicitly bundled language server. VSCE still selects production
dependencies; development tools are excluded and checked in the archive.
The verifier inventories all package directories in the client `node_modules`
tree, including scoped and nested packages, and rejects any outside the declared
production closure—even when no directly declared development tool is present.
Packages are compared by resolved location, not only name/version. A development
dependency also required by the production graph is allowed. The separately
bundled server tree is exercised through its imports and IPC startup below;
the client inventory is not an allowlist for the server graph or arbitrary files.
After packaging, run `pnpm run verify:package` to check the default output
archive, or pass an explicit artifact path as shown below. This verification
requires Python 3.9+ and Node on PATH. The verifier streams stored/deflated ZIP
members in bounded chunks into a temporary directory (10,000 entries, 64 MiB
total), then checks the client dependency closure and loads the actual client
and extension entry points. Only VS Code's host-provided base classes are shimmed
for this import check; packaged dependencies are never mocked. This checks module
loading, not activation in an Extension Host.

The verifier also exercises inert property literals and reference rejection,
then starts the packaged server over Node IPC, requires a successful LSP
initialize/shutdown/exit exchange, and rejects startup failures or a 10-second
timeout. It runs candidate code in Node; use it only with trusted local builds.

For a package built with a custom output filename, run from this directory:

```sh
python3 scripts/verify-vsix.py /path/to/candidate.vsix
```

Run verifier regressions against the same real artifact, including deliberately
removed client and server runtime files, extra client packages, early exit,
invalid responses and timeout:

```sh
pnpm run test:package /path/to/candidate.vsix
```

Without an artifact argument, only extraction/resource tests run and the runtime
controls are explicitly skipped. No VS Code installation is required.

Use the explicit build-root argument documented above to select the server
graph. This archive check does not install or activate an extension, and does
not establish live editor/theme or marketplace qualification.

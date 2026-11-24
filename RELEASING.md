# Release integration

Follow the [shared AEON 0.17.0 checklist](https://github.com/AltoPelago/roadmap/blob/main/aeon/work-in-progress/release-0.17.0-checklist.md)
for the coordinated beta → RC → stable cycle. This repository keeps its own
revision/version; it does not inherit AEON's package number or imply simultaneous
publication.

## Stages and acceptance

- While intended scope is landing, consume exact published beta versions in
  candidate integrations and record incomplete scope, failures and limitations.
- Once declared scope is complete and repository checks pass, consume exact RC
  versions for full acceptance. Freeze RC scope to stabilization; a changed
  candidate requires renewed affected checks and a new version if published.
- After RC acceptance, verify newly published stable artifacts before default
  adoption. Repeat affected downstream checks against final versions and locks.

Use exact versions and artifact integrity for acceptance, rather than the moving
npm `next` tag. If this repo publishes npm packages, beta/RC package versions use
`X.Y.Z-beta.N` / `X.Y.Z-rc.N` with `--tag next`; stable versions use `latest`.
For non-registry artifacts, record the source commit, build inputs and artifact
digest. Keep existing review, packaging and publication requirements.

## Repository checks

Before candidate acceptance, run `npm test`, the affected VS Code grammar/bundle
checks and tree-sitter checks listed in the README. Record the exact editor/LSP
server bundle and dependency graph; package and smoke-test affected integrations
against the selected registry candidate. Verify technical search/casing behavior
where affected. An editor grammar update alone does not prove server support.

Record commands, CI results, runtime/platform versions, package/lock integrity,
artifact digests, skips and verification limits in the shared checklist. Local
builds and tarballs do not establish registry availability. Do not mark a release
row accepted until the required evidence for its exact combination is retained.

## Published RC preparation

The candidate pins public AEON npm `0.17.0-rc.3` in the root highlighter/lexer
and ALOG compiler graphs. [RC integration](docs/rc-registry-integration.md)
records the exact inputs and distinct source, registry and packaged-host gates.
Old private archives below are retained historical evidence, not active pins.
Registry availability alone does not qualify an editor extension or install it.
The candidate remains under independent review; coordinated stable adoption and
production deployment are separate gates. Existing budgets and targets remain.

## Historical shared browser highlighter qualification

The following records the earlier private-archive qualification. Current RC
inputs and remaining acceptance gates are described above.

The code-block shell imports the implementation-backed AEON renderer. Its
existing frame, copy control and colours remain local; IDE grammars are unchanged.
The demo import map loads the development packages installed at the repository
root. `.candidate-packages/highlight.json` records exact archive hashes and the
producer commit. These local pins must be replaced by qualified exact registry
artifacts before release.

Local verification: all 11 highlighter tests and all 3 converter tests pass.
The worktree converter test used a Node loader mapping its existing sibling
&ND import to the primary `and-core` checkout; no converter source or pin changed.
The browser demo renders with the existing dark palette. Clipboard permission
and the browser matrix remain release checks. Releases and deployment stay held.

Colour follow-up: numeric/radix literals use the shared `tok-number` role and
temporal values `tok-temporal`. Dark colours are cyan `#7dd3fc` / light yellow
`#f5e6a8`, with light-theme equivalents `#006b80` / `#806500`. SANSA address
literals share the symbol colour. The development highlighter archive is
repinned with SHA-256 provenance; parsers, target checks and budgets are unchanged.
Releases and deployment remain held.

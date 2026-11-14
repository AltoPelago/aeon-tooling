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

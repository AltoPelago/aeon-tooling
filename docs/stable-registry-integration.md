# Public AEON stable integration

Stable adoption preparation, 25 November 2026. Root browser dependencies and the ALOG
compiler graph use exact published AEON npm `0.17.0`, producer
`b477b6689b7b7f9f3363c77a4297303b038e2ca0`. Its SANSA provider is
`0.15.0`, producer `56381b7cfe57c188b43dcabbf74bcfec0144fa9e`.
[Immutable upstream inputs](releases/aeon-0.17.0.json) inventory actual
registry artifacts; that inventory is not an acceptance result. The protected AEON npm workflow supplies verified CI provenance for each AEON
package. SANSA has its separately verified attestation; artifact digests, exact
source/workflow identity and installed consumers remain distinct checks.

Install root, converter and adapter graphs from their own frozen locks. Preserve
third-party pins and existing scripts. The root browser shell uses the installed
implementation highlighter; it does not parse AEON itself. The ALOG adapter uses
its compiler dependency and its existing conversion contract. Historical private
highlighter archives and original hashes remain retained and labeled separately.

The language server is a separate source-built AEON tool, not one of the 18
published npm packages. Build that tool from the exact accepted producer against
the selected published runtime graph, retain build/source/dependency hashes,
and use the explicit build-root argument to `bundle-server.mjs`. Package the
extension with its unchanged locked client graph, then run grammar, bundle,
verifier/IPC and package-negative controls on that exact archive. Source or
in-process tests do not establish a live Extension Host activation, marketplace
publication, Windows behavior or every editor platform. Record those limits.
Never use a stale bundled server as proof of the selected graph.

The [property host guide](property-selector-support.md) and
[child-identity guide](child-identity-tooling.md) remain the admission authority:
editor literals are inert, native-event LSP AEOS property selectors stay denied,
and clone/pointer references remain structural paths. Existing target and
compatibility assertions must pass unchanged. Do not infer new capabilities from
newer parser/highlighter packages or presentation output.

Qualification also records the unchanged optional AND bridge source pin where
converters require it. Do not use unrecorded primary working files. Exact
registry imports, server payload provenance and editor/browser output checks are
separate checks. Per [RELEASING](../RELEASING.md), independent owning QA and
combined acceptance precede stable adoption. Tooling's own package versions,
publication surfaces, and deployment authority are unchanged. No new benchmark
or budget waiver; the existing 1.15x latency / 1.20x memory policy remains.

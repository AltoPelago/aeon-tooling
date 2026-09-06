# AES interchange audit

Status: implementation audit, 2026-09-06

## Scope

This audit identifies places in `aeon-tooling` that consume or emit values that
look like AES events, then distinguishes in-process implementation data from an
actual interchange boundary.

Portable AES is the encoding-neutral event contract. Telex is the text
interchange encoding for that contract. An internal object does not become an
interchange format merely because it can be serialized as JSON during testing
or debugging.

## Inventory

| Surface | Data crossing the boundary | Classification | Decision |
| --- | --- | --- | --- |
| `scripts/cts-source-lane-runner.mjs` | `cts.protocol.v1` JSON envelope containing normalized observations | Test-control protocol, not AES interchange | Keep JSON. Forward `portable_aes` explicitly and normalize both legacy and portable observations. |
| VS Code language server bundle | `compileResult.aes` passed directly to AEOS validation | Same-process implementation object | No Telex encode/decode step. Preserve identity as event metadata rather than path identity. |
| Neon server canonicalization | `compiled.events` passed directly to `minimize` | Same-process implementation object | No Telex encode/decode step. |
| Neon HTTP requests and responses | Editor source, options, diagnostics, and rendered text | Product API, not an AES event carrier | Keep the existing JSON API. |
| Web-editor local storage | UI state and source text | Product state, not an AES event carrier | Keep the existing browser representation. |
| Converter and package metadata JSON | Command summaries, grammars, manifests, and package metadata | Tool-specific data | No AES dependency. |

No production command in this repository currently imports or exports a
serialized AES event stream. Consequently, adding Telex to these surfaces would
create encoding work without creating an interoperability boundary.

## CTS runner contract

The CTS runner's JSON is a versioned harness envelope. It is allowed to inspect
legacy implementation events for legacy CTS cases, but portable AES cases must
request the portable projection explicitly through `input.options.portable_aes`.
The runner forwards that request as `--portable-aes` and observes portable
`kind`, `identity`, datatype, and reference fields without treating the JSON
shape itself as a portable wire format.

Telex syntax and round-trip conformance belong to the Telex CTS lane and the
implementation that exposes Telex, rather than to this generic source-lane
control envelope.

## Rule for future tooling boundaries

When a tooling feature begins to persist AES, send it across a process boundary,
or expose it for another component to consume, it must choose the boundary
explicitly:

- use complete Telex as the default portable text interchange;
- require an explicit partial/cross-event-relaxed profile when completeness
  cannot be guaranteed;
- keep structural identity in the event's identity field, never in path
  identity; and
- use implementation objects only when producer and consumer share the same
  process and versioned implementation contract.

Syntax highlighting or editor support for `.telex.aes` would be a separate
product feature. It is not required to make the existing AEON tooling surfaces
AES-compatible.

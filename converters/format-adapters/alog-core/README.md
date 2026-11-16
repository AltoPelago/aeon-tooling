See the [current language feature support matrix](../../../docs/format-adapter-support.md) for import/export coverage and limitations.

# ALOG adapter

See the [implementation proposal](../../../docs/format-adapters.md) for the
supported syntax, API contract, limits and verification boundaries.

Install with `npm ci --ignore-scripts` and run `npm test` in this directory.
The CLI accepts `--aeon` or `--records`; default output is Telex.
Library entry: `src/index.js`, exporting `alogToAes`, `alogToAeon`, `alogToTelex`.

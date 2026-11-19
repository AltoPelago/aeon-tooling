# Source format adapters

JSON, TOML, XML, ALOG v1 and experimental YAML adapters producing portable
`aes.events.v1`, Telex and AEON. See the [implementation proposal](../../docs/format-adapters.md)
for migration and mapping decisions. The [feature support matrix](../../docs/format-adapter-support.md)
documents import/export coverage and limitations for every format.

```sh
# From the aeon-tooling repository root
npm run install:adapters
npm run test:adapters
node converters/format-adapters/json-core/bin/json-aes.js --aeon input.json
node converters/format-adapters/alog-core/bin/alog-aes.js --aeon input.alog
node converters/format-adapters/yaml-core/bin/yaml-aes.js --records input.yaml
```

Each package exports `FORMATToAes`, `FORMATToTelex` and `FORMATToAeon` (lowercase
format prefix: `json`, `toml`, `xml`, `alog`, `yaml`). YAML additionally exports
`yamlToAesWithAnnotations` to preserve custom scalar tags outside semantic AES;
its AES/Telex-only APIs reject tagged input. ALOG also exports
`alogToAesStream` for pull-driven UTF-8 byte input. Packages share renderer and
codec modules within this tree and are not independently publishable artifacts.

Default AEON shape:

```aeon
""@{source = |JSON|} = {
  name = "Alice"
}
```

The imported root lives at `$.[""]`; the source attribute is optional via
`{ sourceMetadata: false }`. Existing JSON/TOML/XML consumers can explicitly
select `{ mapping: 'native' }` or CLI `--native` for their previous mapping.

## Validate and query imported data

Run `npm run examples:adapters` for examples importing JSON, TOML, XML, ALOG and
YAML into AES, validating with AEOS, and querying the validated records with
SANSA. Each includes expected results and an invalid variant. See the
[runnable pipeline examples](examples/validate-and-query/README.md) for setup,
schemas and format-specific addressing.
The playground's **Validate & query** workspace also provides these examples,
an AES/Telex viewer, editable schemas and queries, and validation diagnostics.

The [original architecture investigation](source-format-adapters.md) is retained
as historical context; current behavior is documented by the proposal above.

## Local playground

Run `npm run playground:adapters` from the tooling repository root to open the
[local playground](http://127.0.0.1:4317). Choose input/output formats or swap
directions, including AEON to JSON. Lossless mode is the default; lossy mode
turns unsupported scalar values into strings and reports the affected paths. See [setup and conversion limits](playground/README.md)
for the required empty-key-capable local compiler and reverse export profiles.

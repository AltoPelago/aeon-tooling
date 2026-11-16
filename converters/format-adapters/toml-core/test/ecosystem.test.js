/**
 * Differential and full-pipeline integration tests for `@altopelago/toml-core`
 * against the Aeonite ecosystem (`aes`, `aeon-core`, `aeon-aeos`, `sansa`, and
 * `aeonite-cts`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_TOML_AES_LIMITS,
  tomlToAeon,
  tomlToAes,
  tomlToTelex,
} from '../../test-support/toml-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const familyRoot = resolve(here, '..', '..', '..', '..', '..');
const ctsRoot = resolve(
  process.env.AEONITE_CTS_ROOT
    ?? resolve(familyRoot, '..', 'aeonite-org', 'aeonite-cts', 'cts'),
);

const aesPath = resolve(familyRoot, 'aes/src/telex.js');
const corePath = resolve(familyRoot, 'aeon/implementations/typescript/packages/core/dist/index.js');
const canonicalPath = resolve(familyRoot, 'aeon/implementations/typescript/packages/canonical/dist/index.js');
const aeosPath = resolve(familyRoot, 'aeon/implementations/typescript/packages/aeos/dist/index.js');
const sansaIndexPath = resolve(familyRoot, 'sansa/src/index.js');
const sansaRuntimePath = resolve(familyRoot, 'sansa/tools/query-web/runtime.mjs');

const load = async (p) => (existsSync(p) ? import(pathToFileURL(p).href) : null);
const aes = await load(aesPath);
const core = await load(corePath);
const canonical = await load(canonicalPath);
const aeos = await load(aeosPath);
const sansa = await load(sansaIndexPath);
const sansaWorkbench = await load(sansaRuntimePath);

test(
  'CTS: DEFAULT_TOML_AES_LIMITS matches altopelago.aeonic-limits.v1 defaults',
  { skip: !existsSync(ctsRoot) && 'aeonite-cts not found' },
  () => {
    const suite = JSON.parse(
      readFileSync(resolve(ctsRoot, 'core/v1/suites/16-aeonic-limit-boundaries.json'), 'utf8'),
    );
    const defaults = suite.meta.limits_defaults;
    assert.equal(DEFAULT_TOML_AES_LIMITS.maxValueNestingDepth, defaults.structure.max_value_nesting_depth);
    assert.equal(DEFAULT_TOML_AES_LIMITS.maxPathDepth, defaults.structure.max_path_depth);
    assert.equal(DEFAULT_TOML_AES_LIMITS.maxPathCharacters, defaults.structure.max_path_characters);
    assert.equal(DEFAULT_TOML_AES_LIMITS.maxStringCodepoints, defaults.structure.max_string_codepoints);
    assert.equal(DEFAULT_TOML_AES_LIMITS.maxKeySegmentCodepoints, defaults.structure.max_key_segment_codepoints);
    assert.equal(DEFAULT_TOML_AES_LIMITS.maxListItems, defaults.structure.max_list_items);
    assert.equal(DEFAULT_TOML_AES_LIMITS.maxEvents, defaults.processing.max_events);
    assert.equal(DEFAULT_TOML_AES_LIMITS.maxInputBytes, defaults.formats.aeon.max_input_bytes);
    assert.equal(DEFAULT_TOML_AES_LIMITS.maxNumericLiteralCharacters, defaults.formats.aeon.max_numeric_literal_characters);
  },
);

test(
  'Differential: equivalent TOML and AEON documents compile to byte-identical Telex (including temporals, radix, inf/nan, tables)',
  { skip: (!aes || !core) && 'aes or aeon-core not found' },
  () => {
    const tomlDoc = `
title = "Service Config"
max_connections = 1_000
timeout_sec = +2.50
enabled = true
retry_limit = inf
fallback_score = nan
permissions = 0o755
feature_mask = 0b1010_0101
vendor_id = 0xdead_beef
release_date = 2026-10-19
maintenance_window = 03:30:00
deployed_at = 2026-10-19T03:30:00+11:00

[database]
host = "db.internal"
ports = [5432, 5433]

[database.pool]
min = 2
max = 16
`;

    const aeonDoc = `
title = "Service Config"
max_connections = 1_000
timeout_sec = +2.50
enabled = true
retry_limit = Infinity
fallback_score = NaN
permissions:radix[8] = %755
feature_mask:radix[2] = %10100101
vendor_id:radix[16] = %DEADBEEF
release_date = 2026-10-19
maintenance_window = 03:30:00
deployed_at = 2026-10-19T03:30:00+11:00
database = {
  host = "db.internal"
  ports = [5432, 5433]
  pool = {
    min = 2
    max = 16
  }
}
`;

    const tomlTelex = tomlToTelex(tomlDoc);
    const validated = aes.validateTelex(tomlTelex);
    assert.deepEqual(validated.diagnostics, []);
    assert.equal(aes.canonicalizeTelex(tomlTelex), tomlTelex);

    const aeonCompiled = core.compileToTelex(aeonDoc, {});
    assert.deepEqual(aeonCompiled.compile.errors, []);
    assert.equal(tomlTelex, aeonCompiled.telex);
  },
);

test(
  'Integration: TOML -> AES (Telex) -> AEOS schema validation -> SANSA query (with radix, temporals, and [[array.of.tables]])',
  { skip: (!aeos || !sansa || !sansaWorkbench) && 'AEOS or SANSA not found' },
  async () => {
    const tomlInput = `
cluster = "prod-ap-southeast"
snapshot_date = 2026-10-19

[[nodes]]
id = "node-01"
role = "primary"
load = 0.42
flags = 0b1101
heartbeat = 2026-10-19T03:25:00Z

[[nodes]]
id = "node-02"
role = "replica"
load = 0.88
flags = 0b0100
heartbeat = 2026-10-19T03:29:30Z

[[nodes]]
id = "node-03"
role = "replica"
load = 0.19
flags = 0b1111
heartbeat = 2026-10-19T03:28:00Z
`;

    const telex = tomlToTelex(tomlInput);

    // 1. Validate with AEOS across DateLiteral, DateTimeLiteral, RadixLiteral (radix[2]), NumberLiteral, and [[nodes]]
    const schema = {
      rules: [
        { path: '$.cluster', constraints: { required: true, type: 'StringLiteral' } },
        { path: '$.snapshot_date', constraints: { required: true, type: 'DateLiteral' } },
        { path: '$.nodes', constraints: { required: true, type: 'ListNode', min_children: 1 } },
        { selector: '$.nodes.*.id', constraints: { required: true, type: 'StringLiteral', pattern: '^node-[0-9]{2}$' } },
        { selector: '$.nodes.*.role', constraints: { required: true, type: 'StringLiteral', pattern: '^(primary|replica)$' } },
        { selector: '$.nodes.*.load', constraints: { required: true, type: 'NumberLiteral', min_value: '0', max_value: '1' } },
        { selector: '$.nodes.*.flags', constraints: { required: true, type: 'RadixLiteral', radix: 2 } },
        { selector: '$.nodes.*.heartbeat', constraints: { required: true, type: 'DateTimeLiteral' } },
      ],
    };

    const validation = aeos.validateTelex(telex, schema);
    assert.equal(validation.ok, true, `AEOS errors: ${JSON.stringify(validation.errors)}`);

    // 2. Query with SANSA
    const nsLoaded = await sansaWorkbench.namespaceFromTelexSource(telex);
    assert.equal(nsLoaded.ok, true);

    const replicaQuery = `
      from $.nodes.*
      where .role == "replica" and .load < 0.5
      select { id = .id load = .load heartbeat = .heartbeat }
    `;
    const queryResult = sansa.evaluateQuery(replicaQuery, nsLoaded.namespace);
    assert.equal(queryResult.ok, true, JSON.stringify(queryResult.errors));
    assert.deepEqual(
      queryResult.results.map((r) => r.value.value),
      [{ id: 'node-03', load: '0.19', heartbeat: '2026-10-19T03:28:00Z' }],
    );
  },
);

test('Examples: cluster.toml and inventory.toml match their canonical .telex.aes snapshots', () => {
  for (const name of ['cluster', 'inventory']) {
    const src = readFileSync(resolve(here, '..', 'examples', `${name}.toml`), 'utf8');
    const expectedTelex = readFileSync(resolve(here, '..', 'examples', `${name}.native.telex.aes`), 'utf8');
    const actualTelex = tomlToTelex(src);
    assert.equal(actualTelex, expectedTelex, `${name}.toml snapshot mismatch`);
    if (aes) {
      assert.deepEqual(aes.validateTelex(actualTelex).diagnostics, []);
    }
  }
});

test(
  'TOML -> AEON matches canonical AEON representation (@altopelago/aeon-canonical)',
  { skip: !canonical && 'aeon canonical dist not found' },
  () => {
    const tomlDoc = `
title = "Service Config"
max_connections = 1_000
timeout_sec = +2.50
enabled = true
retry_limit = inf
fallback_score = nan
permissions = 0o755
feature_mask = 0b1010_0101
vendor_id = 0xdead_beef
release_date = 2026-10-19
maintenance_window = 03:30:00
deployed_at = 2026-10-19T03:30:00+11:00

[database]
host = "db.internal"
ports = [5432, 5433]

[database.pool]
min = 2
max = 16
`;

    const aeonDoc = `
title = "Service Config"
max_connections = 1_000
timeout_sec = +2.50
enabled = true
retry_limit = Infinity
fallback_score = NaN
permissions:radix[8] = %755
feature_mask:radix[2] = %10100101
vendor_id:radix[16] = %DEADBEEF
release_date = 2026-10-19
maintenance_window = 03:30:00
deployed_at = 2026-10-19T03:30:00+11:00
database = {
  host = "db.internal"
  ports = [5432, 5433]
  pool = {
    min = 2
    max = 16
  }
}
`;

    const fromToml = tomlToAeon(tomlDoc);
    const expectedCanonical = canonical.canonicalize(aeonDoc);
    assert.deepEqual(expectedCanonical.errors, []);
    assert.equal(fromToml, expectedCanonical.text);
    // Verify idempotence when re-canonicalized
    assert.equal(canonical.canonicalize(fromToml).text, fromToml);

    // Also verify both example TOML files produce idempotent canonical AEON
    for (const name of ['cluster', 'inventory']) {
      const src = readFileSync(resolve(here, '..', 'examples', `${name}.toml`), 'utf8');
      const aeonText = tomlToAeon(src);
      const reCanon = canonical.canonicalize(aeonText);
      assert.deepEqual(reCanon.errors, [], `${name}.toml canonical errors`);
      assert.equal(aeonText, reCanon.text, `${name}.toml canonical idempotence`);
    }
  },
);

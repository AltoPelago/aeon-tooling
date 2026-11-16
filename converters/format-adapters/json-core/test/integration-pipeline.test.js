/**
 * End-to-end integration test proving non-AEON JSON data can enter the
 * Aeonite ecosystem via `json-core`, pass AEOS schema validation (including
 * wildcard SANSA path rules, numeric bounds, pattern matching, and `!none`
 * null-sentinel checks), and be queried directly by SANSA.Query (filtering,
 * ordering, and projection).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { jsonToAes, jsonToTelex } from '../../test-support/json-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const familyRoot = resolve(here, '..', '..', '..', '..', '..');
const aeosDist = resolve(familyRoot, 'aeon/implementations/typescript/packages/aeos/dist/index.js');
const sansaIndex = resolve(familyRoot, 'sansa/src/index.js');
const sansaRuntime = resolve(familyRoot, 'sansa/tools/query-web/runtime.mjs');

const hasEcosystem = existsSync(aeosDist) && existsSync(sansaIndex) && existsSync(sansaRuntime);
const aeos = hasEcosystem ? await import(pathToFileURL(aeosDist).href) : null;
const sansa = hasEcosystem ? await import(pathToFileURL(sansaIndex).href) : null;
const sansaWorkbench = hasEcosystem ? await import(pathToFileURL(sansaRuntime).href) : null;

// Mock incoming JSON payload (e.g., from an external HTTP API or database dump)
const IMPORTED_JSON = JSON.stringify({
  catalog: {
    region: 'ap-southeast-2',
    updated_batch: 42,
    orders: [
      {
        id: 'ORD-1001',
        customer: 'Ada Lovelace',
        status: 'shipped',
        total: 149.50,
        discount_code: 'AEON10',
        tags: ['priority', 'international'],
      },
      {
        id: 'ORD-1002',
        customer: 'Alan Turing',
        status: 'processing',
        total: 85.00,
        discount_code: null, // becomes NullLiteral with value "none" (!none)
        tags: ['standard'],
      },
      {
        id: 'ORD-1003',
        customer: 'Grace Hopper',
        status: 'shipped',
        total: 320.00,
        discount_code: null,
        tags: ['priority', 'bulk'],
      },
      {
        id: 'ORD-1004',
        customer: 'Edsger Dijkstra',
        status: 'cancelled',
        total: 15.25,
        discount_code: 'CLEARANCE',
        tags: ['standard'],
      },
    ],
  },
});

// AEOS SchemaV1 governing the imported JSON stream
const CATALOG_SCHEMA = {
  rules: [
    {
      path: '$.catalog',
      constraints: { required: true, type: 'ObjectNode' },
    },
    {
      path: '$.catalog.region',
      constraints: { required: true, type: 'StringLiteral', min_length: 2 },
    },
    {
      path: '$.catalog.updated_batch',
      constraints: {
        required: true,
        type: 'NumberLiteral',
        sign: 'unsigned',
        min_value: '1',
      },
    },
    {
      path: '$.catalog.orders',
      constraints: { required: true, type: 'ListNode', min_children: 1 },
    },
    {
      selector: '$.catalog.orders.*.id',
      constraints: {
        required: true,
        type: 'StringLiteral',
        pattern: '^ORD-[0-9]{4}$',
      },
    },
    {
      selector: '$.catalog.orders.*.customer',
      constraints: { required: true, type: 'StringLiteral', min_length: 1 },
    },
    {
      selector: '$.catalog.orders.*.status',
      constraints: {
        required: true,
        type: 'StringLiteral',
        pattern: '^(shipped|processing|cancelled)$',
      },
    },
    {
      selector: '$.catalog.orders.*.total',
      constraints: {
        required: true,
        type: 'NumberLiteral',
        min_value: '0',
        max_value: '10000',
      },
    },
    {
      // JSON `null` projects to NullLiteral with value="none" (!none).
      // AEOS can require that any null present on this field uses sentinel `none`.
      selector: '$.catalog.orders.*.discount_code',
      constraints: {
        required: true,
        type: 'StringLiteral',
        nullable: true,
        null_value: 'none',
      },
    },
    {
      selector: '$.catalog.orders.*.tags',
      constraints: { required: true, type: 'ListNode', min_children: 1 },
    },
    {
      selector: '$.catalog.orders.*.tags.*',
      constraints: { required: true, type: 'StringLiteral' },
    },
  ],
};

test(
  'Integration: JSON -> AES (Telex) -> AEOS schema validation -> SANSA query execution',
  { skip: !hasEcosystem && 'AEOS or SANSA sibling build not found' },
  async () => {
    // 1. Convert raw JSON into portable AES records and canonical Telex
    const aesRecords = jsonToAes(IMPORTED_JSON);
    const telexStream = jsonToTelex(IMPORTED_JSON);

    // Verify JSON numbers were canonicalized (149.50 -> 149.5, 85.00 -> 85)
    // and JSON nulls became NullLiteral "none"
    const ord1Total = aesRecords.find((r) => r.path === '$.catalog.orders[0].total');
    assert.deepEqual(ord1Total, {
      path: '$.catalog.orders[0].total',
      kind: 'NumberLiteral',
      value: '149.5',
    });
    const ord2Discount = aesRecords.find((r) => r.path === '$.catalog.orders[1].discount_code');
    assert.deepEqual(ord2Discount, {
      path: '$.catalog.orders[1].discount_code',
      kind: 'NullLiteral',
      value: 'none',
    });

    // 2. Validate the Telex stream with AEOS
    const validation = aeos.validateTelex(telexStream, CATALOG_SCHEMA);
    assert.equal(validation.ok, true, `AEOS errors: ${JSON.stringify(validation.errors)}`);
    assert.deepEqual(validation.errors, []);
    assert.ok(validation.guarantees['$.catalog.updated_batch']?.includes('integer-representable'));

    // Prove AEOS rejects a JSON payload that violates the schema (e.g. bad ID pattern & negative total)
    const invalidJson = JSON.stringify({
      catalog: {
        region: 'ap-southeast-2',
        updated_batch: 42,
        orders: [
          {
            id: 'BAD-ID',
            customer: 'Mallory',
            status: 'shipped',
            total: -5,
            discount_code: null,
            tags: ['standard'],
          },
        ],
      },
    });
    const failedValidation = aeos.validateTelex(jsonToTelex(invalidJson), CATALOG_SCHEMA);
    assert.equal(failedValidation.ok, false);
    assert.ok(
      failedValidation.errors.some((e) => e.path === '$.catalog.orders[0].id'),
      'expected AEOS pattern failure on $.catalog.orders[0].id',
    );
    assert.ok(
      failedValidation.errors.some((e) => e.path === '$.catalog.orders[0].total'),
      'expected AEOS numeric bound failure on $.catalog.orders[0].total',
    );

    // 3. Load the AEOS-validated Telex stream into a SANSA namespace and run SANSA queries
    const nsLoaded = await sansaWorkbench.namespaceFromTelexSource(telexStream);
    assert.equal(nsLoaded.ok, true, `SANSA Telex load failed: ${JSON.stringify(nsLoaded)}`);

    // Query A: Filter shipped orders with total >= 100, ordered by total descending, projecting id & customer
    const shippedQuery = `
      from $.catalog.orders.*
      where .status == "shipped" and .total >= 100
      order by .total desc
      select { id = .id customer = .customer total = .total }
    `;
    const shippedResult = sansa.evaluateQuery(shippedQuery, nsLoaded.namespace);
    assert.equal(shippedResult.ok, true, JSON.stringify(shippedResult.errors));
    assert.deepEqual(
      shippedResult.results.map((entry) => ({
        id: entry.value.value.id,
        customer: entry.value.value.customer,
        total: entry.value.value.total,
      })),
      [
        { id: 'ORD-1003', customer: 'Grace Hopper', total: '320' },
        { id: 'ORD-1001', customer: 'Ada Lovelace', total: '149.5' },
      ],
    );

    // Query B: Query orders that have a "priority" tag using `any(...)`
    const priorityQuery = `
      from $.catalog.orders.*
      where any(.tags.* == "priority")
      order by .id asc
      select .id
    `;
    const priorityResult = sansa.evaluateQuery(priorityQuery, nsLoaded.namespace);
    assert.equal(priorityResult.ok, true, JSON.stringify(priorityResult.errors));
    assert.deepEqual(
      priorityResult.results.map((entry) => ({
        address: entry.value.bindings[0].address,
        value: entry.value.bindings[0].value,
      })),
      [
        { address: '$.catalog.orders[0].id', value: 'ORD-1001' },
        { address: '$.catalog.orders[2].id', value: 'ORD-1003' },
      ],
    );

    // Query C: Query orders where `discount_code` is not null (`not isNull(.discount_code)`)
    const discountQuery = `
      from $.catalog.orders.*
      where not isNull(.discount_code) and (.discount_code == "AEON10" or .discount_code == "CLEARANCE")
      order by .id asc
      select { id = .id code = .discount_code }
    `;
    const discountResult = sansa.evaluateQuery(discountQuery, nsLoaded.namespace);
    assert.equal(discountResult.ok, true, JSON.stringify(discountResult.errors));
    assert.deepEqual(
      discountResult.results.map((entry) => ({
        id: entry.value.value.id,
        code: entry.value.value.code,
      })),
      [
        { id: 'ORD-1001', code: 'AEON10' },
        { id: 'ORD-1004', code: 'CLEARANCE' },
      ],
    );

    // Query D: Query orders where JSON `null` became AEON `!none` (`isNullReason(.discount_code, "none")`)
    const nullReasonQuery = `
      from $.catalog.orders.*
      where isNullReason(.discount_code, "none")
      order by .id asc
      select .id
    `;
    const nullReasonResult = sansa.evaluateQuery(nullReasonQuery, nsLoaded.namespace);
    assert.equal(nullReasonResult.ok, true, JSON.stringify(nullReasonResult.errors));
    assert.deepEqual(
      nullReasonResult.results.map((entry) => entry.value.bindings[0].value),
      ['ORD-1002', 'ORD-1003'],
    );
  },
);

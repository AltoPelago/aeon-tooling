/**
 * Differential and full-pipeline integration tests for `@altopelago/xml-core`
 * against the Aeonite ecosystem (`aes`, `aeon-core`, `aeon-aeos`, `sansa`, and
 * `aeonite-cts`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_XML_AES_LIMITS,
  xmlToAeon,
  xmlToTelex,
} from '../../test-support/xml-core.js';

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
  'CTS: DEFAULT_XML_AES_LIMITS matches altopelago.aeonic-limits.v1 defaults',
  { skip: !existsSync(ctsRoot) && 'aeonite-cts not found' },
  () => {
    const suite = JSON.parse(
      readFileSync(resolve(ctsRoot, 'core/v1/suites/16-aeonic-limit-boundaries.json'), 'utf8'),
    );
    const defaults = suite.meta.limits_defaults;
    assert.equal(DEFAULT_XML_AES_LIMITS.maxValueNestingDepth, defaults.structure.max_value_nesting_depth);
    assert.equal(DEFAULT_XML_AES_LIMITS.maxPathDepth, defaults.structure.max_path_depth);
    assert.equal(DEFAULT_XML_AES_LIMITS.maxPathCharacters, defaults.structure.max_path_characters);
    assert.equal(DEFAULT_XML_AES_LIMITS.maxStringCodepoints, defaults.structure.max_string_codepoints);
    assert.equal(DEFAULT_XML_AES_LIMITS.maxKeySegmentCodepoints, defaults.structure.max_key_segment_codepoints);
    assert.equal(DEFAULT_XML_AES_LIMITS.maxEvents, defaults.processing.max_events);
    assert.equal(DEFAULT_XML_AES_LIMITS.maxInputBytes, defaults.formats.aeon.max_input_bytes);
  },
);

test(
  'Differential: Section 6.1 and Section 6.3 XML examples compile to byte-identical Telex as AEON Core',
  { skip: (!aes || !core) && 'aes or aeon-core not found' },
  () => {
    // Section 6.1 example
    const xml61 = `<?xml version="1.0"?>
<person id="123">
  <name:user>Alice</name:user>
  <!-- comments can be converted -->
  mixed strings between nodes
  <age>30</age>
  <purchase price="3.30">cards</purchase>
  <purchase price="6.99">paper</purchase>
</person>`;

    const aeon61 = `xml@{version="1.0"} = <person @{id="123"} (
  <"name:user" ("Alice")>
  /* comments can be converted */
  "mixed strings between nodes"
  <age ("30")>
  <purchase @{price="3.30"} ("cards")>
  <purchase @{price="6.99"} ("paper")>
)>`;

    const telexFromXml61 = xmlToTelex(xml61);
    const validated61 = aes.validateTelex(telexFromXml61);
    assert.deepEqual(validated61.diagnostics, []);
    assert.equal(aes.canonicalizeTelex(telexFromXml61), telexFromXml61);

    const telexFromAeon61 = core.compileToTelex(aeon61, {}).telex;
    assert.equal(telexFromXml61, telexFromAeon61);

    // Section 6.3 example
    const xml63 = `<product price="3.30" quantity="2">
  <name>Paper</name>
</product>`;

    const aeon63 = `xml = <product @{price="3.30", quantity="2"} (
  <name ("Paper")>
)>`;

    const telexFromXml63 = xmlToTelex(xml63);
    const validated63 = aes.validateTelex(telexFromXml63);
    assert.deepEqual(validated63.diagnostics, []);
    assert.equal(telexFromXml63, core.compileToTelex(aeon63, {}).telex);

    // Section 6.5 namespace example
    const xml65 = `<user:name xmlns:user="urn:people">Alice</user:name>`;
    const aeon65 = `xml = <"user:name" @{"xmlns:user"="urn:people"} ("Alice")>`;
    const telexFromXml65 = xmlToTelex(xml65);
    assert.deepEqual(aes.validateTelex(telexFromXml65).diagnostics, []);
    assert.equal(telexFromXml65, core.compileToTelex(aeon65, {}).telex);
  },
);

test(
  'Integration: XML -> AES (Telex) -> AEOS schema validation -> SANSA query over repeated nodes, attributes, and mixed content',
  { skip: (!aeos || !sansa || !sansaWorkbench) && 'AEOS or SANSA not found' },
  async () => {
    const xmlInput = `<?xml version="1.0" encoding="UTF-8"?>
<person id="123" tier="gold">
  <name:user xmlns:name="urn:people">Alice</name:user>
  mixed strings between nodes
  <age>30</age>
  <purchase price="3.30" currency="AUD">cards</purchase>
  <purchase price="6.99" currency="AUD">paper</purchase>
  <purchase price="12.50" currency="USD">ink</purchase>
</person>`;

    const telex = xmlToTelex(xmlInput);

    // 1. Validate with AEOS schema rules across NodeLiteral, NodeHead, and .@. StringLiteral attributes
    const schema = {
      rules: [
        { path: '$.xml', constraints: { required: true, type: 'NodeLiteral' } },
        { path: '$.xml.@.version', constraints: { required: true, type: 'StringLiteral', pattern: '^1\\.0$' } },
        { path: '$.xml.@.encoding', constraints: { required: true, type: 'StringLiteral', pattern: '^UTF-8$' } },
        { path: '$.xml[0]', constraints: { required: true, type: 'NodeHead', pattern: '^person$' } },
        { path: '$.xml[0].@.id', constraints: { required: true, type: 'StringLiteral', pattern: '^[0-9]+$' } },
        { path: '$.xml[0].@.tier', constraints: { required: true, type: 'StringLiteral', pattern: '^(silver|gold|platinum)$' } },
      ],
    };

    const validation = aeos.validateTelex(telex, schema);
    assert.equal(validation.ok, true, `AEOS errors: ${JSON.stringify(validation.errors)}`);
    // Verify AEOS computed numeric representation guarantees on the uncoerced XML StringLiterals
    assert.ok(validation.guarantees['$.xml[0].@.id'].includes('integer-representable'));
    assert.ok(validation.guarantees['$.xml[0][3][0].@.price'].includes('float-representable'));

    // 2. Load into SANSA and query across repeated <purchase> elements and attributes even with mixed string siblings
    const nsLoaded = await sansaWorkbench.namespaceFromTelexSource(telex);
    assert.equal(nsLoaded.ok, true);

    const audPurchasesQuery = `
      from $.xml[0].*[0]
      where . == "purchase" and .@.currency == "AUD"
      select { item = .[0] price = .@.price }
    `;
    const queryResult = sansa.evaluateQuery(audPurchasesQuery, nsLoaded.namespace);
    assert.equal(queryResult.ok, true, JSON.stringify(queryResult.errors));
    assert.deepEqual(
      queryResult.results.map((r) => r.value.value),
      [
        { item: 'cards', price: '3.30' },
        { item: 'paper', price: '6.99' },
      ],
    );
  },
);

test('Examples: person.xml and inventory.xml match their canonical .telex.aes snapshots', () => {
  for (const name of ['person', 'inventory']) {
    const src = readFileSync(resolve(here, '..', 'examples', `${name}.xml`), 'utf8');
    const expectedTelex = readFileSync(resolve(here, '..', 'examples', `${name}.native.telex.aes`), 'utf8');
    const actualTelex = xmlToTelex(src);
    assert.equal(actualTelex, expectedTelex, `${name}.xml snapshot mismatch`);
    if (aes) {
      assert.deepEqual(aes.validateTelex(actualTelex).diagnostics, []);
    }
  }
});

test(
  'XML -> AEON matches canonical AEON representation (@altopelago/aeon-canonical)',
  { skip: !canonical && 'aeon canonical dist not found' },
  () => {
    const xml61 = readFileSync(resolve(here, '..', 'examples', 'person.xml'), 'utf8');
    const aeon61 = `xml@{version="1.0"} = <person @{id="123"} (
  <"name:user" ("Alice")>
  /* comments can be converted */
  "mixed strings between nodes"
  <age ("30")>
  <purchase @{price="3.30"} ("cards")>
  <purchase @{price="6.99"} ("paper")>
)>`;

    const fromXml61 = xmlToAeon(xml61);
    const expectedCanonical61 = canonical.canonicalize(aeon61);
    assert.deepEqual(expectedCanonical61.errors, []);
    assert.equal(fromXml61, expectedCanonical61.text);
    assert.equal(canonical.canonicalize(fromXml61).text, fromXml61);

    const xmlInv = readFileSync(resolve(here, '..', 'examples', 'inventory.xml'), 'utf8');
    const aeonInv = `xml@{version="1.0", encoding="UTF-8"} = <inventory @{warehouse="Melbourne 2", "xmlns:inv"="urn:altopelago:inventory"} (
  <"inv:item" @{sku="A-100", qty="03", price="19.50", discontinued="false"} (
    <name ("Anchor")>
    <notes ("Heavy-duty <galvanized> steel & chain ready")>
  )>
  <"inv:item" @{sku="B-200", qty="12", price="7.25", discontinued="false"} (
    <name ("Buoy")>
  )>
  <"inv:item" @{sku="B-210", qty="04", price="11.00", discontinued="true"} (
    <name ("Buoy (large)")>
  )>
)>`;

    const fromXmlInv = xmlToAeon(xmlInv);
    const expectedCanonicalInv = canonical.canonicalize(aeonInv);
    assert.deepEqual(expectedCanonicalInv.errors, []);
    assert.equal(fromXmlInv, expectedCanonicalInv.text);
    assert.equal(canonical.canonicalize(fromXmlInv).text, fromXmlInv);
  },
);

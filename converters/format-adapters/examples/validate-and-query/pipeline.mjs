import { jsonToAes, encodeTelex } from '../../json-core/src/index.js';
import { tomlToAes } from '../../toml-core/src/index.js';
import { yamlToAes } from '../../yaml-core/src/index.js';
import { xmlToAes } from '../../xml-core/src/index.js';
import { alogToAes } from '../../alog-core/src/index.js';

const importers = { json: jsonToAes, toml: tomlToAes, yaml: yamlToAes, xml: xmlToAes, alog: alogToAes };

// Local development examples deliberately use matching sibling checkouts. SANSA's
// workbench bridge supports complete portable AES without rebuilding a parser AST.
export async function loadRuntimes() {
  try {
    const [aeos, sansa, bridge] = await Promise.all([
      import('../../../../../aeon/implementations/typescript/packages/aeos/dist/index.js'),
      import('../../../../../sansa/src/index.js'),
      import('../../../../../sansa/tools/query-web/runtime.mjs'),
    ]);
    return {
      validate: aeos.validate,
      parseSchemaSource: aeos.parseSchemaSource,
      evaluateQuery: sansa.evaluateQuery,
      evaluateTelexQuery: bridge.evaluateQueryForWorkbench,
      namespaceFromTelexSource: bridge.namespaceFromTelexSource,
    };
  } catch (error) {
    throw new Error('Build the sibling aeon TypeScript packages and provide the sibling sansa checkout; see examples/validate-and-query/README.md.', { cause: error });
  }
}

export function importToAes(format, source) {
  if (!Object.hasOwn(importers, format)) throw new Error(`Unknown source format: ${format}`);
  return importers[format](source);
}

export async function runPipeline({ format, source, schema, queries }, runtime) {

  // 1. Import text directly into portable AES. Values retain their AEON kinds.
  const records = importToAes(format, source);
  // 2. Validate those records, before exposing data to application queries.
  const validation = runtime.validate(records, runtime.parseSchemaSource(schema));
  if (!validation.ok) return { records, validation, queries: [] };

  // 3. Telex transports the SAME records to SANSA's complete-AES namespace host.
  const telex = encodeTelex(records);
  const mounted = await runtime.namespaceFromTelexSource(telex);
  if (!mounted.ok) throw new Error(`Cannot mount AES for SANSA: ${JSON.stringify(mounted.errors)}`);
  const results = queries.map(({ text }) => {
    const result = runtime.evaluateQuery(text, mounted.namespace);
    if (!result.ok) throw new Error(`SANSA query failed: ${JSON.stringify(result.errors)}`);
    return { text, result };
  });
  return { records, validation, telex, queries: results };
}

// Keep addresses and representation kinds visible; never coerce exact numeric
// lexemes to machine numbers merely to display the example's query results.
export function summarizeQuery(result) {
  return result.results.flatMap(row => {
    if (row.value.type !== 'bindingSet') throw new Error('These examples expect binding projections');
    return row.value.bindings.map(binding => ({
      address: binding.address,
      kind: binding.representationKind,
      ...(binding.datatype === undefined ? {} : { datatype: binding.datatype }),
      value: binding.value,
    }));
  });
}

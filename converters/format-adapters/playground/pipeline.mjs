import { encodeAdapterTelex, importToAes, loadRuntimes } from '../examples/validate-and-query/pipeline.mjs';

const diagnostic = (error, code) => ({ code, message: error.message });
export function createPipelineRunner(load = loadRuntimes) {
  let runtimePromise;
  return async input => {
    if (!input || !['json', 'toml', 'xml', 'yaml', 'alog'].includes(input.format)) {
      throw Object.assign(new Error('Choose JSON, TOML, XML, YAML or ALOG for the pipeline source.'), { code: 'INVALID_FORMAT' });
    }
    for (const [field, limit] of [['schema', 262_144], ['query', 65_536]]) {
      if (typeof input[field] !== 'string' || Buffer.byteLength(input[field]) > limit) {
        throw Object.assign(new Error(`${field} must be text up to ${limit / 1024} KiB.`), { code: 'INVALID_INPUT' });
      }
    }
    if (typeof input.runQuery !== 'boolean') {
      throw Object.assign(new Error('runQuery must be a boolean.'), { code: 'INVALID_INPUT' });
    }
    const records = importToAes(input.format, input.source);
    const output = { records, telex: encodeAdapterTelex(input.format, records), validation: null, query: null };
    let runtime;
    try {
      // Failed setup can be retried after a local build without restarting.
      runtimePromise ??= load().catch(error => { runtimePromise = undefined; throw error; });
      runtime = await runtimePromise;
    } catch (error) { return { ...output, runtimeError: diagnostic(error, 'PIPELINE_RUNTIME_UNAVAILABLE') }; }
    let schema;
    try { schema = runtime.parseSchemaSource(input.schema); }
    catch (error) { return { ...output, schemaError: diagnostic(error, 'INVALID_SCHEMA') }; }
    output.validation = runtime.validate(records, schema);
    if (!output.validation.ok || !input.runQuery) return output;
    if (input.format === 'xml') {
      try { await runtime.requireXmlQuerySupport(); }
      catch (error) { return { ...output, runtimeError: diagnostic(error, 'XML_QUERY_RUNTIME_UNAVAILABLE') }; }
    }
    // The bridge returns JSON-safe scalar/object/binding projections as well as
    // addresses and kind metadata. It does not materialize records through JSON.
    output.query = await runtime.evaluateTelexQuery({
      sourceKind: 'telex', source: output.telex, query: input.query,
      transformExtensions: false,
      budget: { maxFromBindings: 10_000, maxWhereCandidates: 10_000, maxOrderCandidates: 10_000, maxResultRecords: 1_000 },
    });
    return output;
  };
}

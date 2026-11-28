import { attachHighlightEditor } from './editor-highlighting.js';
import { highlightSource } from './source-highlighting.js';
import { highlightValidation, highlightQueryResults, highlightDiagnostic } from './result-highlighting.js';

const $ = id => document.getElementById(id);
const pretty = value => JSON.stringify(value, null, 2);
const labels = { json: 'JSON', toml: 'TOML', yaml: 'YAML', xml: 'XML', alog: '&LOG v1' };

export function initPipeline() {
  const editors = new Map(['schema', 'query'].map(name => [`pipeline-${name}`,
    attachHighlightEditor($(`pipeline-${name}`), $(`pipeline-${name}-highlight`), name === 'query' ? 'sansa' : 'aeon')]));
  editors.set('pipeline-source', attachHighlightEditor($('pipeline-source'), $('pipeline-source-highlight'), source => highlightSource(source, $('pipeline-format').value)));
  let examples = [], activeExample, aes, version = 0, controller;
  const showStatus = (id, text, kind = '') => {
    $(id).textContent = text; $(id).className = `status ${kind}`;
  };
  const message = (text, kind = '') => {
    $('pipeline-status').textContent = text;
    $('pipeline-status').className = `pipeline-status ${kind}`;
  };
  const enable = () => {
    for (const id of ['pipeline-validate', 'pipeline-run']) $(id).disabled = !examples.length;
  };
  function renderAes() {
    if (!aes) { $('pipeline-aes').textContent = 'Import the current source to inspect its AES.'; return; }
    const telex = $('pipeline-aes-view').value === 'telex';
    $('pipeline-aes').innerHTML = highlightSource(telex ? aes.telex : pretty(aes.records), telex ? 'telex' : 'json');
  }
  function invalidate(scope) {
    version++; controller?.abort(); enable();
    if (scope === 'source') {
      aes = undefined; renderAes();
      $('pipeline-aes-note').textContent = 'Source changed. Import to refresh AES.';
    }
    if (scope !== 'query' || !aes) {
      showStatus('pipeline-validation-status', 'Edited');
      $('pipeline-validation').textContent = 'Source or schema changed. Import & validate to update this result.';
    }
    showStatus('pipeline-query-status', 'Edited');
    $('pipeline-results').textContent = 'Inputs changed. Run the current query to update results.';
    $('pipeline-result-note').textContent = 'Results retain source addresses and representation kinds.';
    message('Edited. Run the pipeline to update results.');
  }
  function describeExample() {
    const example = examples.find(entry => entry.format === $('pipeline-example').value);
    if (example) $('pipeline-description').textContent = example.description;
  }
  function loadExample(invalid = false) {
    activeExample = examples.find(entry => entry.format === $('pipeline-example').value);
    if (!activeExample) return;
    $('pipeline-format').value = activeExample.format;
    $('pipeline-source').value = invalid ? activeExample.invalidSource : activeExample.source;
    $('pipeline-schema').value = activeExample.schema;
    const options = activeExample.queries.map((query, index) => {
      const option = document.createElement('option'); option.value = index;
      option.textContent = `${index + 1}. ${query.text}`; return option;
    });
    $('pipeline-query-choice').replaceChildren(...options);
    $('pipeline-query').value = activeExample.queries[0].text;
    for (const refresh of editors.values()) refresh();
    describeExample(); invalidate('source');
    run(true);
  }
  async function run(runQuery) {
    controller?.abort(); controller = new AbortController();
    const id = ++version;
    for (const button of ['pipeline-validate', 'pipeline-run']) $(button).disabled = true;
    // Clear previous results immediately, including previously successful AES if
    // the current import fails. An old result is never presented as current.
    aes = undefined; renderAes();
    $('pipeline-aes-note').textContent = 'Importing current source…';
    showStatus('pipeline-validation-status', 'Validating…', 'busy');
    $('pipeline-validation').textContent = 'Importing AES and checking the current schema…';
    showStatus('pipeline-query-status', runQuery ? 'Waiting…' : 'Not run');
    $('pipeline-results').textContent = runQuery ? 'Waiting for AEOS validation…' : 'Press Run query after validation.';
    message('Running the pipeline…');
    try {
      const response = await fetch('/api/pipeline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ format: $('pipeline-format').value, source: $('pipeline-source').value,
          schema: $('pipeline-schema').value, query: $('pipeline-query').value, runQuery }),
      });
      const result = await response.json();
      if (id !== version) return;
      if (!response.ok) {
        const location = [result.path, result.line ? `line ${result.line}` : ''].filter(Boolean).join(' · ');
        throw new Error(`${result.code ?? 'PIPELINE_ERROR'}${location ? ` · ${location}` : ''}\n${result.error}`);
      }
      aes = result; renderAes();
      $('pipeline-aes-note').textContent = `${result.records.length} AES records · ${labels[$('pipeline-format').value]} source`;
      if (result.runtimeError || result.schemaError) {
        const error = result.runtimeError ?? result.schemaError;
        showStatus('pipeline-validation-status', result.runtimeError ? 'Unavailable' : 'Invalid schema', 'error');
        $('pipeline-validation').innerHTML = highlightDiagnostic(error);
        showStatus('pipeline-query-status', 'Skipped');
        $('pipeline-results').textContent = 'Query skipped. Resolve the validation diagnostic first.';
        message('AES imported. Validation needs attention.', 'error'); return;
      }
      const validation = result.validation;
      showStatus('pipeline-validation-status', validation.ok ? 'Passed' : 'Failed', validation.ok ? '' : 'error');
      $('pipeline-validation').innerHTML = highlightValidation(validation);
      if (!validation.ok) {
        showStatus('pipeline-query-status', 'Skipped');
        $('pipeline-results').textContent = 'Query skipped because AEOS validation failed. Edit the source or schema and run again.';
        message('AES imported. AEOS rejected the data; queries were skipped.', 'error'); return;
      }
      if (!result.query) { message('AES imported. AEOS validation passed.'); return; }
      const query = result.query;
      $('pipeline-results').innerHTML = highlightQueryResults(query);
      if (query.errors?.some(({code}) => code === 'XML_QUERY_RUNTIME_UNAVAILABLE')) {
        showStatus('pipeline-query-status', 'Unavailable', 'error');
        $('pipeline-result-note').textContent = 'Update the local SANSA Workbench to run XML queries.';
        message('AEOS passed. XML querying is unavailable.', 'error');
        return;
      }
      showStatus('pipeline-query-status', query.ok ? `${query.count} ${query.count === 1 ? 'result' : 'results'}` : 'Query error', query.ok ? '' : 'error');
      $('pipeline-result-note').textContent = query.ok ? 'Values and source bindings from the current query.' : 'Edit the SANSA query and run again. AES and AEOS results remain available.';
      message(query.ok ? 'AES imported. AEOS passed. SANSA query complete.' : 'AEOS passed. The SANSA query needs attention.', query.ok ? '' : 'error');
    } catch (error) {
      if (error.name === 'AbortError' || id !== version) return;
      showStatus('pipeline-validation-status', 'Unavailable', 'error');
      $('pipeline-validation').textContent = error.message;
      $('pipeline-aes-note').textContent = 'Import did not complete.';
      showStatus('pipeline-query-status', 'Skipped');
      $('pipeline-results').textContent = 'Pipeline did not complete. Resolve the diagnostic and retry.';
      message('Pipeline could not complete. Check the diagnostic and local server.', 'error');
    } finally { if (id === version) enable(); }
  }
  for (const [button, visible] of [['view-convert', false], ['view-pipeline', true]]) {
    $(button).addEventListener('click', () => {
      $('conversion-workspace').hidden = visible;
      $('pipeline-workspace').hidden = !visible;
      $('view-convert').setAttribute('aria-pressed', String(!visible));
      $('view-pipeline').setAttribute('aria-pressed', String(visible));
    });
  }
  for (const id of ['pipeline-source', 'pipeline-schema', 'pipeline-query']) {
    const scope = id.split('-')[1];
    $(id).addEventListener('input', () => invalidate(scope));
    $(id).addEventListener('keydown', event => {
      if (event.key === 'Tab') {
        event.preventDefault(); $(id).setRangeText('  ', $(id).selectionStart, $(id).selectionEnd, 'end'); editors.get(id)?.(); invalidate(scope);
      }
    });
  }
  $('pipeline-format').addEventListener('change', () => { editors.get('pipeline-source')(); invalidate('source'); });
  $('pipeline-aes-view').addEventListener('change', renderAes);
  $('pipeline-example').addEventListener('change', describeExample);
  $('pipeline-load').addEventListener('click', () => loadExample());
  $('pipeline-invalid').addEventListener('click', () => loadExample(true));
  $('pipeline-query-choice').addEventListener('change', () => {
    const query = activeExample?.queries[Number($('pipeline-query-choice').value)];
    if (query) { $('pipeline-query').value = query.text; editors.get('pipeline-query')(); invalidate('query'); }
  });
  $('pipeline-validate').addEventListener('click', () => run(false));
  $('pipeline-run').addEventListener('click', () => run(true));
  document.addEventListener('keydown', event => {
    if (!$('pipeline-workspace').hidden && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault(); if (!$('pipeline-run').disabled) run(true);
    }
  });
  async function loadExamples() {
    try {
      const response = await fetch('/api/pipeline/examples');
      if (!response.ok) throw new Error('Examples unavailable');
      ({ examples } = await response.json());
      $('pipeline-example').replaceChildren(...examples.map(example => {
        const option = document.createElement('option'); option.value = example.format;
        option.textContent = `${labels[example.format]} · validate & query`; return option;
      }));
      for (const id of ['pipeline-example', 'pipeline-load', 'pipeline-invalid']) $(id).disabled = false;
      enable(); loadExample();
    } catch { message('Could not load examples. Check the playground server and reload.', 'error'); }
  }
  loadExamples();
}

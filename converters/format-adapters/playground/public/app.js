import { highlightAeon } from '/highlighter.js';
import { samples, sampleFor, examplesFor } from './examples.js';
const $ = id => document.getElementById(id);
const labels = {aeon: 'AEON', json: 'JSON', xml: 'XML', toml: 'TOML', yaml: 'YAML', alog: '&LOG v1'};
const hints = {
  aeon: 'Use ordinary AEON bindings, or an imported root under "".',
  json: 'Objects, arrays and scalar roots are supported.',
  xml: 'Elements, string attributes, mixed content and CDATA boundaries are supported.',
  toml: 'A TOML document maps to an object root.',
  yaml: 'YAML 1.2 Core · one document · no aliases or explicit tags.',
  alog: '&LOG v1 · comma-separated scalar fields · one record per line.',
};
let previousFormat = 'json', output = '', outputPair = '', requestId = 0, controller, timer;
const drafts = new Map();
let visibleExamples = [];
const pair = () => JSON.stringify([$('from').value, $('to').value, $('mode').value, $('source').value]);
const count = text => `${[...text].length.toLocaleString()} characters`;
function describeExample() {
  const selected = visibleExamples.find(example => example.id === $('example-choice').value);
  if (!selected) return;
  $('example-description').textContent = `${labels[selected.from]} → ${labels[selected.to]} · ${selected.description}`;
  $('example-expectations').textContent = `Lossless: ${selected.expected.lossless.description} Lossy: ${selected.expected.lossy.description}`;
}
function syncExamples(preferredId = $('example-choice').value) {
  visibleExamples = examplesFor($('from').value, $('to').value);
  const groups = new Map();
  for (const example of visibleExamples) {
    const category = example.expected.lossless.outcome === 'error' ? 'Compare modes' : 'Supported features';
    if (!groups.has(category)) { const group = document.createElement('optgroup'); group.label = category; groups.set(category, group); }
    const option = document.createElement('option'); option.value = example.id;
    option.textContent = `${example.title} · ${labels[example.from]} → ${labels[example.to]}`;
    groups.get(category).append(option);
  }
  $('example-choice').replaceChildren(...groups.values());
  $('example-choice').value = visibleExamples.some(example => example.id === preferredId) ? preferredId : visibleExamples[0].id;
  describeExample();
}

function invalidate() {
  requestId++; controller?.abort(); clearTimeout(timer);
  output = ''; outputPair = ''; $('output').textContent = '';
  for (const id of ['copy', 'download', 'swap']) $(id).disabled = true;
  $('output-note').textContent = 'Ready to convert'; $('output-count').textContent = '';
}
function describe() {
  $('source-title').textContent = `${labels[$('from').value]} source`;
  $('output-title').textContent = `${labels[$('to').value]} output`;
  $('source-note').textContent = hints[$('from').value];
  $('source-count').textContent = count($('source').value);
  $('mode-note').textContent = $('mode').value === 'lossy'
    ? 'Lossy mode turns unsupported scalars into strings; their types cannot be restored.'
    : 'Lossless mode rejects values the selected format cannot preserve.';
}
function status(text, kind, details) {
  $('status').textContent = text; $('status').className = `status ${kind}`;
  $('diagnostics').className = kind; $('diagnostics').textContent = details;
}
async function convert() {
  clearTimeout(timer); invalidate(); describe();
  const id = requestId, snapshot = pair();
  controller = new AbortController();
  status('Converting…', 'busy', `Converting ${labels[$('from').value]} to ${labels[$('to').value]}…`);
  $('output-note').textContent = 'Converting…';
  try {
    const response = await fetch('/api/convert', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({from: $('from').value, to: $('to').value, mode: $('mode').value, source: $('source').value}), signal: controller.signal});
    const result = await response.json();
    if (id !== requestId || snapshot !== pair()) return;
    if (!response.ok) {
      const location = [result.path, result.line ? `line ${result.line}${result.column ? `, column ${result.column}` : ''}` : ''].filter(Boolean).join(' · ');
      status('Cannot convert', 'error', `${result.code ?? 'CONVERSION_ERROR'}${location ? ` · ${location}` : ''}\n${result.error}`);
      $('output-note').textContent = 'Resolve the diagnostic to convert this document.';
      return;
    }
    output = result.output; outputPair = snapshot;
    if ($('to').value === 'aeon') $('output').innerHTML = highlightAeon(output);
    else $('output').textContent = output;
    for (const button of ['copy', 'download', 'swap']) $(button).disabled = false;
    $('output-note').textContent = 'Conversion complete'; $('output-count').textContent = count(output);
    const warnings = result.warnings ?? [];
    const warningDetails = warnings.map(warning => {
      const more = warning.occurrences > warning.paths.length ? ` (and ${warning.occurrences - warning.paths.length} more)` : '';
      return [`Warning · ${warning.code}`, ...(warning.paths.length ? [warning.paths.join(', ') + more] : []), warning.message].join('\n');
    });
    status(warnings.length ? 'Converted with warnings' : 'Converted', warnings.length ? 'warning' : '',
      [...(warnings.length ? [] : ['No errors detected.']), ...result.notes, ...warningDetails].join('\n\n'));
  } catch (error) {
    if (error.name === 'AbortError' || id !== requestId) return;
    status('Unavailable', 'error', 'The local converter could not be reached. Check that the playground server is running.');
    $('output-note').textContent = 'Conversion unavailable';
  }
}
function changed() {
  invalidate(); describe();
  status('Edited', '', 'Source or conversion settings changed. Convert to update the output.');
  if ($('auto').checked) timer = setTimeout(convert, 300);
}
$('source').value = samples.json; syncExamples(); describe();
$('source').addEventListener('input', changed);
$('source').addEventListener('keydown', event => {
  if (event.key === 'Tab') { event.preventDefault(); $('source').setRangeText('  ', $('source').selectionStart, $('source').selectionEnd, 'end'); changed(); }
});
$('from').addEventListener('change', () => {
  drafts.set(previousFormat, $('source').value);
  const next = $('from').value;
  if ($('to').value === next) $('to').value = next === 'aeon' ? 'json' : 'aeon';
  $('source').value = drafts.get(next) ?? sampleFor(next, $('to').value); previousFormat = next;
  syncExamples(); changed();
});
$('to').addEventListener('change', () => {syncExamples(); changed();});
$('mode').addEventListener('change', changed);
$('auto').addEventListener('change', () => { clearTimeout(timer); if ($('auto').checked) convert(); });
$('convert').addEventListener('click', convert);
$('example-choice').addEventListener('change', describeExample);
$('example').addEventListener('click', () => {
  const selected = visibleExamples.find(example => example.id === $('example-choice').value);
  if (!selected) return;
  drafts.set(previousFormat, $('source').value);
  $('from').value = selected.from; $('to').value = selected.to; previousFormat = selected.from;
  $('source').value = selected.source; syncExamples(selected.id); convert();
});
$('swap').addEventListener('click', () => {
  if (outputPair !== pair()) return;
  const oldFrom = $('from').value, oldTo = $('to').value, nextSource = output;
  drafts.set(oldFrom, $('source').value);
  $('from').value = oldTo; $('to').value = oldFrom;
  previousFormat = oldTo; $('source').value = nextSource; syncExamples(); convert();
});
$('copy').addEventListener('click', async () => {
  if (outputPair !== pair()) return;
  try { await navigator.clipboard.writeText(output); $('copy').textContent = 'Copied'; setTimeout(() => {$('copy').textContent = 'Copy';}, 1400); }
  catch { status('Copy unavailable', 'error', 'Select and copy the output manually; clipboard access is unavailable.'); }
});
$('download').addEventListener('click', () => {
  if (outputPair !== pair()) return;
  const url = URL.createObjectURL(new Blob([output], {type: 'text/plain;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = `converted.${$('to').value}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('open').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; if (!file) return;
  if (file.size > 1_048_576) { status('File too large', 'error', 'Open a file up to 1 MiB.'); $('file').value = ''; return; }
  try {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer());
    const extension = file.name.split('.').at(-1).toLowerCase();
    const format = ({yml: 'yaml', log: 'alog'})[extension] ?? extension;
    if (labels[format]) { drafts.set(previousFormat, $('source').value); $('from').value = format; previousFormat = format; if ($('to').value === format) $('to').value = format === 'aeon' ? 'json' : 'aeon'; }
    $('source').value = text; syncExamples(); changed();
  } catch { status('Cannot open file', 'error', 'Choose a UTF-8 text file.'); }
  $('file').value = '';
});
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {event.preventDefault(); convert();} });
convert();

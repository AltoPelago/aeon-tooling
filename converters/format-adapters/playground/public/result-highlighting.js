import { highlightSource } from './source-highlighting.js';

const json = value => highlightSource(JSON.stringify(value, null, 2), 'json');

export function highlightValidation(validation) {
  const message = validation.ok ? 'Validation passed.' : 'Validation failed.';
  const state = validation.ok ? 'result-pass' : 'result-fail';
  return `<span class="result-heading ${state}">${message}</span>\n\n${json(validation)}`;
}

export function highlightQueryResults(query) {
  if (!query.ok) return json(query.errors);
  const values = query.count
    ? highlightSource(query.text, 'aeon')
    : '<span class="result-heading">No matching results.</span>';
  return `${values}\n\n<span class="result-heading">Binding details</span>\n${json(query.results)}`;
}

export function highlightDiagnostic(error) {
  // Diagnostic prose is plain escaped text, never parsed as markup or code.
  return `<span class="result-fail">${highlightSource(error.code, 'text')}</span>\n${highlightSource(error.message, 'text')}`;
}

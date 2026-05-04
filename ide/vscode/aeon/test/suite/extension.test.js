const assert = require('assert');
const path = require('path');
const vscode = require('vscode');

async function waitFor(check, { timeoutMs = 8000, intervalMs = 200 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await check();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

function resolveAeonPath(...segments) {
  const toolingRepoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  return path.resolve(toolingRepoRoot, '..', 'aeon', ...segments);
}

suite('AEON extension tests', function () {
  this.timeout(15000);

  test('opens sample AEON file and language is aeon', async () => {
    const sample = resolveAeonPath('stress-tests', 'full', 'full-feature-stress.aeon');
    const doc = await vscode.workspace.openTextDocument(sample);
    await vscode.window.showTextDocument(doc);
    assert.strictEqual(doc.languageId, 'aeon');
  });

  test('provides diagnostics, hover, and completion through the language server', async () => {
    const diagnosticsSample = path.resolve(__dirname, '..', 'fixtures', 'lsp-sample.aeon');
    const diagnosticsDoc = await vscode.workspace.openTextDocument(diagnosticsSample);
    await vscode.window.showTextDocument(diagnosticsDoc);

    const diagnostics = await waitFor(() => {
      const current = vscode.languages.getDiagnostics(diagnosticsDoc.uri);
      return current.length >= 1 ? current : null;
    });
    assert.ok(diagnostics.length >= 1);
    assert.ok(diagnostics.some((diag) => String(diag.code || '').includes('UNKNOWN') || diag.message.length > 0));

    const hoverSample = path.resolve(__dirname, '..', 'fixtures', 'lsp-hover-sample.aeon');
    const hoverDoc = await vscode.workspace.openTextDocument(hoverSample);
    const editor = await vscode.window.showTextDocument(hoverDoc);

    const hoverPosition = new vscode.Position(12, 9);
    const hovers = await waitFor(async () => {
      const current = await vscode.commands.executeCommand('vscode.executeHoverProvider', hoverDoc.uri, hoverPosition);
      return current.length >= 1 ? current : null;
    });
    assert.ok(hovers, 'expected hover results from the language server');
    assert.ok(hovers.length >= 1);
    const hoverText = hovers.map((hover) => hover.contents.map((item) => item.value || item).join(' ')).join(' ');
    assert.ok(/Datatype/.test(String(hoverText)));

    const completionPosition = new vscode.Position(11, 16);
    editor.selection = new vscode.Selection(completionPosition, completionPosition);
    const completions = await waitFor(async () => {
      const current = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', hoverDoc.uri, completionPosition);
      return current.items.length >= 1 ? current : null;
    });
    assert.ok(completions, 'expected completion results from the language server');
    const labels = completions.items.map((item) => item.label.label || item.label);
    assert.ok(labels.includes('config.host'));
  });
});

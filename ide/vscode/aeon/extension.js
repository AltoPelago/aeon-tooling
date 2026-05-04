const path = require('path');
const fs = require('fs');
const vscode = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

let client;

function resolveServerModule() {
  const candidates = [
    path.resolve(__dirname, 'server', 'server.js'),
    path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'aeon',
      'implementations',
      'typescript',
      'tools',
      'aeon-lsp',
      'dist',
      'server.js'
    ),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function activate(context) {
  const serverModule = resolveServerModule();
  if (!serverModule) {
    void vscode.window.showErrorMessage(
      'AEON Language Server was not found. Build aeon/implementations/typescript/tools/aeon-lsp or bundle server/server.js with the extension.'
    );
    return;
  }

  const serverOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc },
  };
  const clientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'aeon' },
      { scheme: 'untitled', language: 'aeon' },
    ],
  };

  client = new LanguageClient('aeon-lsp', 'AEON Language Server', serverOptions, clientOptions);
  context.subscriptions.push(client.start());
}

function deactivate() {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

module.exports = { activate, deactivate };

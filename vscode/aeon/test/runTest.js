const os = require('os');
const path = require('path');
const fs = require('fs');
const { runTests } = require('@vscode/test-electron');

function resolveVsCodeExecutable() {
  const candidates = [
    process.env.VSCODE_EXECUTABLE_PATH,
    '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
    '/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron',
    path.join(process.env.HOME || '', 'Applications', 'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron'),
    path.join(process.env.HOME || '', 'Applications', 'Visual Studio Code - Insiders.app', 'Contents', 'MacOS', 'Electron'),
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
    const testWorkspacePath = path.resolve(__dirname, 'fixtures');
    const vscodeExecutablePath = resolveVsCodeExecutable();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aeon-vscode-'));
    const userDataDir = path.join(tempRoot, 'user');
    const extensionsDir = path.join(tempRoot, 'extensions');

    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(extensionsDir, { recursive: true });

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      ...(vscodeExecutablePath ? { vscodeExecutablePath } : {}),
      launchArgs: [
        testWorkspacePath,
        '--disable-extensions',
        '--user-data-dir',
        userDataDir,
        '--extensions-dir',
        extensionsDir,
      ],
    });
  } catch (err) {
    console.error('Failed to run tests', err);
    process.exit(1);
  }
}

main();

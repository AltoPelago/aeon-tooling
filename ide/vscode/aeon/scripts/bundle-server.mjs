import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const extensionRoot = path.resolve(import.meta.dirname, '..');
const aeonTypescriptRoot = path.resolve(extensionRoot, '..', '..', '..', '..', 'aeon', 'implementations', 'typescript');
const lspRoot = path.join(aeonTypescriptRoot, 'tools', 'aeon-lsp');
const serverRoot = path.join(extensionRoot, 'server');
const serverNodeModules = path.join(serverRoot, 'node_modules');
const requireFromLsp = createRequire(path.join(lspRoot, 'dist', 'server.js'));

const workspacePackages = new Map([
  ['@altopelago/aeon-aes', 'packages/aes'],
  ['@altopelago/aeon-annotation-stream', 'packages/annotation-stream'],
  ['@altopelago/aeon-core', 'packages/core'],
  ['@altopelago/aeon-finalize', 'packages/finalize'],
  ['@altopelago/aeon-lexer', 'packages/lexer'],
  ['@altopelago/aeon-parser', 'packages/parser'],
  ['@altopelago/aeon-profiles', 'packages/profiles'],
  ['@altopelago/aeon-transport', 'packages/transport'],
  ['@altopelago/aeos-core', 'packages/aeos'],
]);

await assertDirectory(path.join(lspRoot, 'dist'));
await fs.rm(serverRoot, { force: true, recursive: true });
await fs.mkdir(serverNodeModules, { recursive: true });

await copyDirectory(path.join(lspRoot, 'dist'), serverRoot, {
  skip: (relativePath) => isGeneratedSidecar(relativePath) || isTestArtifact(relativePath),
});
await fs.writeFile(
  path.join(serverRoot, 'package.json'),
  `${JSON.stringify({ type: 'module', private: true }, null, 2)}\n`
);

const copied = new Set();
const queue = [
  { name: '@altopelago/aeon-core', requireFrom: requireFromLsp },
  { name: '@altopelago/aeon-finalize', requireFrom: requireFromLsp },
  { name: '@altopelago/aeon-profiles', requireFrom: requireFromLsp },
  { name: '@altopelago/aeon-transport', requireFrom: requireFromLsp },
  { name: '@altopelago/aeos-core', requireFrom: requireFromLsp },
  { name: 'vscode-languageserver', requireFrom: requireFromLsp },
  { name: 'vscode-languageserver-textdocument', requireFrom: requireFromLsp },
];

while (queue.length > 0) {
  const { name: packageName, requireFrom } = queue.shift();
  if (copied.has(packageName)) {
    continue;
  }
  copied.add(packageName);

  const packageRoot = workspacePackages.has(packageName)
    ? path.join(aeonTypescriptRoot, workspacePackages.get(packageName))
    : resolvePackageRoot(packageName, requireFrom);
  const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const destination = path.join(serverNodeModules, ...packageName.split('/'));
  const requireFromPackage = createRequire(path.join(packageRoot, 'package.json'));

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rm(destination, { force: true, recursive: true });

  if (workspacePackages.has(packageName)) {
    await copyWorkspacePackage(packageRoot, destination);
  } else {
    await copyDirectory(packageRoot, destination, {
      skip: (relativePath) => relativePath === 'node_modules' || relativePath.startsWith(`node_modules${path.sep}`),
    });
  }

  for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
    queue.push({ name: dependency, requireFrom: requireFromPackage });
  }
}

console.log(`Bundled AEON language server into ${path.relative(extensionRoot, serverRoot)}`);

async function copyWorkspacePackage(sourceRoot, destinationRoot) {
  const packageJson = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  const bundledPackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    type: packageJson.type,
    main: packageJson.main,
    exports: packageJson.exports,
    sideEffects: packageJson.sideEffects,
    dependencies: Object.fromEntries(
      Object.entries(packageJson.dependencies ?? {}).filter(([dependency]) => !workspacePackages.has(dependency))
    ),
  };

  await fs.mkdir(destinationRoot, { recursive: true });
  await fs.writeFile(path.join(destinationRoot, 'package.json'), `${JSON.stringify(bundledPackageJson, null, 2)}\n`);
  await copyDirectory(path.join(sourceRoot, 'dist'), path.join(destinationRoot, 'dist'), {
    skip: (relativePath) => isGeneratedSidecar(relativePath) || isTestArtifact(relativePath),
  });
}

function resolvePackageRoot(packageName, requireFrom) {
  let entry;
  try {
    entry = requireFrom.resolve(`${packageName}/package.json`);
  } catch {
    entry = requireFrom.resolve(packageName);
  }

  let current = path.dirname(entry);
  while (current !== path.dirname(current)) {
    try {
      return path.dirname(requireFrom.resolve(path.join(current, 'package.json')));
    } catch {
      // Keep walking up until we find the package root for packages with exports.
    }
    current = path.dirname(current);
  }
  throw new Error(`Could not resolve package root for ${packageName}`);
}

async function assertDirectory(directory) {
  const stat = await fs.stat(directory).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Expected built AEON language server at ${directory}. Run the AEON TypeScript build first.`);
  }
}

async function copyDirectory(source, destination, options = {}) {
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const relativePath = path.relative(source, sourcePath);
    if (options.skip?.(relativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath, {
        skip: options.skip
          ? (childRelativePath) => options.skip(path.join(relativePath, childRelativePath))
          : undefined,
      });
    } else if (entry.isSymbolicLink()) {
      const realPath = await fs.realpath(sourcePath);
      const stat = await fs.stat(realPath);
      if (stat.isDirectory()) {
        await copyDirectory(realPath, destinationPath, options);
      } else {
        await fs.copyFile(realPath, destinationPath);
      }
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

function isGeneratedSidecar(relativePath) {
  return relativePath.endsWith('.d.ts') || relativePath.endsWith('.d.ts.map') || relativePath.endsWith('.js.map');
}

function isTestArtifact(relativePath) {
  return /(^|[./\\])[^/\\]+\.test\.(js|d\.ts|js\.map|d\.ts\.map)$/.test(relativePath);
}

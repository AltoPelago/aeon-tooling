#!/usr/bin/env node

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { convertFile, convertPath, type ConvertPathOptions } from './markdown-to-and.js';

interface CliOptions extends ConvertPathOptions {
  readonly inputPath: string;
  readonly stdout: boolean;
  readonly json: boolean;
  readonly quiet: boolean;
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);

  if (options === 'help') {
    printHelp();
    return;
  }

  if (options === 'version') {
    process.stdout.write('md-to-and 0.1.0\n');
    return;
  }

  const inputStats = await stat(options.inputPath);
  if (inputStats.isFile()) {
    if (options.stdout) {
      const converted = await convertFile(options.inputPath, {
        andCoreModuleUrl: options.andCoreModuleUrl,
        dryRun: true,
      });
      process.stdout.write(converted.and);
      return;
    }

    const converted = await convertFile(options.inputPath, {
      outPath: options.outPath,
      andCoreModuleUrl: options.andCoreModuleUrl,
      dryRun: options.dryRun,
    });

    emitResultSummary({ converted: [converted], skipped: [] }, options);
    return;
  }

  if (!inputStats.isDirectory()) {
    throw new Error(`Input must be a file or directory: ${options.inputPath}`);
  }

  if (options.stdout) {
    throw new Error('--stdout can only be used with a single file input.');
  }

  const converted = await convertPath(options.inputPath, {
    recursive: options.recursive,
    includeHidden: options.includeHidden,
    outPath: options.outPath,
    andCoreModuleUrl: options.andCoreModuleUrl,
    dryRun: options.dryRun,
  });

  emitResultSummary(converted, options);
}

function emitResultSummary(
  result: { readonly converted: readonly { readonly inputPath: string; readonly outputPath: string; readonly diagnostics: readonly { readonly severity: string; readonly code: string; readonly message: string }[]; readonly written: boolean }[]; readonly skipped: readonly string[] },
  options: CliOptions,
): void {
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2));
    process.stdout.write('\n');
    return;
  }

  if (!options.quiet) {
    for (const entry of result.converted) {
      const mode = entry.written ? 'wrote' : 'dry-run';
      process.stdout.write(`${mode}: ${entry.inputPath} -> ${entry.outputPath}\n`);
      for (const diagnostic of entry.diagnostics) {
        process.stderr.write(`warning [${diagnostic.code}] ${diagnostic.message}\n`);
      }
    }
  }

  process.stdout.write(`converted ${result.converted.length} file(s).\n`);
}

function parseArgs(argv: readonly string[]): CliOptions | 'help' | 'version' {
  if (argv.includes('--help') || argv.includes('-h')) {
    return 'help';
  }

  if (argv.includes('--version')) {
    return 'version';
  }

  const positional: string[] = [];
  let outPath: string | undefined;
  let andCoreModuleUrl: string | undefined;
  let recursive: boolean | undefined;
  let includeHidden = false;
  let dryRun = false;
  let stdout = false;
  let json = false;
  let quiet = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }

    if (!arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }

    switch (arg) {
      case '--out': {
        const value = argv[index + 1];
        if (value === undefined) {
          throw new Error('--out requires a path value.');
        }
        outPath = resolve(value);
        index += 1;
        break;
      }
      case '--and-core': {
        const value = argv[index + 1];
        if (value === undefined) {
          throw new Error('--and-core requires a module URL or path.');
        }
        andCoreModuleUrl = toModuleUrl(value);
        index += 1;
        break;
      }
      case '--recursive':
        recursive = true;
        break;
      case '--no-recursive':
        recursive = false;
        break;
      case '--include-hidden':
        includeHidden = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--stdout':
        stdout = true;
        break;
      case '--json':
        json = true;
        break;
      case '--quiet':
        quiet = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  const input = positional[0];
  if (input === undefined) {
    throw new Error('Missing input path.');
  }

  return {
    inputPath: resolve(input),
    outPath,
    andCoreModuleUrl,
    recursive,
    includeHidden,
    dryRun,
    stdout,
    json,
    quiet,
  };
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: md-to-and <input-path> [options]',
      '',
      'Converts .md files into canonical standalone .and files.',
      '',
      'Options:',
      '  --out <path>            Output file or output root directory',
      '  --recursive             Recurse when input is a directory (default)',
      '  --no-recursive          Disable directory recursion',
      '  --include-hidden        Include dot-prefixed files/directories',
      '  --and-core <module>     Override and-core module URL or path',
      '  --dry-run               Do not write files',
      '  --stdout                Print converted output for single-file input',
      '  --json                  Print machine-readable conversion summary',
      '  --quiet                 Suppress per-file output (summary still printed)',
      '  --version               Show CLI version',
      '  --help, -h              Show this help',
      '',
      'Examples:',
      `  md-to-and ./README.md`,
      `  md-to-and ./docs --recursive`,
      `  md-to-and ./docs --recursive --out ./converted`,
    ].join('\n'),
  );
  process.stdout.write('\n');
}

function toModuleUrl(value: string): string {
  if (value.startsWith('file:') || value.startsWith('http:') || value.startsWith('https:')) {
    return value;
  }
  return pathToFileURL(resolve(value)).href;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`md-to-and: ${message}\n`);
  process.exitCode = 1;
});

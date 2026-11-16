#!/usr/bin/env node
// Usage: toml-aes [--records | --aeon] [--native] [file]
// Reads TOML from `file` (or stdin) and writes canonical telex.aes to stdout.
// --records writes the portable AES records as JSON instead.
// --aeon writes canonical AEON source text instead.
import { readFileSync } from 'node:fs';
import { tomlToAes, encodeTelex, aesToAeon, TomlAesError } from '../src/index.js';

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  process.stdout.write('Usage: toml-aes [--records | --aeon] [--native] [file]\n');
  process.exit(0);
}
const asRecords = args.includes('--records');
const asAeon = args.includes('--aeon');
const file = args.find((arg) => !arg.startsWith('--'));

try {
  const bytes = readFileSync(file ?? 0);
  const records = tomlToAes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), { mapping: args.includes('--native') ? 'native' : 'root' });
  if (asRecords) {
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
  } else if (asAeon) {
    process.stdout.write(aesToAeon(records));
  } else {
    process.stdout.write(encodeTelex(records));
  }
} catch (error) {
  if (error instanceof TomlAesError) {
    const where = error.line !== undefined ? `:${error.line}:${error.column}` : '';
    process.stderr.write(`${file ?? '<stdin>'}${where}: ${error.code}: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

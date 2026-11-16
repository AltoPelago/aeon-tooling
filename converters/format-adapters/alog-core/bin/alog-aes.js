#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { alogToAes, aesToAeon, encodeTelex } from '../src/index.js';
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('Usage: alog-aes [--records | --aeon] [file]'); process.exit(0); }
try {
  if (args.some(a => a.startsWith('--') && !['--records', '--aeon'].includes(a))) throw new Error('Unknown option');
  const records = alogToAes(readFileSync(args.find(a => !a.startsWith('--')) ?? 0));
  process.stdout.write(args.includes('--records') ? JSON.stringify(records, null, 2) + '\n' : args.includes('--aeon') ? aesToAeon(records) : encodeTelex(records));
} catch (error) { console.error(`${error.code ?? error.name}: ${error.message}`); process.exitCode = 1; }

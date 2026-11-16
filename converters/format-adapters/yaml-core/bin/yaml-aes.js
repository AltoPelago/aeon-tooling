#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { yamlToAes, yamlToAesWithAnnotations, yamlToAeon, encodeTelex } from '../src/index.js';
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('Usage: yaml-aes [--records | --annotations | --aeon] [file]'); process.exit(0); }
try {
  let file;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--records', '--annotations', '--aeon'].includes(arg)) continue;
    else if (arg.startsWith('--')) throw new Error('Unknown option');
    else if (file !== undefined) throw new Error('Only one YAML input file is supported');
    else file = arg;
  }
  if (['--records', '--annotations', '--aeon'].filter(flag => args.includes(flag)).length > 1) throw new Error('Choose one output format');
  const input = readFileSync(file ?? 0);
  process.stdout.write(args.includes('--aeon') ? yamlToAeon(input)
    : args.includes('--annotations') ? JSON.stringify(yamlToAesWithAnnotations(input), null, 2) + '\n'
      : args.includes('--records') ? JSON.stringify(yamlToAes(input), null, 2) + '\n'
        : encodeTelex(yamlToAes(input)));
} catch (error) { console.error(`${error.code ?? error.name}: ${error.message}`); process.exitCode = 1; }

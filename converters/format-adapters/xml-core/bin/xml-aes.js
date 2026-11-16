#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { xmlToAes, xmlToTelex, aesToAeon } from '../src/index.js';

function printUsage() {
  process.stderr.write(
    'Usage: xml-aes [--records | --json | --aeon] [--native] [--root <name>] [--preserve-whitespace] [--semantic-cdata] [file]\n',
  );
}

const args = process.argv.slice(2);
let asJson = false;
let asAeon = false;
let rootName;
let mapping;
let preserveWhitespace = false;
let preserveCdata = true;
let filePath = null;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    printUsage();
    process.exit(0);
  } else if (arg === '--json' || arg === '--records') {
    asJson = true;
  } else if (arg === '--aeon') {
    asAeon = true;
  } else if (arg === '--preserve-whitespace') {
    preserveWhitespace = true;
  } else if (arg === '--semantic-cdata') {
    preserveCdata = false;
  } else if (arg === '--native') {
    mapping = 'native';
  } else if (arg === '--root') {
    if (i + 1 >= args.length) {
      printUsage();
      process.exit(2);
    }
    rootName = args[i + 1];
    i += 1;
  } else if (arg.startsWith('-')) {
    process.stderr.write(`Unknown flag: ${arg}\n`);
    printUsage();
    process.exit(2);
  } else if (filePath === null) {
    filePath = arg;
  } else {
    process.stderr.write(`Unexpected argument: ${arg}\n`);
    printUsage();
    process.exit(2);
  }
}

try {
  const source = readFileSync(filePath ?? 0, 'utf8');
  const options = { rootName, preserveWhitespace, preserveCdata, mapping };
  if (asJson) {
    process.stdout.write(`${JSON.stringify(xmlToAes(source, options), null, 2)}\n`);
  } else if (asAeon) {
    process.stdout.write(aesToAeon(xmlToAes(source, options)));
  } else {
    process.stdout.write(xmlToTelex(source, options));
  }
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}

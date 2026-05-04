import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertMarkdownToAnd,
  convertPath,
  defaultAndCoreModuleUrl,
  replaceMarkdownExtension,
} from './index.js';

test('convertMarkdownToAnd emits parseable standalone ND', async () => {
  const markdown = '# Title\n\nParagraph with [link](https://example.test).\n\n- one\n- two\n';
  const result = await convertMarkdownToAnd(markdown);

  assert.equal(result.diagnostics.length, 0);
  assert.match(result.and, /^&ND v1/m);

  const andCore = await import(defaultAndCoreModuleUrl);
  const parsed = andCore.parseAnd(result.and, { mode: 'strict' });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.document.children[0]?.type, 'heading');
    assert.equal(parsed.document.children[1]?.type, 'paragraph');
    assert.equal(parsed.document.children[2]?.type, 'list');
  }
});

test('front matter maps to document/meta extension_block', async () => {
  const markdown = ['---', 'title: Guide', 'owner: Team', '---', '', '# Intro'].join('\n');
  const result = await convertMarkdownToAnd(markdown);
  const andCore = await import(defaultAndCoreModuleUrl);
  const parsed = andCore.parseAnd(result.and, { mode: 'strict' });

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const first = parsed.document.children[0];
    assert.equal(first?.type, 'extension_block');
    assert.equal(first?.name, 'document/meta');
  }
});

test('directory conversion writes .and files recursively', async () => {
  const root = await mkdtemp(join(tmpdir(), 'md-to-and-'));
  const docs = join(root, 'docs');
  const nested = join(docs, 'nested');

  await mkdir(nested, { recursive: true });
  await writeFile(join(root, 'README.md'), '# Root\n');
  await writeFile(join(docs, 'guide.md'), '## Guide\n\nHello\n');
  await writeFile(join(nested, 'deep.md'), 'Text\n');

  const result = await convertPath(root, { recursive: true });
  assert.equal(result.converted.length, 3);

  const output = replaceMarkdownExtension(join(nested, 'deep.md'));
  const outputText = await readFile(output, 'utf8');
  assert.match(outputText, /^&ND v1/m);

  await rm(root, { recursive: true, force: true });
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { highlightAeon } from './aeon-code-block.js';

test('highlights reserved comment channels and multiline block comments', () => {
  const source = `//{ structure
/[
profile block
]/`;
  const html = highlightAeon(source);

  assert.match(html, /tok-comment-structure/);
  assert.match(html, /tok-comment-profile/);
});

test('highlights quoted keys, types, and bindings with paths', () => {
  const source = `"display name":string = "AEON"\nref = ~finance.revenue\nalias = ~> user`;
  const html = highlightAeon(source);

  assert.match(html, /<span class="tok-key">"display name"<\/span>/);
  assert.match(html, /<span class="tok-type">string<\/span>/);
  assert.match(html, /<span class="tok-binding">~finance\.revenue<\/span>/);
  assert.match(html, /<span class="tok-binding">~&gt; user<\/span>/);
});

test('highlights zoned values and annotated keys', () => {
  const source = `launch:zrut = 2026-06-01T12:00:00Z&Asia/Tokyo\ntitle@{role="headline"} = "Quarterly ops"`;
  const html = highlightAeon(source);

  assert.match(html, /<span class="tok-key">launch<\/span>/);
  assert.match(html, /<span class="tok-type">zrut<\/span>/);
  assert.match(html, /<span class="tok-literal">2026-06-01T12:00:00Z&amp;Asia\/Tokyo<\/span>/);
  assert.match(html, /role/);
});

test('renders markdown-like styling inside doc comments', () => {
  const source = `/#\n# Heading\n**bold**\n_item_\n- hello\n\`code\`\n#/`;
  const html = highlightAeon(source);

  assert.match(html, /tok-md-heading/);
  assert.match(html, /tok-md-bold/);
  assert.match(html, /tok-md-italic/);
  assert.match(html, /tok-md-list-marker/);
  assert.match(html, /tok-md-code/);
});

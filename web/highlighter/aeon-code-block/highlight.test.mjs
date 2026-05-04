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

test('renders &ND styling inside semantic document comments', () => {
  const source = `/#\n&ND v1\n# Heading [*bold]\n- hello [/item] [$code]\n> quoted text\n[@ link | https://example.test]\n+++custom/block\n#/`;
  const html = highlightAeon(source);

  assert.match(html, /tok-and-header/);
  assert.match(html, /tok-and-version/);
  assert.match(html, /tok-and-heading/);
  assert.match(html, /tok-and-strong/);
  assert.match(html, /tok-and-emphasis/);
  assert.match(html, /tok-and-list-marker/);
  assert.match(html, /tok-and-list-text/);
  assert.match(html, /tok-and-quote-text/);
  assert.match(html, /tok-and-code/);
  assert.match(html, /tok-and-link-target/);
  assert.match(html, /tok-and-extension-fence/);
  assert.match(html, /tok-and-extension-name/);
  assert.doesNotMatch(html, /tok-md-/);
});

test('highlights current Core v1 type forms and anonymous typed values', () => {
  const source = `pair:tuple<int, string>[x][y] = (:int = 1, :string = "one")\nstyle:color = "#fff"`;
  const html = highlightAeon(source);

  assert.match(html, /<span class="tok-type">tuple&lt;int, string&gt;\[x\]\[y\]<\/span>/);
  assert.match(html, /<span class="tok-type">int<\/span>/);
  assert.match(html, /<span class="tok-type">string<\/span>/);
  assert.match(html, /<span class="tok-key">style<\/span><span class="tok-punct">:<\/span><span class="tok-type">color<\/span>/);
});

test('highlights node heads, nested attributes, and inline comments', () => {
  const source = `content = <span@{id="text", ns@{origin:string="core"}:string="aeon"}:node("hello")> // trailing`;
  const html = highlightAeon(source);

  assert.match(html, /<span class="tok-tag-punct">&lt;<\/span><span class="tok-tag">span<\/span>/);
  assert.match(html, /tok-attribute-punct/);
  assert.match(html, /<span class="tok-type">node<\/span>/);
  assert.match(html, /<span class="tok-comment">\/\/ trailing<\/span>/);
});

test('highlights current reference path forms and trimtick literals', () => {
  const source = `root = ~$.["a.b"]\nmember = ~"a.b"\nprofile = ~user@["profile.name"].["display.name"]\ncopy = ~> ["quoted start"]\nnote:trimtick = >>\`hello\``;
  const html = highlightAeon(source);

  assert.match(html, /<span class="tok-binding">~\$\.\["a\.b"\]<\/span>/);
  assert.match(html, /<span class="tok-binding">~"a\.b"<\/span>/);
  assert.match(html, /<span class="tok-binding">~user@\["profile\.name"\]\.\["display\.name"\]<\/span>/);
  assert.match(html, /<span class="tok-binding">~&gt; \["quoted start"\]<\/span>/);
  assert.match(html, /<span class="tok-string">&gt;&gt;`hello`<\/span>/);
});

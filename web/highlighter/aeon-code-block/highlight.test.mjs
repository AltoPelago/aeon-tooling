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

  assert.match(html, /<span class="tok-quoted-key">"display name"<\/span>/);
  assert.match(html, /<span class="tok-type">string<\/span>/);
  assert.match(html, /<span class="tok-binding">~finance\.revenue<\/span>/);
  assert.match(html, /<span class="tok-binding">~&gt; user<\/span>/);
});

test('highlights zoned values and annotated keys', () => {
  const source = `launch:wtc = 2026-06-01T12:00:00Z&Asia/Tokyo\ntitle@{role="headline"} = "Quarterly ops"`;
  const html = highlightAeon(source);

  assert.match(html, /<span class="tok-key">launch<\/span>/);
  assert.match(html, /<span class="tok-type">wtc<\/span>/);
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
  const source = `root = ~$.["a.b"]\nmember = ~"a.b"\nprofile = ~user.@.["profile.name"].["display.name"]\nlegacy = ~user@["profile.name"]\ncopy = ~> ["quoted start"]\nnote:trimtick = > \`hello\``;
  const html = highlightAeon(source);

  assert.match(html, /<span class="tok-binding">~\$\.\["a\.b"\]<\/span>/);
  assert.match(html, /<span class="tok-binding">~"a\.b"<\/span>/);
  assert.match(html, /<span class="tok-binding">~user\.@\.\["profile\.name"\]\.\["display\.name"\]<\/span>/);
  assert.doesNotMatch(html, /<span class="tok-binding">~user@\["profile\.name"\]<\/span>/);
  assert.match(html, /<span class="tok-binding">~&gt; \["quoted start"\]<\/span>/);
  assert.match(html, /<span class="tok-string">&gt; `hello`<\/span>/);
});

test('does not highlight a repeated marker as a trimtick substring', () => {
  const html = highlightAeon('note = >>`invalid`');

  assert.doesNotMatch(html, /<span class="tok-string">&gt;`invalid`<\/span>/);
});


test('highlights identities and child identity literals separately from structural references', () => {
  const source = String.raw`items = [ \item1\ = { name\name1\ = "Widget" } ]
chosen:sansa = $.items.\item1\.\name1\
context:sansa = ?.\name1\
attr:sansa = $.reading.@.\unit1\
copy = ~items[0].name
pointer = ~> items[0].name`;
  const html = highlightAeon(source);
  assert.equal((html.match(/class="tok-identity"/g) ?? []).length, 2);
  for (const literal of [String.raw`$.items.\item1\.\name1\ `.trimEnd(), String.raw`?.\name1\ `.trimEnd(), String.raw`$.reading.@.\unit1\ `.trimEnd()]) {
    assert.ok(html.includes(`<span class="tok-sansa">${literal}</span>`), literal);
  }
  assert.match(html, /<span class="tok-binding">~items\[0\]\.name<\/span>/);
  assert.match(html, /<span class="tok-binding">~&gt; items\[0\]\.name<\/span>/);
  assert.match(html, /<span class="tok-key">name<\/span><span class="tok-identity">/);
});

test('identity-looking strings/comments and marker-shaped quoted members retain their categories', () => {
  const html = highlightAeon(String.raw`text = "\\item1\\"
// \comment1\
quoted:sansa = $.["\\item1\\"]
legacy = $QmFzZTY0
empty = \\
invalid = \bad.id\ `.trimEnd());
  assert.doesNotMatch(html, /tok-identity/);
  assert.match(html, /<span class="tok-literal">\$QmFzZTY0<\/span>/);
  assert.match(html, /<span class="tok-sansa">\$\.\["\\\\item1\\\\"\]<\/span>/);
});

test('identity syntax never becomes a whole highlighted clone/pointer reference', () => {
  for (const marker of ['~', '~>']) {
    const source = String.raw`${marker}$.items.\item1\ `.trimEnd();
    assert.ok(!highlightAeon(source).includes(`<span class="tok-binding">${source.replace('>', '&gt;')}</span>`));
  }
});

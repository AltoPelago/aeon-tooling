import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createPlaygroundServer } from '../playground/server.mjs';

test('playground serves an executable browser highlighter module graph without bare imports', async t => {
  const server = createPlaygroundServer(() => { throw new Error('Conversion is not used'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sources = new Map();
  async function visit(url) {
    if (sources.has(url)) return;
    assert.equal(new URL(url).origin, origin);
    const response = await fetch(url);
    assert.equal(response.status, 200, url);
    assert.match(response.headers.get('content-type'), /^text\/javascript/);
    const source = await response.text();
    sources.set(url, source);
    const imports = /\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?['"]([^'"]+)['"]/gu;
    for (const match of source.matchAll(imports)) {
      const specifier = match[1];
      assert.match(specifier, /^(?:\/|\.\/|\.\.\/)/, `Browser cannot resolve ${specifier} from ${url}`);
      await visit(new URL(specifier, url).href);
    }
  }
  await visit(`${origin}/highlighter.js`);
  assert.ok(sources.has(`${origin}/vendor/aeon-highlight/index.js`));
  assert.ok(sources.has(`${origin}/vendor/aeon-lexer/index.js`));
  // Evaluate exactly the HTTP-served sources with browser-style URL linking.
  // Node's normal package resolver must not mask a missing browser dependency.
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', `
    import vm from 'node:vm';
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    const entries = JSON.parse(readFileSync(0, 'utf8'));
    const context = vm.createContext({});
    const modules = new Map(entries.map(([url, source]) => [url, new vm.SourceTextModule(source, {identifier:url, context})]));
    const entry = modules.get(entries[0][0]);
    await entry.link((specifier, parent) => modules.get(new URL(specifier, parent.identifier).href));
    await entry.evaluate();
    const html = entry.namespace.highlightAeon('created:date = 2026-11-16\\ncount = 42\\ntext = "<script>"');
    assert.match(html, /class="tok-temporal"/);
    assert.match(html, /class="tok-number"/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
  `], {input:JSON.stringify([...sources]), encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  for (const path of ['/node_modules/@altopelago/aeon-highlight/package.json',
    '/vendor/aeon-highlight/package.json', '/vendor/aeon-lexer/index.js.map',
    '/vendor/aeon-lexer/../package.json']) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
  const policy = (await fetch(origin)).headers.get('content-security-policy');
  assert.match(policy, /script-src 'self';/);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
});

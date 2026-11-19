import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createPlaygroundServer } from '../playground/server.mjs';
import { cases } from '../examples/validate-and-query/cases.mjs';
import { exampleCatalog } from '../playground/public/examples.js';

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
  await visit(`${origin}/editor-highlighting.js`);
  await visit(`${origin}/source-highlighting.js`);
  await visit(`${origin}/result-highlighting.js`);
  assert.ok(sources.has(`${origin}/vendor/aeon-highlight/index.js`));
  assert.ok(sources.has(`${origin}/vendor/aeon-lexer/index.js`));
  // Evaluate exactly the HTTP-served sources with browser-style URL linking.
  // Node's normal package resolver must not mask a missing browser dependency.
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', `
    import vm from 'node:vm';
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    const {entries, fixtures} = JSON.parse(readFileSync(0, 'utf8'));
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
    const editors = modules.get(new URL('/editor-highlighting.js', entries[0][0]).href);
    await editors.link((specifier, parent) => modules.get(new URL(specifier, parent.identifier).href));
    await editors.evaluate();
    const highlight = editors.namespace.highlightSansa;
    const query = 'from $.[""].items.* where .active == true and .price < 10 select .sku';
    const rendered = highlight(query);
    assert.match(rendered, /class="tok-keyword">from</);
    assert.match(rendered, /class="tok-sansa"/);
    assert.match(rendered, /class="tok-property">price</);
    assert.match(rendered, /class="tok-number">10</);
    assert.match(rendered, /class="tok-operator">and</);
    const decode = html => html.replace(/<[^>]+>/g, '').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
    for (const source of [query, 'from $.items.* where contains(.name, "<svg> select where") select .select',
      '// select <script>\\nfrom $.["select"].* select {from = "where"}',
      'from $.items.* where .name == "unfinished', 'from $.["',
      '/* comment <img src=x> */ from $.items.* select ?\\n',
      'from $.items.* select "😀 & < >"', 'x'.repeat(65_537)]) {
      const output = highlight(source);
      assert.equal(decode(output), source);
      assert.doesNotMatch(output, /<(?:svg|script|img)\\b/i);
      for (const [tag] of output.matchAll(/<[^>]+>/g)) assert.match(tag, /^<(?:span class="tok-[a-z]+"|\\/span)>$/);
    }
    assert.match(highlight('from $.items.* select .select'), /class="tok-property">select</);
    assert.match(highlight('select "from where"'), /class="tok-string">"from where"</);
    assert.match(highlight('select contains(.name, "x")'), /class="tok-function">contains</);
    const sourceModule = modules.get(new URL('/source-highlighting.js', entries[0][0]).href);
    await sourceModule.link((specifier, parent) => modules.get(new URL(specifier, parent.identifier).href));
    await sourceModule.evaluate();
    const {highlightSource, highlightTelex} = sourceModule.namespace;
    const telex = 'telex.aes=1\\n\\npath=$.[""]\\nkind=NumberLiteral\\nvalue=9007199254740993\\n\\npath=$.[""].text\\nkind=StringLiteral\\nvalue=<svg>& text\\n';
    const extra = [
      ['toml', '# comment <script>\\ntext = """multi\\n# still a string\\n"""\\ndate = 2026-11-19\\ntime = 12:34:56\\nhex = 0xFF'],
      ['yaml', 'text: |\\n  # string <svg> & \\n  true\\nnext: false\\ndate: 2026-11-19\\nnote: yes\\nhash: x#y'],
      ['xml', '<?xml version="1.0"?><x a="&quot;">Hi &amp; <![CDATA[<svg>& text]]><!-- comment --></x>'],
      ['telex', telex],
    ];
    for (const [format, source] of [...fixtures, ...extra]) {
      const output = highlightSource(source, format);
      assert.equal(decode(output), source, format);
      assert.doesNotMatch(output, /<(?:svg|script|img)\\b/i);
      for (const [tag] of output.matchAll(/<[^>]+>/g)) assert.match(tag, /^<(?:span class="(?:tok|json)-[a-z-]+"|\\/span)>$/);
    }
    for (const format of ['json','xml','yaml','toml','alog','aeon','telex']) {
      for (const source of ['<img src=x onerror=alert(1)>', '"unfinished \\" quote', '\\r\\n😀 & < >\\n', '']) {
        assert.equal(decode(highlightSource(source,format)), source);
      }
    }
    assert.match(highlightSource('{"key":42}', 'json'), /class="json-key"/);
    assert.match(highlightSource('key = 42', 'toml'), /class="tok-key">key</);
    assert.match(highlightSource('time = 12:34:56', 'toml'), /class="tok-temporal">12:34:56</);
    assert.match(highlightSource('note: yes', 'yaml'), /class="tok-string">yes</);
    assert.match(highlightSource('day: 2026-11-19', 'yaml'), /class="tok-string">2026-11-19</);
    assert.match(highlightSource('<x id="42"/>', 'xml'), /class="tok-tag">x</);
    assert.match(highlightSource('&LOG v1\\n42', 'alog'), /class="tok-directive">&amp;LOG v1</);
    assert.match(highlightTelex(telex), /class="tok-number">9007199254740993</);
    assert.match(highlightTelex(telex), /class="tok-type">NumberLiteral</);
    assert.equal(decode(highlightSource('x'.repeat(1_048_577), 'xml')), 'x'.repeat(1_048_577));
    const resultModule = modules.get(new URL('/result-highlighting.js', entries[0][0]).href);
    await resultModule.link((specifier, parent) => modules.get(new URL(specifier, parent.identifier).href));
    await resultModule.evaluate();
    const {highlightValidation, highlightQueryResults, highlightDiagnostic} = resultModule.namespace;
    const pretty = value => JSON.stringify(value, null, 2);
    for (const ok of [true,false]) {
      const validation = {ok, errors:ok ? [] : [{code:'type_mismatch',message:'<img src=x> & "quoted"',path:'$.items[0]'}],warnings:[],guarantees:{}};
      const rendered = highlightValidation(validation);
      assert.equal(decode(rendered), (ok ? 'Validation passed.' : 'Validation failed.')+'\\n\\n'+pretty(validation));
      assert.match(rendered, /class="json-key"/);
      assert.doesNotMatch(rendered, /<img/);
    }
    for (const query of [
      {ok:true,count:1,text:'$.item = "<svg> & 😀"',results:[{value:{type:'scalar',value:'<svg> & 😀'}}]},
      {ok:true,count:0,text:'(no results)',results:[]},
      {ok:false,errors:[{code:'SANSA_QUERY_ERROR',message:'unexpected <script> & text',index:3}]},
    ]) {
      const rendered = highlightQueryResults(query);
      const expected = query.ok ? (query.count ? query.text : 'No matching results.')+'\\n\\nBinding details\\n'+pretty(query.results) : pretty(query.errors);
      assert.equal(decode(rendered), expected);
      assert.doesNotMatch(rendered, /<(?:svg|script)\\b/);
      assert.match(rendered, /class="json-(?:key|punct)"/);
    }
    const diagnostic = {code:'<svg>',message:'Bad </span><img src=x> & "schema"'};
    assert.equal(decode(highlightDiagnostic(diagnostic)), diagnostic.code+'\\n'+diagnostic.message);
    assert.doesNotMatch(highlightDiagnostic(diagnostic), /<(?:svg|img)\\b/);
  `], {input:JSON.stringify({entries:[...sources], fixtures:[
    ...cases.map(example=>[example.format,example.source]),
    ...Object.values(exampleCatalog).flat().map(example=>[example.from,example.source]),
  ]}), encoding:'utf8'});
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

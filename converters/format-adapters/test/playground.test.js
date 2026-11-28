import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConverter, loadCompiler } from '../playground/convert.mjs';
import { createPlaygroundServer } from '../playground/server.mjs';
import { sampleFor } from '../playground/public/examples.js';
let core;
try {core = await loadCompiler();} catch {}
const convert = core ? createConverter(core) : null;
const options = {skip: !core && 'Built tagged-node AEON compiler unavailable'};

test('playground: startup rejects an empty-key-only compiler before XML conversion', t => {
  const temp = mkdtempSync(join(tmpdir(), 'aeon-old-core-'));
  t.after(() => rmSync(temp, {recursive: true, force: true}));
  const compiler = join(temp, 'core.mjs');
  writeFileSync(compiler, `export function compileToTelex(source) {
    return { compile: { errors: source.startsWith('<') ? [{code:'SYNTAX_ERROR'}] : [] }, records: [] };
  }`);
  const converter = new URL('../playground/convert.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { loadCompiler } from ${JSON.stringify(converter)}; await loadCompiler();`],
    {env: {...process.env, AEON_CORE_MODULE: compiler}, encoding: 'utf8'});
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Compiler lacks tagged-node support/);
});

test('playground: YAML tags survive annotated AEON routes and cannot silently vanish in other exports', options, () => {
  const source = 'created: !CustomDate 2026-11-16\nlist: [!custom-tag "001", !app/value true]';
  const imported = convert({from:'yaml', to:'aeon', source});
  assert.equal(imported.annotations.length,3);
  assert.match(imported.output,/yaml\.tag\("!CustomDate"\)/);
  const again = convert({from:'aeon',to:'aeon',source:imported.output});
  assert.equal(again.output, imported.output);
  assert.deepEqual(again.annotations.map(a=>[a.raw,a.target]), imported.annotations.map(a=>[a.raw,a.target]));
  for (const from of ['yaml','aeon']) for (const to of ['json','yaml','toml','xml','alog']) {
    assert.throws(()=>convert({from,to,source:from==='yaml'?source:imported.output}),{code:'YAML_ANNOTATIONS_REQUIRED'});
  }
});

test('playground: every format converts to AEON and back', options, () => {
  const samples = {
    json: '{"":{"x":[null,true,"hi"]},"n":9007199254740993}',
    yaml: 'name: Alice\nvalues: [1, false, null]\n"": {}',
    toml: 'name="Alice"\n[account]\nage=42\nborn=2026-11-09',
    xml: '<?xml version="1.0"?><p xmlns:x="urn:x" id="42">hello<x:b/>world</p>',
    alog: '&LOG v1\n1, "Alice", |active|\n2, "Bob", false',
  };
  for (const [format, source] of Object.entries(samples)) {
    const aeon = convert({from:format, to:'aeon', source}).output;
    const exported = convert({from:'aeon', to:format, source:aeon}).output;
    const again = convert({from:format, to:'aeon', source:exported}).output;
    assert.equal(again, aeon, format);
  }
});
test('playground: native AEON, wrapped arbitrary roots and exact numeric output', options, () => {
  assert.deepEqual(JSON.parse(convert({from:'aeon', to:'json', source:'name="Alice"\nactive=true'}).output), {name:'Alice',active:true});
  for (const source of ['null', '42', '[]', '"hello"', '{"":1}']) {
    const aeon=convert({from:'json',to:'aeon',source}).output;
    assert.deepEqual(JSON.parse(convert({from:'aeon',to:'json',source:aeon}).output),JSON.parse(source));
  }
  const exact = convert({from:'aeon',to:'json',source:'n=9007199254740993\nx=1.234567890123456789\ny=1e999'}).output;
  assert.match(exact,/9007199254740993/);assert.match(exact,/1\.234567890123456789/);assert.match(exact,/1e999/);
});
test('playground: cross-format exports and unsupported data fail explicitly', options, () => {
  assert.match(convert({from:'json',to:'toml',source:'{"a":[1,2]}' }).output,/"a" = \[1, 2\]/);
  assert.match(convert({from:'json',to:'yaml',source:'{"a":{"b":1}}'}).output,/"a":\n  "b": 1/);
  for (const source of ['x=|active|','x=2026-11-09','x=on','<person>','x@{private=true}=1','x:string="hi"','x=!unknown']) {
    assert.throws(()=>convert({from:'aeon',to:'json',source}), undefined, source);
  }
  assert.throws(()=>convert({from:'json',to:'toml',source:'null'}),/object root/);
  assert.throws(()=>convert({from:'json',to:'toml',source:'{"a":null}'}),/no null/);
  assert.throws(()=>convert({from:'json',to:'xml',source:'{}'}),/xml document wrapper/);
  assert.throws(()=>convert({from:'json',to:'alog',source:'[[]]'}),/nonempty/);
  assert.throws(()=>convert({from:'json',to:'aeon',source:'{"a":1,"a":2}'}),/Duplicate/);
});
test('playground: local HTTP conversion, static assets and request boundaries', options, async t => {
  const server = createPlaygroundServer(convert);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/app.js', '/examples.js', '/style.css', '/highlighter.js']) assert.equal((await fetch(url+path)).status,200,path);
  const response=await fetch(url+'/api/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:'json',to:'aeon',source:'42'})});
  assert.equal(response.status,200);assert.match((await response.json()).output,/""@/);
  const lossy = await fetch(url+'/api/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:'aeon',to:'json',source:'x=|active|',mode:'lossy'})});
  assert.equal(lossy.status,200);
  const converted = await lossy.json();
  assert.deepEqual(JSON.parse(converted.output),{x:'|active|'});
  assert.equal(converted.mode,'lossy'); assert.equal(converted.stringifiedScalars,1);

  assert.equal((await fetch(url+'/api/convert',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://example.com'},body:'{}'})).status,403);
  assert.equal((await fetch(url+'/api/convert',{method:'POST',body:'{}'})).status,415);
  assert.equal((await fetch(url+'/api/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:'bad json'})).status,422);
  assert.equal((await fetch(url+'/.git/config')).status,404);
});

test('playground: reserved materializer keys warn while preserving legal AEON and JSON', options, () => {
  const source = '{"$":3,"@":{"source":"aeon"}}';
  const imported = convert({from:'json', to:'aeon', source});
  assert.deepEqual(core.compileToTelex(imported.output).compile.errors, []);
  assert.deepEqual(imported.warnings.map(w => w.key), ['$', '@']);
  assert.deepEqual(imported.warnings.map(w => w.paths[0]), ['$.[""].["$"]', '$.[""].["@"]']);
  assert.ok(imported.warnings.every(w => w.code === 'JSON_MATERIALIZER_RESERVED_KEY' && /valid AEON/.test(w.message)));
  const exported = convert({from:'aeon', to:'json', source:imported.output});
  assert.deepEqual(JSON.parse(exported.output), JSON.parse(source));
  assert.equal(exported.warnings.length, 2);
});
test('playground: materializer warnings match exact decoded member keys at any depth', options, () => {
  const source = '{"items":[{"\\u0024":1,"$node":2,"$children":3,"__proto__":4,"constructor":5,"prototype":6}]}';
  const result = convert({from:'json', to:'aeon', source});
  assert.deepEqual(result.warnings.map(w => w.key), ['$', '$node', '$children', '__proto__', 'constructor', 'prototype']);
  assert.equal(result.warnings[0].paths[0], '$.[""].items[0].["$"]');
  assert.deepEqual(convert({from:'json', to:'aeon', source:'{"$schema":1,"@source":2,"prototype_extra":3}'}).warnings, []);
  assert.deepEqual(convert({from:'xml', to:'aeon', source:'<person constructor="x"/>'}).warnings, []);
  const repeated = convert({from:'json', to:'aeon', source:JSON.stringify(Array.from({length:8}, () => ({'$':1})))}).warnings;
  assert.equal(repeated.length, 1); assert.equal(repeated[0].occurrences, 8); assert.equal(repeated[0].paths.length, 5);
});

test('playground: YAML support/version provenance exports cleanly without discarding other attributes', options, () => {
  const aeon = convert({from:'yaml', to:'aeon', source:'name: Alice'}).output;
  assert.match(aeon, /support = "limited"/); assert.match(aeon, /version = "1.2"/);
  assert.deepEqual(JSON.parse(convert({from:'aeon', to:'json', source:aeon}).output), {name:'Alice'});
  assert.equal(convert({from:'aeon', to:'yaml', source:aeon}).output, '"name": "Alice"\n');
  for (const source of [aeon.replace('"1.2"', '"2.0"'), aeon.replace('"limited"', '"full"'), '""@{version="1.2", support="limited"} = {name="Alice"}']) {
    assert.throws(() => convert({from:'aeon', to:'json', source}), /Attribute/);
  }
});

test('playground: XML CDATA boundaries and whitespace survive XML -> AEON -> XML', options, () => {
  for (const source of [
    '<p>before<![CDATA[<code> & literal]]>after</p>',
    '<p><![CDATA[]]><![CDATA[one]]><![CDATA[two]]></p>',
    '<p><name>Alice</name><![CDATA[\n\n    if (a < b && c > d) {\n      return "<success>";\n    }\n]]><active>true</active></p>',
    '<p><![CDATA[C:\\tmp\\n `x` 😀]]></p>',
  ]) {
    const aeon = convert({from:'xml', to:'aeon', source}).output;
    assert.match(aeon, /:cdata = /);
    assert.equal(convert({from:'aeon', to:'xml', source:aeon}).output, source+'\n');
    assert.equal(convert({from:'xml',to:'xml',source}).output, source+'\n');
  }
});

test('playground: ordered XML markup, declaration and source attributes round trip', options, () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<?application mode="debug"?><?application 1 + 2??><?application?>'
    + '<!--prolog--><person source="publisher">a<?application validate?><!---->b</person>'
    + '<?application done?><!--epilog-->';
  const result = convert({from:'xml', to:'aeon', source:xml});
  assert.match(result.output, /<"\?xml"@\{/);
  assert.match(result.output, /<xml@\{source = \|XML\|\}/);
  assert.match(result.output, /<person@\{source = "publisher"\}/);
  assert.equal(convert({from:'aeon', to:'aeon', source:result.output}).output, result.output);
  assert.equal(convert({from:'aeon', to:'xml', source:result.output}).output, xml + '\n');
  const reordered = '<xml(<person@{version="2", source="publisher"}>)>\n<"?xml"@{version="1.0"}>';
  assert.equal(convert({from:'aeon', to:'xml', source:reordered}).output,
    '<?xml version="1.0"?>\n<person version="2" source="publisher"/>\n');
  const undeclared = convert({from:'xml', to:'aeon', source:'<person source="publisher"/>'}).output;
  assert.equal(convert({from:'aeon', to:'xml', source:undeclared}).output, '<person source="publisher"/>\n');
});

test('playground: XML exporter rejects invalid document shapes and markup data', options, () => {
  for (const [source, expected] of [
    ['<person>', /document wrapper/],
    ['<xml(<"?app">)>', /exactly one document element/],
    ['<xml(<a>, <b>)>', /exactly one document element/],
    ['<xml("text", <a>)>', /document children/],
    ['<xml(<a>, <"?XML">)>', /reserved XML processing instruction/],
    ['<xml(<a>, <"?app"("bad?>data")>)>', /Processing instruction data/],
    ['<xml(<a>, <"!--"("bad--data")>)>', /Invalid XML comment/],
    ['<xml(<"!DOCTYPE"("a")>)>', /Invalid XML element name/],
    ['<xml(<"a x">)>', /Invalid XML element name/],
    ['<xml(<a@{"x y"="v"}>)>', /Invalid XML attribute name/],
    ['<xml(<a\\id\\>)>', /cannot preserve AEON identity/],
    ['<xml@{source="publisher"}(<a>)>', /symbolic XML provenance/],
    ['<"?xml"@{encoding="UTF-8"}>\n<xml(<a>)>', /requires a version/],
    ['<"?xml"@{version="1.0"}("text")>\n<xml(<a>)>', /no children/],
  ]) {
    assert.throws(() => convert({from:'aeon', to:'xml', source}), expected, source);
  }
});
test('playground: authored backticks preserve CDATA, while prose is not a CDATA marker', options, () => {
  const payload = '\n\n    if (a < b) {\n      return "ok";\n    }\n';
  const source = '<xml(<p(:cdata = `'+payload+'`)>)> ';
  assert.equal(convert({from:'aeon',to:'xml',source}).output, '<p><![CDATA['+payload+']]></p>\n');
  const special = convert({from:'aeon', to:'xml', source:'<xml(<p(:cdata = "a]]>b")>)>'}).output;
  assert.equal(special,'<p><![CDATA[a]]]]><![CDATA[>b]]></p>\n');
  assert.throws(() => convert({from:'aeon',to:'xml',source:'<xml(<p(:cdata = "a\\rb")>)>'}), /carriage returns/);
  assert.throws(() => convert({from:'aeon',to:'xml',source:'<xml(<p(:prose = >`hello`)>)>'}), /datatypes/);
  assert.throws(() => convert({from:'aeon',to:'xml',source:'<xml(<p(@{x=1}:cdata = "hello")>)>'}), /CDATA markers/);
});

test('playground: authored tags do not select the XML rendering profile', options, () => {
  const source = '<xml(<element\\item\\>)>';
  const result = convert({from:'aeon', to:'aeon', source}).output;
  assert.deepEqual(core.compileToTelex(result).records, core.compileToTelex(source).records);
  assert.throws(() => convert({from:'aeon', to:'xml', source}), /cannot preserve AEON identity/);
  for (const value of ['"two words"', '"16"']) {
    const annotated = `<xml:custom[${value}](<element>)>`;
    const output = convert({from:'aeon', to:'aeon', source:annotated}).output;
    assert.deepEqual(core.compileToTelex(output).records, core.compileToTelex(annotated).records);
  }
});

test('playground: intrinsic tags and path annotations survive AEON re-rendering', options, () => {
  const tags = '/@ yaml.tag("!title") @/ /@ yaml.tag("!display") @/';
  const source = '<catalog\\main\\@{<badge("new")>}:node('
    + '@{} = ' + tags + ' "Title", <section>, <section>)>\n'
    + 'items = [<section>, @{} = ' + tags + ' "List title", <section>]\n'
    + 'owner@{<part(@{} = ' + tags + ' "Attribute node title")>} = true';
  const input = core.compileToTelex(source);
  assert.deepEqual(input.compile.errors, []);
  const rendered = convert({from:'aeon', to:'aeon', source});
  const replay = core.compileToTelex(rendered.output);
  assert.deepEqual(replay.compile.errors, []);
  assert.deepEqual(replay.records, input.records);
  assert.deepEqual(rendered.annotations.map(({raw, target}) => [raw, target]),
    [
      ['/@ yaml.tag("!title") @/', {kind:'path', path:'$.catalog[0]'}],
      ['/@ yaml.tag("!display") @/', {kind:'path', path:'$.catalog[0]'}],
      ['/@ yaml.tag("!title") @/', {kind:'path', path:'$.items[1]'}],
      ['/@ yaml.tag("!display") @/', {kind:'path', path:'$.items[1]'}],
      ['/@ yaml.tag("!title") @/', {kind:'path', path:'$.owner.@.part[0]'}],
      ['/@ yaml.tag("!display") @/', {kind:'path', path:'$.owner.@.part[0]'}],
    ]);
  assert.deepEqual(replay.compile.annotations.map(({raw, target}) => [raw, target]),
    rendered.annotations.map(({raw, target}) => [raw, target]));
  assert.throws(() => convert({from:'aeon', to:'json', source:'<catalog(<item>)>'}),
    error => error.code === 'UNREPRESENTABLE' && error.path === '$.catalog');
});

test('playground: refuses annotations on a named field inside an attribute node', options, () => {
  const source = 'owner@{<cat({a="A", b="B" /@ yaml.tag("!one") @/ /@ yaml.tag("!two") @/})>} = true';
  const parsed = core.compileToTelex(source);
  assert.deepEqual(parsed.compile.errors, []);
  assert.deepEqual(parsed.compile.annotations.map(comment => comment.target.path),
    ['$.owner.@.cat[0].b', '$.owner.@.cat[0].b']);
  assert.throws(() => convert({from:'aeon', to:'aeon', source}), /Cannot preserve an annotation on a nested attribute value/);
});

test('playground: predefined and custom null reasons survive the node conversion', options, () => {
  const source = '<catalog(!none, !notSet, !notApplicable, !tombstone, !"notset", !"custom reason")>';
  const result = convert({from:'aeon', to:'aeon', source});
  const replay = core.compileToTelex(result.output);
  assert.deepEqual(replay.compile.errors, []);
  assert.deepEqual(replay.records, core.compileToTelex(source).records);
});

test('playground: lossless remains the default and unknown conversion modes fail', options, () => {
  assert.equal(convert({from:'json',to:'aeon',source:'42'}).mode,'lossless');
  assert.throws(() => convert({from:'aeon',to:'json',source:'x=|active|'}), /cannot be represented/);
  assert.throws(() => convert({from:'aeon',to:'json',source:'x=|active|',mode:'lossless'}), /cannot be represented/);
  for (const mode of ['auto', '', null, 3]) assert.throws(() => convert({from:'aeon',to:'json',source:'x=1',mode}), /lossless or lossy/);
});
test('playground: lossy JSON/YAML stringifies unsupported scalars without losing numeric precision', options, () => {
  const source = 'state=|active|\nday=2026-11-16\nflag=on\nreason=!"unknown"\nhex=#ff\naddress=$.state\nforever=Infinity\nbig=9007199254740993\nprecise=1.234567890123456789\nnothing=!none\nnormal=true\ntext="|active|"';
  const expected = {state:'|active|',day:'2026-11-16',flag:'on',reason:'!"unknown"',hex:'#ff',address:'$.state',forever:'Infinity',nothing:null,normal:true,text:'|active|'};
  for (const to of ['json','yaml']) {
    const result = convert({from:'aeon',to,source,mode:'lossy'});
    const json = to === 'json' ? result.output : convert({from:'yaml',to:'json',source:result.output}).output;
    const actual = JSON.parse(json); delete actual.big; delete actual.precise;
    assert.deepEqual(actual,expected);
    assert.match(json,/9007199254740993/); assert.match(json,/1\.234567890123456789/);
    assert.equal(result.stringifiedScalars,7);
    assert.ok(result.warnings.some(w => w.code === 'LOSSY_MODE'));
    assert.ok(result.warnings.some(w => w.code === 'SCALAR_STRINGIFIED' && w.paths.includes('$.state')));
    const reversed = convert({from:to,to:'aeon',source:result.output}).output;
    assert.match(reversed,/state = "\|active\|"/);
  }
});
test('playground: lossy TOML converts unsupported nulls/types and retains native temporal scalars', options, () => {
  const result = convert({from:'aeon',to:'toml',source:'x=!none\nstate=|active|\nday=2026-11-16\nn=42',mode:'lossy'});
  assert.match(result.output,/"x" = "!none"/);
  assert.match(result.output,/"state" = "\|active\|"/);
  assert.match(result.output,/"day" = 2026-11-16/);
  assert.match(result.output,/"n" = 42/);
  assert.equal(result.stringifiedScalars,2);
  const partial = convert({from:'aeon',to:'toml',source:'year=2026-\nmonth=2026-11\ntime=12:30',mode:'lossy'});
  assert.match(partial.output,/"year" = "2026-"/);
  assert.match(partial.output,/"month" = "2026-11"/);
  assert.match(partial.output,/"time" = "12:30"/);
  assert.equal(partial.stringifiedScalars,3);
});
test('playground: lossy XML converts scalar children/attributes while retaining CDATA', options, () => {
  const result = convert({from:'aeon',to:'xml',source:'<xml(<p@{age=42}(true, |active|, :cdata = "<code>")>)>',mode:'lossy'});
  assert.equal(result.output,'<p age="42">true|active|<![CDATA[<code>]]></p>\n');
  assert.equal(result.stringifiedScalars,3);
  assert.equal(convert({from:'aeon',to:'xml',source:'<xml(<p(:cdata = "a\\rb")>)>',mode:'lossy'}).output,'<p>a&#13;b</p>\n');
  const cdataToJson = convert({from:'aeon',to:'json',source:'"" = [:cdata = "<code>"]',mode:'lossy'});
  assert.deepEqual(JSON.parse(cdataToJson.output),['<code>']);
});
test('playground: lossy annotations become strings, but structure, metadata and source validation still apply', options, () => {
  const result = convert({from:'aeon',to:'json',source:'n:int=42\ns:string="hello"',mode:'lossy'});
  assert.deepEqual(JSON.parse(result.output),{n:'42',s:'hello'});
  assert.equal(result.stringifiedScalars,2);
  assert.throws(() => convert({from:'aeon',to:'json',source:'<p>',mode:'lossy'}), /NodeLiteral/);
  assert.throws(() => convert({from:'aeon',to:'json',source:'x@{keep=true}=on',mode:'lossy'}), /Attribute/);
  assert.throws(() => convert({from:'json',to:'aeon',source:'{"x":1,"x":2}',mode:'lossy'}), /Duplicate/);
  assert.throws(() => convert({from:'json',to:'toml',source:'[]',mode:'lossy'}), /object root/);
  assert.throws(() => convert({from:'aeon',to:'json',source:'x=!',mode:'lossy'}));
});
test('playground: lossy ALOG retains supported scalars and converts unsupported annotations', options, () => {
  const result = convert({from:'aeon',to:'alog',source:'"" = [[|active|, 2026-11-16, on, :int = 42]]',mode:'lossy'});
  assert.equal(result.output,'&LOG v1\n|active|, 2026-11-16, on, "42"\n');
  assert.equal(result.stringifiedScalars,1);
  const aeon = convert({from:'json',to:'aeon',source:'42',mode:'lossy'});
  assert.equal(aeon.stringifiedScalars,0); assert.ok(aeon.warnings.some(w => w.code === 'LOSSY_MODE'));
});

test('playground: YAML diagnostics identify YAML, and lossy ALOG dates export as strings', options, () => {
  const source = '&LOG v1\n2, "Bob", false, 2002-01-01';
  assert.throws(() => convert({from:'alog',to:'yaml',source}), error => {
    assert.match(error.message,/DateLiteral cannot be represented in YAML/);
    assert.match(error.message,/lossy mode/);
    assert.doesNotMatch(error.message,/JSON/);
    return true;
  });
  const result = convert({from:'alog',to:'yaml',source,mode:'lossy'});
  assert.match(result.output,/"2002-01-01"/);
  assert.equal(result.stringifiedScalars,1);
  const json = convert({from:'yaml',to:'json',source:result.output});
  assert.deepEqual(JSON.parse(json.output),[[2,'Bob',false,'2002-01-01']]);
  assert.throws(() => convert({from:'aeon',to:'toml',source:'state=|active|'}), /represented in TOML/);
});
test('playground: AEON load examples suit each output format in both modes', options, () => {
  for (const to of ['aeon','json','yaml','toml','xml','alog']) {
    for (const mode of ['lossless','lossy']) {
      const result = convert({from:'aeon',to,source:sampleFor('aeon',to),mode});
      assert.equal(typeof result.output,'string',to);
      assert.equal(result.stringifiedScalars,0,to);
      if (to === 'xml') { assert.match(result.output,/<person/); assert.match(result.output,/<!\[CDATA\[/); }
      if (to === 'alog') assert.match(result.output,/&LOG v1/);
    }
  }
  assert.match(sampleFor('aeon','xml'),/<person/);
  assert.doesNotMatch(sampleFor('aeon','xml'),/source = \|JSON\|/);
  assert.match(sampleFor('json','aeon'),/"name": "Alice"/);
});

test('playground: TOML radix integers round trip with bases, digits and precision intact', options, () => {
  const source='binary=0b0010_1010\noctal=0o0755\nhex=0xdead_beef\nmin=-9223372036854775808\nmax=9223372036854775807\nvalues=[0x00fF,0o0007,0b0001]\npoint={mask=0xAF}';
  const aeon=convert({from:'toml',to:'aeon',source}).output;
  assert.match(aeon,/version = "1.0"/); assert.match(aeon,/%DEADBEEF/);
  for (const mode of ['lossless','lossy']) {
    const reverse=convert({from:'aeon',to:'toml',source:aeon,mode});
    assert.match(reverse.output,/0b00101010/); assert.match(reverse.output,/0o0755/); assert.match(reverse.output,/0xDEADBEEF/);
    assert.match(reverse.output,/0x00FF/); assert.match(reverse.output,/-9223372036854775808/);
    assert.equal(reverse.stringifiedScalars,0);
    assert.equal(convert({from:'toml',to:'aeon',source:reverse.output}).output,aeon);
  }
});
test('playground: TOML recognizes explicit radix bases and compatible aliases without inventing a base', options, () => {
  const source='binary:radix2=%001010\noctal:radix8=%0755\nhex:radix[1.6e1]=%00AF';
  const r=convert({from:'aeon',to:'toml',source});
  assert.match(r.output,/0b001010/); assert.match(r.output,/0o0755/); assert.match(r.output,/0x00AF/);
  for (const source of ['n=%1010','n:radix[10]=%123','n:radix[8]=%0.7','n:radix[16]=%-FF','n:radix[16]=%ff','n:radix[16]=%G']) {
    assert.throws(()=>convert({from:'aeon',to:'toml',source}),undefined,source);
    const lossy=convert({from:'aeon',to:'toml',source,mode:'lossy'});
    assert.equal(lossy.stringifiedScalars,1,source); assert.match(lossy.output,/"n" = "%/);
  }
});
test('playground: TOML export enforces signed 64-bit bounds and lossy mode stringifies oversize AEON integers', options, () => {
  const min=-(1n<<63n),max=(1n<<63n)-1n;
  for(const value of [min,max]) assert.match(convert({from:'aeon',to:'toml',source:'n='+value}).output,new RegExp(String(value)));
  for(const value of [min-1n,max+1n]) {
    const source='n='+value;
    assert.throws(()=>convert({from:'aeon',to:'toml',source}),/between -9223372036854775808 and 9223372036854775807/);
    const result=convert({from:'aeon',to:'toml',source,mode:'lossy'});
    assert.equal(result.output,'"n" = "'+value+'"\n'); assert.equal(result.stringifiedScalars,1);
    assert.throws(()=>convert({from:'toml',to:'aeon',source,mode:'lossy'}),error=>error.code==='TOML_INTEGER_OUT_OF_RANGE');
  }
  for(const [base,prefix] of [[2,'0b'],[8,'0o'],[16,'0x']]) {
    const maxDigits=max.toString(base).toUpperCase(),over=(max+1n).toString(base).toUpperCase();
    assert.match(convert({from:'aeon',to:'toml',source:`n:radix[${base}]=%${maxDigits}`}).output,new RegExp(prefix+maxDigits));
    const source=`n:radix[${base}]=%${over}`;
    assert.throws(()=>convert({from:'aeon',to:'toml',source}),/between/);
    assert.equal(convert({from:'aeon',to:'toml',source,mode:'lossy'}).stringifiedScalars,1);
  }
  assert.match(convert({from:'aeon',to:'toml',source:'n=9223372036854775808.0'}).output,/9223372036854775808\.0/);
});
test('playground: only recognized TOML version provenance is removed', options, () => {
  const source='""@{source=|TOML|,version="1.0"}={version="user data"}';
  assert.deepEqual(JSON.parse(convert({from:'aeon',to:'json',source}).output),{version:'user data'});
  for(const source of ['""@{source=|TOML|,version="1.1"}={n=1}','""@{version="1.0"}={n=1}']) {
    assert.throws(()=>convert({from:'aeon',to:'json',source}),/Attribute/);
  }
});

test('playground: TOML escapes U+007F in root keys, nested keys and string values on reverse export', options, () => {
  const source='"root\\u007F" = "value\\u007F"\nnested={"key\\u007F"="inner\\u007F"}\nitems=["\\u007F","quote: \\"; slash: \\\\"]';
  const aeon=convert({from:'toml',to:'aeon',source}).output;
  for(const mode of ['lossless','lossy']) {
    const exported=convert({from:'aeon',to:'toml',source:aeon,mode});
    assert.equal(exported.output.includes('\u007f'),false);
    assert.ok(exported.output.includes('\\u007F'));
    assert.equal(exported.stringifiedScalars,0);
    assert.equal(convert({from:'toml',to:'aeon',source:exported.output}).output,aeon);
  }
  const lossy=convert({from:'aeon',to:'toml',source:'x:string="\\u007F"',mode:'lossy'});
  assert.equal(lossy.output,'"x" = "\\u007F"\n');
  assert.equal(lossy.stringifiedScalars,1);
});
test('playground: TOML year-zero policy is enforced before AEON output in both modes', options, () => {
  for(const mode of ['lossless','lossy']) for(const to of ['aeon','toml','json']) {
    assert.throws(()=>convert({from:'toml',to,source:'d=0000-01-01',mode}),error=>error.code==='TOML_UNSUPPORTED_YEAR');
  }
  assert.match(convert({from:'toml',to:'aeon',source:'d=0001-01-01'}).output,/0001-01-01/);
});

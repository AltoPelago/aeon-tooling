import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { yamlToAes, yamlToAesWithAnnotations, yamlToAeon, yamlToTelex, aesToAeon } from '../src/index.js';
const options = { sourceMetadata: false };
const read = source => yamlToAesWithAnnotations(source, options);
const tag = annotation => JSON.parse(annotation.raw.match(/^\/@ yaml\.tag\((.*)\) @\/$/u)[1]);

test('custom tags become string values plus path-targeted semantic comments, never datatypes', () => {
  const {records, annotations} = read('created: !CustomDate 2026-11-16\ncount: 12\nactive: true');
  assert.deepEqual(records.find(r=>r.path.endsWith('.created')), {path:'$.[""].created',kind:'StringLiteral',value:'2026-11-16'});
  assert.ok(records.every(r=>r.datatype===undefined));
  assert.equal(records.find(r=>r.path.endsWith('.count')).kind,'NumberLiteral');
  assert.equal(records.find(r=>r.path.endsWith('.active')).kind,'BooleanLiteral');
  assert.deepEqual(annotations,[{kind:'annotation',form:'block',raw:'/@ yaml.tag("!CustomDate") @/',target:{kind:'path',path:'$.[""].created'}}]);
  assert.match(yamlToAeon('created: !CustomDate 2026-11-16',options),/created = \/@ yaml\.tag\("!CustomDate"\) @\/ "2026-11-16"/);
});

test('preserves tagged numeric-looking, empty, escaped and block scalar content', () => {
  for(const [source,value] of [
    ['!Text 00123','00123'],['!Text 900719925474099312345','900719925474099312345'],
    ['!Text 1.234567890123456789','1.234567890123456789'],['!Text true','true'],
    ['!Text null','null'],['!Text .inf','.inf'],['!Text',''],
    ['!Text "a\\r\\nb\\n😀"','a\r\nb\n😀'],['!Text "\\\\r\\\\n"','\\r\\n'],
    ["!Text 'it''s fine'","it's fine"],['!Text |\n  a\n  b\n','a\nb\n'],['!Text >-\n  a\n  b\n','a b'],
  ]) {
    const result=read(source);
    assert.deepEqual(result.records[0],{path:'$.[""]',kind:'StringLiteral',value},source);
    assert.equal(tag(result.annotations[0]),'!Text');
  }
});

test('retains resolved namespaces and names outside AEON type syntax without configuration', () => {
  const prefixed='%TAG !app! tag:example.com,2026:\n---\ncreated: !app!custom-date 2026-11-16';
  const verbatim='created: !<tag:example.com,2026:custom-date> 2026-11-16';
  const rebound='%TAG ! tag:example.com,2026:\n---\ncreated: !custom-date 2026-11-16';
  assert.deepEqual(read(prefixed),read(verbatim));assert.deepEqual(read(rebound),read(verbatim));
  for(const identity of ['!custom-date','!acme/date','!ruby/object:Set','tag:other.com,2026:custom-date','tag:example.com,2026:Custom%20Date']) {
    const source=identity.startsWith('!')?`${identity} x`:`!<${identity}> x`;
    assert.equal(tag(read(source).annotations[0]),identity);
  }
  assert.notDeepEqual(read('!acme/date x').annotations,read('!acme-date x').annotations);
});

test('targets nested, empty, escaped, prototype-like and anonymous paths exactly', () => {
  const result=read('"": !Text empty\n"a.b": [!Text one, {"__proto__": !Text two}]\n"q\\\"x": !Text three');
  assert.deepEqual(result.annotations.map(a=>a.target.path),[
    '$.[""].[""]','$.[""].["a.b"][0]','$.[""].["a.b"][1].__proto__','$.[""].["q\\\"x"]',
  ]);
});

test('AES/Telex-only exports reject tag loss and the removed mapping option fails explicitly', () => {
  for(const convert of [yamlToAes,yamlToTelex]) assert.throws(()=>convert('!Text x'),{code:'YAML_ANNOTATIONS_REQUIRED'});
  assert.deepEqual(yamlToAes('x',options),read('x').records);assert.match(yamlToTelex('x'),/value=x/);
  for(const tagMappings of [{},null,{'!Text':'Text'}]) assert.throws(()=>yamlToAeon('!Text x',{tagMappings}),{code:'YAML_OPTION'});
});

test('rejects standard tags, tagged collections/keys, graphs, malformed tags and duplicates', () => {
  for(const source of ['!!str x','!!int 12','!Text [one]','!Text {a: b}','!Text key: value',
    '&a !Text x','[&a !Text x, *a]','a: !Text one\na: !Text two','!missing!Text x',
    '%TAG !app! tag:example.com,2026:\n---\n!app!Bad%QQ x','!<unterminated x']) assert.throws(()=>read(source),undefined,source);
  for(const mode of ['strict','custom','invalid']) assert.throws(()=>yamlToAeon('!Text x',{mode}),{code:'YAML_MODE'});
});

test('limits cover tag text, decoded values and combined AES/annotation counts', () => {
  assert.throws(()=>read('!Text "\\uD800"'));
  assert.throws(()=>yamlToAesWithAnnotations('!VeryLongTag x',{...options,limits:{maxStringCodepoints:4}}));
  assert.throws(()=>yamlToAesWithAnnotations('!T abcd',{...options,limits:{maxStringCodepoints:3}}));
  assert.equal(yamlToAesWithAnnotations('!T x',{...options,limits:{maxEvents:2}}).annotations.length,1);
  assert.throws(()=>yamlToAesWithAnnotations('!T x',{...options,limits:{maxEvents:1}}));
});

test('hostile tag content cannot terminate comments or inject AEON', () => {
  const identity='tag:example.com,2026:x@/evil';const result=read(`!<${identity}> "\\\"\\nother = 42"`);
  assert.equal(tag(result.annotations[0]),identity);
  assert.equal((result.annotations[0].raw.match(/@\//gu)??[]).length,1);
  assert.throws(()=>aesToAeon(result.records,{annotations:[{...result.annotations[0],raw:'/@ x @/ injected /@ y @/'}]}));
  assert.throws(()=>aesToAeon(result.records,{annotations:[{...result.annotations[0],target:{kind:'path',path:'$.missing'}}]}));
});

test('CLI emits annotated source or a JSON side channel and does not silently drop tags', () => {
  const cli=new URL('../bin/yaml-aes.js',import.meta.url);
  const run=args=>spawnSync(process.execPath,[cli.pathname,...args],{input:'created: !CustomDate 2026-11-16',encoding:'utf8'});
  const output=run(['--aeon']);assert.equal(output.status,0,output.stderr);assert.equal(output.stderr,'');
  assert.match(output.stdout,/yaml\.tag\("!CustomDate"\)/);
  const bundle=run(['--annotations']);assert.equal(bundle.status,0,bundle.stderr);
  const result=JSON.parse(bundle.stdout);assert.equal(result.annotations.length,1);
  assert.ok(result.records.every(r=>r.datatype===undefined));
  for(const args of [[],['--records'],['--tag-map','tags.json'],['--records','--annotations']]) {
    const failure=run(args);assert.notEqual(failure.status,0);assert.equal(failure.stdout,'');
  }
});

const coreUrl=new URL('../../../../../aeon/implementations/typescript/packages/core/dist/index.js',import.meta.url);
const canonicalUrl=new URL('../../../../../aeon/implementations/typescript/packages/canonical/dist/index.js',import.meta.url);
test('real Core binds each comment to its path; canonicalization preserves values and discards comments',{
  skip:!existsSync(coreUrl)||!existsSync(canonicalUrl),
},async()=>{
  const core=await import(coreUrl);const {canonicalize}=await import(canonicalUrl);
  const input='created: !CustomDate 2026-11-16\nvalues: [!Text "001", {"": !Text "a\\r\\nb"}]';
  const bundle=read(input);const output=yamlToAeon(input,options);
  const result=core.compile(output);assert.deepEqual(result.errors,[]);
  assert.deepEqual(result.annotations.map(a=>[a.raw,a.target]),bundle.annotations.map(a=>[a.raw,a.target]));
  assert.deepEqual(core.compileToTelex(output).records,bundle.records);
  const canonical=canonicalize(output);assert.deepEqual(canonical.errors,[]);
  assert.equal(canonical.text,aesToAeon(bundle.records));assert.doesNotMatch(canonical.text,/yaml\.tag/);
  assert.deepEqual(core.compile(yamlToAeon('!<tag:example.com,2026:x@/evil> hello',options)).errors,[]);
});

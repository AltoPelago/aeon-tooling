import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { xmlToAes, xmlToAeon, xmlToTelex } from '../src/index.js';
const url = new URL('../../../../../aeon/implementations/typescript/packages/core/dist/index.js', import.meta.url);
const core = existsSync(url) ? await import(url.href) : null;

test('XML-to-AEON renders a wide shallow document within default limits', () => {
  const groups = 45_000;
  const source = '<doc>' + '<group><item/></group>'.repeat(groups) + '</doc>';
  const aeon = xmlToAeon(source, {includeHeader: false});
  assert.equal(aeon.split('<item>').length - 1, groups);
  assert.match(aeon, /^<xml@\{source = \|XML\|\}\(/);
});

test('CDATA sections remain separate typed strings among ordinary text and nodes', () => {
  const records = xmlToAes('<p>before<![CDATA[<first>]]><![CDATA[]]><b/><![CDATA[\n  last\n]]>after</p>');
  const children = records.filter(r => /^\$\.xml\[0\]\[\d+\]$/u.test(r.path));
  assert.deepEqual(children.map(({kind,datatype,value}) => ({kind,datatype,value})), [
    {kind:'StringLiteral',datatype:undefined,value:'before'},
    {kind:'StringLiteral',datatype:'cdata',value:'<first>'},
    {kind:'StringLiteral',datatype:'cdata',value:''},
    {kind:'NodeLiteral',datatype:undefined,value:undefined},
    {kind:'StringLiteral',datatype:'cdata',value:'\n  last\n'},
    {kind:'StringLiteral',datatype:undefined,value:'after'},
  ]);
  assert.equal(records.some(r => r.kind === 'StringLiteral' && r.value === '\n  last\n'), true);
});
test('CDATA content obeys XML newline normalization and existing limits', () => {
  const source = '<p><![CDATA[\r\n  x\r\n\r]]></p>';
  assert.equal(xmlToAes(source).at(-1).value, '\n  x\n\n');
  assert.throws(() => xmlToAes('<p><![CDATA[a]]><![CDATA[b]]></p>', {limits:{maxNodeChildren:1}}), /child count/);
  assert.throws(() => xmlToAes('<p><![CDATA[abc]]></p>', {sourceMetadata:false, limits:{maxStringCodepoints:2}}), /string/i);
  assert.throws(() => xmlToAes('<p><![CDATA[abc]]></p>', {limits:{maxEvents:3}}), /event count/);
});
test('explicit semantic mode retains the previous coalesced text mapping', () => {
  assert.deepEqual(xmlToAes('<p>A<![CDATA[B]]>C</p>', {preserveCdata:false}).at(-1),
    {path:'$.xml[0][0]', kind:'StringLiteral', value:'ABC'});
  assert.equal(xmlToAes('<p><![CDATA[x]]></p>', {mapping:'native'}).at(-1).datatype,'cdata');
});
test('CDATA datatype and exact string payload survive canonical AEON and portable Telex', {skip: !core && 'Built AEON Core unavailable'}, () => {
  for (const payload of ['', '\n\n    if (a < b && c > d) {\n      return "<success>";\n    }\n', 'C:\\tmp\\n\n`literal backticks` &amp; 😀', '\t  \n']) {
    const source = '<p><![CDATA['+payload+']]></p>';
    const aeon = xmlToAeon(source, {includeHeader:false});
    assert.match(aeon, /:cdata = /);
    assert.equal(aeon.includes('>`'),false);
    const result = core.compileToTelex(aeon);
    assert.deepEqual(result.compile.errors, []);
    assert.equal(result.telex,xmlToTelex(source));
    assert.equal(result.records.at(-1).value,payload);
  }
});

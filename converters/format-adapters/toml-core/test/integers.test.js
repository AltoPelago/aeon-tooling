import test from 'node:test';
import assert from 'node:assert/strict';
import {tomlToAes, tomlToAeon} from '../src/index.js';

const min = -(1n << 63n), max = (1n << 63n) - 1n;
test('signed 64-bit integer endpoints and unsigned radix maxima are exact', () => {
  for (const mapping of ['root','native']) {
    for (const spelling of [min.toString(),max.toString(),'+9_223_372_036_854_775_807','-9_223_372_036_854_775_808','-0','+0']) {
      const records = tomlToAes('n='+spelling,{mapping});
      const n=records.find(r=>r.path.endsWith('.n'));
      assert.equal(n.kind,'NumberLiteral'); assert.equal(BigInt(n.value),BigInt(spelling.replaceAll('_','')));
    }
    for (const [base,prefix] of [[2,'0b'],[8,'0o'],[16,'0x']]) {
      for (const value of [0n,1n,max]) {
        const digits=value.toString(base);
        const records=tomlToAes('n='+prefix+'000'+digits,{mapping});
        assert.equal(records.find(r=>r.path.endsWith('.n')).value,('000'+digits).toUpperCase());
      }
    }
  }
});
test('out-of-range decimal and radix integers fail instead of wrapping or rounding', () => {
  const invalid = [String(min-1n),String(max+1n),'+9_223_372_036_854_775_808','-9_223_372_036_854_775_809','999999999999999999999999999999'];
  for (const [base,prefix] of [[2,'0b'],[8,'0o'],[16,'0x']]) {
    invalid.push(prefix+(max+1n).toString(base),prefix+((1n<<64n)-1n).toString(base));
  }
  for (const value of invalid) {
    assert.throws(()=>tomlToAes('n='+value),error=>error.code==='TOML_INTEGER_OUT_OF_RANGE',value);
    assert.throws(()=>tomlToAes('n=['+value+']'),error=>error.code==='TOML_INTEGER_OUT_OF_RANGE',value);
  }
});
test('integer range checks do not misclassify floats or string contents', () => {
  for (const value of ['9223372036854775808.0','-9223372036854775809.0','1e100']) {
    assert.equal(tomlToAes('n='+value).find(r=>r.path.endsWith('.n')).kind,'NumberLiteral');
  }
  assert.equal(tomlToAes('n="9223372036854775808"').find(r=>r.path.endsWith('.n')).kind,'StringLiteral');
});
test('hex import normalizes case into the AEON radix alphabet', () => {
  const n=tomlToAes('n=0xDeAd_beEf').find(r=>r.path.endsWith('.n'));
  assert.equal(n.value,'DEADBEEF'); assert.equal(n.datatype,'radix');
  assert.deepEqual(n.clarifiers,[{kind:'NumberLiteral',value:'16'}]);
});
test('TOML 1.0 provenance is ordinary, optional and included in limits', () => {
  assert.deepEqual(tomlToAes('n=1').slice(0,3),[
    {path:'$.[""]',kind:'ObjectNode'},
    {path:'$.[""].@.source',kind:'SymbolicLiteral',value:'TOML'},
    {path:'$.[""].@.version',kind:'StringLiteral',value:'1.0'},
  ]);
  assert.match(tomlToAeon('n=1'),/source = \|TOML\|, version = "1.0"/);
  assert.equal(tomlToAes('n=1',{sourceMetadata:false}).some(r=>r.path.includes('.@.')),false);
  assert.equal(tomlToAes('',{limits:{maxEvents:3,maxKeySegmentCodepoints:7,maxStringCodepoints:3,maxPathDepth:2,maxPathCharacters:16}}).length,3);
  for (const limits of [{maxEvents:2},{maxKeySegmentCodepoints:6},{maxStringCodepoints:2},{maxPathDepth:1},{maxPathCharacters:15}]) {
    assert.throws(()=>tomlToAes('',{limits}),error=>error.code==='TOML_LIMIT_EXCEEDED');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteTomlString} from '../src/string.js';
import {tomlToAes} from '../src/index.js';

test('TOML basic-string encoding preserves controls, delimiters and Unicode in values and quoted keys', () => {
  const value=Array.from({length:32},(_,i)=>String.fromCharCode(i)).join('')+'\u007f"\\ 世界 😀';
  const encoded=quoteTomlString(value);
  assert.equal(encoded.includes('\u007f'),false);
  assert.match(encoded,/\\u007F/);
  const records=tomlToAes(`${encoded} = ${encoded}`,{sourceMetadata:false});
  assert.equal(records[1].value,value);
  // Decode the quoted member spelling independently of the string encoder.
  assert.equal(JSON.parse(records[1].path.slice('$.[""].['.length,-1)),value);
});
test('year 0000 is explicitly rejected for TOML dates and datetimes in every structure', () => {
  for (const value of ['0000-01-01','0000-02-29','0000-01-01T00:00:00','0000-01-01t00:00:00z','0000-01-01T00:00:00+11:00','0000-01-01 00:00:00']) {
    for (const source of [`n=${value}`,`n=[${value}]`,`n={date=${value}}`]) {
      assert.throws(()=>tomlToAes(source),error=>error.code==='TOML_UNSUPPORTED_YEAR'&&/0001 through 9999/.test(error.message));
    }
  }
  for(const value of ['0001-01-01','9999-12-31','0001-01-01T00:00:00Z','9999-12-31T23:59:59']) {
    assert.equal(tomlToAes('n='+value,{sourceMetadata:false})[1].value,value);
  }
  assert.equal(tomlToAes('n="0000-01-01"',{sourceMetadata:false})[1].kind,'StringLiteral');
});

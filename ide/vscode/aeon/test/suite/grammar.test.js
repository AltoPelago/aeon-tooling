const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Search patterns list for a pattern with given name.
// Priority: standalone p.name match first, then capture names.
function findMatchByName(repo, name) {
  // Pass 1: standalone pattern names only
  for (const key of Object.keys(repo)) {
    const entry = repo[key];
    if (!entry) continue;
    const patterns = Array.isArray(entry.patterns) ? entry.patterns : [];
    for (const p of patterns) {
      if (p.name === name && p.match) return p.match;
    }
  }
  // Pass 2: capture names
  for (const key of Object.keys(repo)) {
    const entry = repo[key];
    if (!entry) continue;
    const patterns = Array.isArray(entry.patterns) ? entry.patterns : [];
    for (const p of patterns) {
      if (p.match && p.captures) {
        for (const cap of Object.values(p.captures)) {
          if (cap.name === name) return p.match;
        }
      }
    }
  }
  return null;
}

function makeRegExp(source) {
  try { return new RegExp(source, 'm'); } catch (e) { return null; }
}

function findPatternByName(value, name) {
  if (!value || typeof value !== 'object') return null;
  if (value.name === name) return value;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findPatternByName(item, name);
        if (found) return found;
      }
    } else if (child && typeof child === 'object') {
      const found = findPatternByName(child, name);
      if (found) return found;
    }
  }
  return null;
}

suite('AEON grammar regex tests', () => {
  const grammarPath = path.resolve(__dirname, '..', '..', 'syntaxes', 'aeon.tmLanguage.json');
  const toolingRepoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
  const samplePath = path.resolve(
    toolingRepoRoot,
    '..',
    'aeon',
    'stress-tests',
    'full',
    'full-feature-stress.aeon'
  );
  const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
  const repo = grammar.repository || {};
  const sample = fs.readFileSync(samplePath, 'utf8');

  test('grammar JSON is valid and has repository', () => {
    assert(grammar.scopeName === 'source.aeon');
    assert(typeof repo === 'object');
  });

  test('hex color matches', () => {
    const pat = findMatchByName(repo, 'constant.numeric.hex.aeon');
    assert(pat, 'hex pattern not found');
    assert(makeRegExp(pat).test('#FF00AA'));
    assert(makeRegExp(pat).test(sample));
  });

  test('binary radix matches', () => {
    const pat = findMatchByName(repo, 'constant.numeric.binary.aeon');
    assert(pat, 'binary pattern not found');
    assert(makeRegExp(pat).test('%101101'));
    assert(makeRegExp(pat).test(sample));
  });

  test('base64 payload matches', () => {
    const pat = findMatchByName(repo, 'constant.numeric.base64.aeon');
    assert(pat, 'base64 pattern not found');
    assert(makeRegExp(pat).test('$QmFzZTY0IQ=='));
    assert(makeRegExp(pat).test(sample));
  });

  test('dimension ^1920x1080 matches', () => {
    const pat = findMatchByName(repo, 'constant.numeric.dimension.aeon');
    assert(pat, 'dimension pattern not found');
    assert(makeRegExp(pat).test('^1920x1080'));
    assert(makeRegExp(pat).test(sample));
  });

  test('zoned datetime matches', () => {
    const pat = findMatchByName(repo, 'constant.language.datetime.zoned.aeon');
    assert(pat, 'zoned datetime pattern not found');
    assert(makeRegExp(pat).test('2025-01-01T00:00:00Z&Australia/Sydney'));
    assert(makeRegExp(pat).test(sample));
  });

  test('plain date matches', () => {
    const pat = findMatchByName(repo, 'constant.language.date.aeon');
    assert(pat, 'date pattern not found');
    assert(makeRegExp(pat).test('2025-01-01'));
    assert(makeRegExp(pat).test(sample));
  });

  test('time literals match local and utc forms', () => {
    const pat = findMatchByName(repo, 'constant.language.time.aeon');
    assert(pat, 'time pattern not found');
    const re = makeRegExp(pat);
    assert(re.test('09:30:00'));
    assert(re.test('09:30:00Z'));
  });

  test('zoned datetime also matches local zoned form', () => {
    const pat = findMatchByName(repo, 'constant.language.datetime.zoned.aeon');
    assert(pat, 'zoned datetime pattern not found');
    const re = makeRegExp(pat);
    assert(re.test('2026-06-01T12:00:00Z&Asia/Tokyo'));
    assert(re.test('2026-06-01T12:00:00&Local'));
  });

  test('boolean literals match', () => {
    const pat = findMatchByName(repo, 'constant.language.boolean.aeon');
    assert(pat, 'boolean pattern not found');
    const re = makeRegExp(pat);
    assert(re.test('true'));
    assert(re.test('false'));
    assert(!re.test('yes'));
    assert(!re.test('no'));
  });

  test('toggle literals match', () => {
    const pat = findMatchByName(repo, 'constant.language.switch.aeon');
    assert(pat, 'switch pattern not found');
    const re = makeRegExp(pat);
    assert(re.test('yes'));
    assert(re.test('no'));
    assert(re.test('on'));
    assert(re.test('off'));
  });

  test('signed number literals match as one token', () => {
    const intPat = findMatchByName(repo, 'constant.numeric.integer.aeon');
    assert(intPat, 'integer pattern not found');
    const intRe = makeRegExp(intPat);
    assert(intRe.test('+1000'));
    assert(intRe.test('-1000'));

    const floatPat = findMatchByName(repo, 'constant.numeric.float.aeon');
    assert(floatPat, 'float pattern not found');
    const floatRe = makeRegExp(floatPat);
    assert(floatRe.test('+10.5'));
    assert(floatRe.test('-10.5'));
  });

  test('alias binding ~> matches with identifier capture', () => {
    const entry = repo['bindings'];
    assert(entry, 'bindings repo entry not found');
    const aliasPat = entry.patterns.find(p => p.name === 'meta.binding.alias.aeon');
    assert(aliasPat && aliasPat.match, 'alias binding meta pattern not found');
    const re = makeRegExp(aliasPat.match);
    assert(re.test('~>user'), '~>user should match');
    assert(re.test('~>a'), '~>a should match');
    assert(re.test('~> a'), '~> a should match');
    assert(re.test(sample), 'sample should match');
  });

  test('ref binding ~identifier matches', () => {
    const entry = repo['bindings'];
    const refPat = entry && entry.patterns.find(p => p.name === 'meta.binding.ref.aeon');
    assert(refPat && refPat.match, 'ref binding meta pattern not found');
    const re = makeRegExp(refPat.match);
    assert(re.test('~user'));
    assert(re.test('~numbers'));
    assert(re.test('~alpha'));
    assert(re.test(sample));
  });

  test('ref binding subscript ~name[N] and path ~name.field matches', () => {
    const entry = repo['bindings'];
    const refPat = entry && entry.patterns.find(p => p.name === 'meta.binding.ref.aeon');
    assert(refPat && refPat.match, 'ref binding meta pattern not found');
    assert(makeRegExp(refPat.match).test('~numbers[1]'));
    assert(makeRegExp(refPat.match).test('~finance.revenue'));
    assert(makeRegExp(refPat.match).test('~"a.b"'));
    assert(makeRegExp(refPat.match).test('~$.["a.b"]'));
    assert(makeRegExp(refPat.match).test('~a@meta'));
    assert(makeRegExp(refPat.match).test('~a@["x.y"]'));
  });

  test('key pattern matches untyped keys in sample', () => {
    const keysEntry = repo['keys'];
    assert(keysEntry, 'keys repo entry not found');
    const pat = keysEntry.patterns && keysEntry.patterns[0] && keysEntry.patterns[0].match;
    assert(pat, 'key pattern match not found');
    const re = makeRegExp(pat);
    assert(re.test('config ='));
    assert(re.test('alpha ='));
  });

  test('key fallback does not swallow typed datatype suffixes', () => {
    const keysEntry = repo['keys'];
    assert(keysEntry, 'keys repo entry not found');
    const pat = keysEntry.patterns && keysEntry.patterns[0] && keysEntry.patterns[0].match;
    assert(pat, 'key pattern match not found');
    const match = 'season_launch:zrut ='.match(makeRegExp(pat));
    assert(match, 'typed binding should still expose a key match');
    assert.equal(match[0], 'season_launch');
  });

  test('block doc comment /#...#/ matches', () => {
    const entry = repo['comments'];
    const pat = entry && entry.patterns.find(p => p.name === 'comment.block.doc.aeon');
    assert(pat && pat.begin, 'block doc comment pattern not found');
    assert(pat.begin === '/#', `expected /# but got "${pat.begin}"`);
    assert(pat.end === '#/', `expected #/ but got "${pat.end}"`);
    assert(makeRegExp(pat.begin).test('/# first element doc'));
    assert(makeRegExp(pat.end).test('#/'));
    assert(makeRegExp(pat.begin).test(sample));
  });

  test('line doc comment //# is a region so &ND can be tokenized', () => {
    const entry = repo['comments'];
    const pat = entry && entry.patterns.find(p => p.name === 'comment.line.doc.aeon');
    assert(pat && pat.begin, 'line doc comment region pattern not found');
    assert(pat.begin === '//#', `expected //# but got "${pat.begin}"`);
    assert(pat.end === '$', `expected line doc end to be $ but got "${pat.end}"`);
    assert(pat.patterns.some(p => p.include === '#and-doc-line'));
  });

  test('&ND document comment scopes replace markdown scopes', () => {
    assert(repo['and-doc'], '&ND document comment repository not found');
    assert(repo['and-doc-line'], '&ND line document comment repository not found');
    assert(findPatternByName(repo['and-doc'], 'meta.header.and.aeon'));
    assert(findPatternByName(repo['and-doc-line'], 'meta.header.and.aeon'));
    assert(findPatternByName(repo['and-doc'], 'markup.heading.and.aeon'));
    assert(findPatternByName(repo['and-doc'], 'markup.list.and.aeon'));
    assert(findPatternByName(repo['and-doc'], 'markup.quote.and.aeon'));
    assert(findPatternByName(repo['and-doc'], 'markup.inline.raw.string.and.aeon'));
    assert(!JSON.stringify(repo['comments']).includes('markdown'), 'doc comment grammar should not use markdown scopes');
  });

  test('inline hint /?...?/ matches', () => {
    const entry = repo['comments'];
    const pat = entry && entry.patterns.find(p => p.name === 'comment.block.inline-hint.aeon');
    assert(pat && pat.begin, 'inline hint pattern not found');
    assert(makeRegExp(pat.begin).test('/? inline hint'));
    assert(makeRegExp(pat.end).test('?/'));
    assert(makeRegExp(pat.begin).test(sample));
  });

  test('annotation block /@...@/ matches', () => {
    const entry = repo['comments'];
    const pat = entry && entry.patterns.find(p => p.name === 'comment.block.annotation.aeon');
    assert(pat && pat.begin, 'annotation block pattern not found');
    assert(makeRegExp(pat.begin).test('/@ ann'));
    assert(makeRegExp(pat.end).test('@/'));
  });

  test('reserved comment channels are present', () => {
    const entry = repo['comments'];
    assert(entry.patterns.some(p => p.name === 'comment.line.reserved.structure.aeon'));
    assert(entry.patterns.some(p => p.name === 'comment.line.reserved.profile.aeon'));
    assert(entry.patterns.some(p => p.name === 'comment.line.reserved.future.aeon'));
    assert(entry.patterns.some(p => p.name === 'comment.block.reserved.structure.aeon'));
    assert(entry.patterns.some(p => p.name === 'comment.block.reserved.profile.aeon'));
    assert(entry.patterns.some(p => p.name === 'comment.block.reserved.future.aeon'));
  });

  test('shebang line matches', () => {
    const pat = findMatchByName(repo, 'comment.line.shebang.aeon');
    assert(pat, 'shebang pattern not found');
    assert(makeRegExp(pat).test('//!/bin/aeon --profile=ts.object.v1'));
    assert(makeRegExp(pat).test(sample));
  });

  test('directive aeon:header matches', () => {
    const pat = findMatchByName(repo, 'keyword.control.directive.aeon');
    assert(pat, 'directive keyword pattern not found');
    assert(makeRegExp(pat).test('aeon:header'));
    assert(makeRegExp(pat).test(sample));
  });

  test('storage type annotation with parameters matches', () => {
    const entry = repo['typed-key'];
    assert(entry, 'typed-key repo entry not found');
    const pat = entry.patterns && entry.patterns[0] && entry.patterns[0].match;
    assert(pat, 'typed-key match pattern not found');
    const re = makeRegExp(pat);
    assert(re.test('flag:boolean ='));
    assert(re.test('count:list<int32> ='), 'list<int32> should match');
    assert(re.test('point:tuple<int32,int32> ='), 'tuple<int32,int32> should match');
    assert(re.test('size:dim[x] ='), 'dim[x] should match');
  });

  test('annotated key pattern supports optional datatype after attributes', () => {
    const entry = repo['typed-key-annotated'];
    assert(entry, 'typed-key-annotated repo entry not found');
    const pat = entry.patterns && entry.patterns[0] && entry.patterns[0].begin;
    assert(pat, 'typed-key-annotated begin pattern not found');
    const re = makeRegExp(pat);
    assert(re.test('season_launch@{ns="clock"}:zrut ='));
    assert(re.test('title@{role="headline"} ='));
  });

  test('single-quoted and backtick string patterns exist', () => {
    const stringsEntry = repo['strings'];
    assert(stringsEntry, 'strings repo entry not found');
    assert(stringsEntry.patterns.some(p => p.name === 'string.quoted.single.aeon'));
    assert(stringsEntry.patterns.some(p => p.name === 'string.quoted.template.aeon'));
  });

  test('node introducer syntax is recognized', () => {
    const pat = findMatchByName(repo, 'entity.name.tag.aeon');
    assert(pat, 'node tag pattern not found');
    assert(makeRegExp(pat).test('<div('));
  });

  test('annotated node introducer syntax is recognized', () => {
    const entry = repo['node-literals-annotated'];
    assert(entry, 'node-literals-annotated repo entry not found');
    const pat = entry.patterns && entry.patterns[0] && entry.patterns[0].begin;
    assert(pat, 'annotated node begin pattern not found');
    assert(makeRegExp(pat).test('<entity@{id="player_1"} ('));
  });

  test('quoted keys match', () => {
    const keysEntry = repo['keys'];
    assert(keysEntry, 'keys repo entry not found');
    const pat = keysEntry.patterns && keysEntry.patterns[0] && keysEntry.patterns[0].match;
    assert(pat, 'key pattern match not found');
    const re = makeRegExp(pat);
    assert(re.test('"display name" ='));
  });
});

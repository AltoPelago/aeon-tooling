import test from 'node:test';
import assert from 'node:assert/strict';
import {
  XML_ADAPTER_PRINCIPLES,
  XmlAesError,
  xmlToAes,
  xmlToTelex,
} from '../../test-support/xml-core.js';

test('maps the Section 6.1 XML document (declaration, attributes, qualified name, comments, mixed content, repeated nodes) to AES', () => {
  const xml = `<?xml version="1.0"?>
<person id="123">
  <name:user>Alice</name:user>
  <!-- comments can be converted -->
  mixed strings between nodes
  <age>30</age>
  <purchase price="3.30">cards</purchase>
  <purchase price="6.99">paper</purchase>
</person>`;

  assert.deepEqual(xmlToAes(xml), [
    { path: '$.["?xml"]', kind: 'NodeLiteral', tag: '?xml' },
    { path: '$.["?xml"].@.version', kind: 'StringLiteral', value: '1.0' },
    { path: '$.xml', kind: 'NodeLiteral', tag: 'xml' },
    { path: '$.xml[0]', kind: 'NodeLiteral', tag: 'person' },
    { path: '$.xml[0].@.id', kind: 'StringLiteral', value: '123' },
    { path: '$.xml[0][0]', kind: 'NodeLiteral', tag: 'name:user' },
    { path: '$.xml[0][0][0]', kind: 'StringLiteral', value: 'Alice' },
    { path: '$.xml[0][1]', kind: 'NodeLiteral', tag: '!--' },
    { path: '$.xml[0][1][0]', kind: 'StringLiteral', value: ' comments can be converted ' },
    { path: '$.xml[0][2]', kind: 'StringLiteral', value: 'mixed strings between nodes' },
    { path: '$.xml[0][3]', kind: 'NodeLiteral', tag: 'age' },
    { path: '$.xml[0][3][0]', kind: 'StringLiteral', value: '30' },
    { path: '$.xml[0][4]', kind: 'NodeLiteral', tag: 'purchase' },
    { path: '$.xml[0][4].@.price', kind: 'StringLiteral', value: '3.30' },
    { path: '$.xml[0][4][0]', kind: 'StringLiteral', value: 'cards' },
    { path: '$.xml[0][5]', kind: 'NodeLiteral', tag: 'purchase' },
    { path: '$.xml[0][5].@.price', kind: 'StringLiteral', value: '6.99' },
    { path: '$.xml[0][5][0]', kind: 'StringLiteral', value: 'paper' },
  ]);
});

test('Principle 1 (No coercion) & Section 6.3: preserves numeric-looking and boolean-looking XML values as StringLiteral', () => {
  assert.equal(XML_ADAPTER_PRINCIPLES.noCoercion, true);
  const xml = `<product price="3.30" quantity="2" active="true" code="03.30">
  <name>Paper</name>
  <weight>0.500</weight>
</product>`;

  const records = xmlToAes(xml);
  assert.deepEqual(records, [
    { path: '$.xml', kind: 'NodeLiteral', tag: 'xml' },
    { path: '$.xml[0]', kind: 'NodeLiteral', tag: 'product' },
    { path: '$.xml[0].@.price', kind: 'StringLiteral', value: '3.30' },
    { path: '$.xml[0].@.quantity', kind: 'StringLiteral', value: '2' },
    { path: '$.xml[0].@.active', kind: 'StringLiteral', value: 'true' },
    { path: '$.xml[0].@.code', kind: 'StringLiteral', value: '03.30' },
    { path: '$.xml[0][0]', kind: 'NodeLiteral', tag: 'name' },
    { path: '$.xml[0][0][0]', kind: 'StringLiteral', value: 'Paper' },
    { path: '$.xml[0][1]', kind: 'NodeLiteral', tag: 'weight' },
    { path: '$.xml[0][1][0]', kind: 'StringLiteral', value: '0.500' },
  ]);
});

test('Section 6.4 (CDATA): semantically maps CDATA sections into ordinary StringLiteral content', () => {
  const xml = `<script><![CDATA[if (a < b && b > c) { return "ok"; }]]></script>`;
  assert.deepEqual(xmlToAes(xml), [
    { path: '$.xml', kind: 'NodeLiteral', tag: 'xml' },
    { path: '$.xml[0]', kind: 'NodeLiteral', tag: 'script' },
    {
      path: '$.xml[0][0]',
      kind: 'StringLiteral',
      value: 'if (a < b && b > c) { return "ok"; }',
    },
  ]);

  // Adjacent text and CDATA merge into one logical StringLiteral child
  const merged = `<msg>Hello <![CDATA[<world>]]>!</msg>`;
  assert.deepEqual(xmlToAes(merged), [
    { path: '$.xml', kind: 'NodeLiteral', tag: 'xml' },
    { path: '$.xml[0]', kind: 'NodeLiteral', tag: 'msg' },
    { path: '$.xml[0][0]', kind: 'StringLiteral', value: 'Hello <world>!' },
  ]);
});

test('Section 6.5 (XML namespaces): preserves qualified element and attribute names with quoted attribute segments when needed', () => {
  const xml = `<user:name xmlns:user="urn:people" xml:lang="en">Alice</user:name>`;
  assert.deepEqual(xmlToAes(xml), [
    { path: '$.xml', kind: 'NodeLiteral', tag: 'xml' },
    { path: '$.xml[0]', kind: 'NodeLiteral', tag: 'user:name' },
    {
      path: '$.xml[0].@.["xmlns:user"]',
      kind: 'StringLiteral',
      value: 'urn:people',
    },
    {
      path: '$.xml[0].@.["xml:lang"]',
      kind: 'StringLiteral',
      value: 'en',
    },
    { path: '$.xml[0][0]', kind: 'StringLiteral', value: 'Alice' },
  ]);
});

test('expands predefined XML entities and decimal/hex character references in text and attributes', () => {
  const xml = `<quote attr="&lt;&gt;&amp;&apos;&quot; &#65; &#x1F600;">5 &lt; 10 &amp; 10 &gt; 5 &#x2713;</quote>`;
  assert.deepEqual(xmlToAes(xml), [
    { path: '$.xml', kind: 'NodeLiteral', tag: 'xml' },
    { path: '$.xml[0]', kind: 'NodeLiteral', tag: 'quote' },
    {
      path: '$.xml[0].@.attr',
      kind: 'StringLiteral',
      value: '<>&\'" A \u{1F600}',
    },
    {
      path: '$.xml[0][0]',
      kind: 'StringLiteral',
      value: '5 < 10 & 10 > 5 \u2713',
    },
  ]);
});

test('handles inline mixed content and xml:space="preserve"', () => {
  const inlineMixed = `<p>Hello <b>world</b>!</p>`;
  assert.deepEqual(xmlToAes(inlineMixed), [
    { path: '$.xml', kind: 'NodeLiteral', tag: 'xml' },
    { path: '$.xml[0]', kind: 'NodeLiteral', tag: 'p' },
    { path: '$.xml[0][0]', kind: 'StringLiteral', value: 'Hello ' },
    { path: '$.xml[0][1]', kind: 'NodeLiteral', tag: 'b' },
    { path: '$.xml[0][1][0]', kind: 'StringLiteral', value: 'world' },
    { path: '$.xml[0][2]', kind: 'StringLiteral', value: '!' },
  ]);

  const spacePreserved = `<pre xml:space="preserve">\n  <span>x</span>\n</pre>`;
  assert.deepEqual(xmlToAes(spacePreserved), [
    { path: '$.xml', kind: 'NodeLiteral', tag: 'xml' },
    { path: '$.xml[0]', kind: 'NodeLiteral', tag: 'pre' },
    { path: '$.xml[0].@.["xml:space"]', kind: 'StringLiteral', value: 'preserve' },
    { path: '$.xml[0][0]', kind: 'StringLiteral', value: '\n  ' },
    { path: '$.xml[0][1]', kind: 'NodeLiteral', tag: 'span' },
    { path: '$.xml[0][1][0]', kind: 'StringLiteral', value: 'x' },
    { path: '$.xml[0][2]', kind: 'StringLiteral', value: '\n' },
  ]);
});

test('comments and instructions keep spaces inside a mixed-text run', () => {
  for (const [markup, tag] of [['<!--note-->', '!--'], ['<?note data?>', '?note']]) {
    for (const separator of [' ', '\n  ']) {
      const records = xmlToAes(`<p>Hello${markup}${separator}<b>world</b>!</p>`);
      const tail = separator === ' ' ? [' ', 'b', '!'] : ['b', '!'];
      assert.deepEqual(records.filter(({path}) => /^\$\.xml\[0\]\[\d+\]$/u.test(path))
        .map(record => record.tag ?? record.value), ['Hello', tag, ...tail]);
    }
    const records = xmlToAes(`<p>A\n ${markup}B<b/></p>`);
    assert.equal(records.find(record => record.path === '$.xml[0][0]').value, 'A\n ');
  }
});

test('diagnostic columns count one scalar for supplementary PI, comment and CDATA data', () => {
  for (const [source, expectedPath] of [
    ['<?note 😀?><a x="1" x="2"/>', '$.xml[1]'],
    ['<!--😀--><a x="1" x="2"/>', '$.xml[1]'],
    ['<p><![CDATA[😀]]><a x="1" x="2"/></p>', '$.xml[0]'],
  ]) {
    const offset = source.lastIndexOf('x=');
    const column = Array.from(source.slice(0, offset)).length + 1;
    assert.throws(() => xmlToAes(source),
      {code: 'XML_DUPLICATE_ATTRIBUTE', path: expectedPath, line: 1, column, offset});
  }
});

test('supports self-closing tags and empty elements with 0 children', () => {
  const xml = `<root><br/><empty></empty></root>`;
  assert.deepEqual(xmlToAes(xml), [
    { path: '$.xml', kind: 'NodeLiteral', tag: 'xml' },
    { path: '$.xml[0]', kind: 'NodeLiteral', tag: 'root' },
    { path: '$.xml[0][0]', kind: 'NodeLiteral', tag: 'br' },
    { path: '$.xml[0][1]', kind: 'NodeLiteral', tag: 'empty' },
  ]);
});

test('keeps declaration attributes and ordered document content in separate scopes', () => {
  const source = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<?app mode="debug"?><?app enable debug mode?><?app 1 + 2??><?app?>'
    + '<person version="2" source="publisher">before<?app validate?><!---->after</person>'
    + '<?app done?><!-- epilog -->';
  const records = xmlToAes(source);
  assert.deepEqual(records.filter(({ tag }) => tag !== undefined).map(({ path, tag }) => [path, tag]), [
    ['$.["?xml"]', '?xml'],
    ['$.xml', 'xml'],
    ['$.xml[0]', '?app'],
    ['$.xml[1]', '?app'],
    ['$.xml[2]', '?app'],
    ['$.xml[3]', '?app'],
    ['$.xml[4]', 'person'],
    ['$.xml[4][1]', '?app'],
    ['$.xml[4][2]', '!--'],
    ['$.xml[5]', '?app'],
    ['$.xml[6]', '!--'],
  ]);
  const valueAt = path => records.find(record => record.path === path)?.value;
  assert.equal(valueAt('$.["?xml"].@.version'), '1.0');
  assert.equal(valueAt('$.xml[4].@.version'), '2');
  assert.equal(valueAt('$.xml[4].@.source'), 'publisher');
  assert.equal(valueAt('$.xml[0][0]'), 'mode="debug"');
  assert.equal(valueAt('$.xml[1][0]'), 'enable debug mode');
  assert.equal(valueAt('$.xml[2][0]'), '1 + 2?');
  assert.equal(valueAt('$.xml[3][0]'), undefined);
  assert.equal(valueAt('$.xml[4][2][0]'), '');
  assert.equal(valueAt('$.xml[6][0]'), ' epilog ');
});

test('validates declaration placement, PI syntax and the presence of a document element', () => {
  for (const [input, code] of [
    [' <?xml version="1.0"?><p/>', 'XML_MISPLACED_DECLARATION'],
    ['<p><?xml version="1.0"?></p>', 'XML_MISPLACED_DECLARATION'],
    ['<p/><?xml?>', 'XML_MISPLACED_DECLARATION'],
    ['<?XmL data?><p/>', 'XML_RESERVED_PI_TARGET'],
    ['<?xml encoding="UTF-8" version="1.0"?><p/>', 'XML_INVALID_DECLARATION'],
    ['<?xml version="1.&#48;"?><p/>', 'XML_INVALID_DECLARATION'],
    ['<?xml version="1.0"', 'XML_INVALID_DECLARATION'],
    ['<?app data<p/>', 'XML_UNTERMINATED_PI'],
    ['<?app data?><!-- empty -->', 'XML_EMPTY_DOCUMENT'],
    ['<!DOCTYPE p SYSTEM "person.dtd"><p/>', 'XML_DTD_FORBIDDEN'],
  ]) {
    assert.throws(() => xmlToAes(input), { code }, input);
  }
});

test('counts wrapper and markup nodes against XML document limits', () => {
  assert.equal(xmlToAes('<?p?><a/>', {limits: {maxNodeChildren: 2, maxValueNestingDepth: 2}}).length, 3);
  assert.throws(() => xmlToAes('<?p?><a/><?p?>', {limits: {maxNodeChildren: 2}}),
    { code: 'XML_LIMIT_EXCEEDED', counter: 'max_node_children', path: '$.xml', observed: 3 });
  assert.throws(() => xmlToAes('<r><b><l/><l/></b></r>', {limits: {maxNodeChildren: 1}}),
    { code: 'XML_LIMIT_EXCEEDED', counter: 'max_node_children', path: '$.xml[0][0]', observed: 2 });
  assert.throws(() => xmlToAes('<p><?p?></p>', {limits: {maxValueNestingDepth: 2}}),
    { code: 'XML_LIMIT_EXCEEDED', counter: 'max_value_nesting_depth', path: '$.xml[0]' });
  assert.throws(() => xmlToAes('<p><?long data?></p>', {rootName: 'doc', limits: {maxKeySegmentCodepoints: 4}}),
    { code: 'XML_LIMIT_EXCEEDED', counter: 'max_key_segment_codepoints', path: '$.doc[0][0]' });
});

test('Principle 2 (No repair) & Section 6.6 Security: rejects duplicate attributes, mismatched tags, DTDs, malformed PIs, and unknown entities', () => {
  // Duplicate attribute on element
  assert.throws(
    () => xmlToAes('<item id="1" id="2"/>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_DUPLICATE_ATTRIBUTE',
  );

  // Missing whitespace between attributes
  assert.throws(
    () => xmlToAes('<item a="1"b="2"/>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_EXPECTED_WHITESPACE',
  );

  // Mismatched closing tag
  assert.throws(
    () => xmlToAes('<a><b></a></b>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_MISMATCHED_TAG',
  );

  // Unclosed element
  assert.throws(
    () => xmlToAes('<root><child>text</root>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_MISMATCHED_TAG',
  );
  assert.throws(
    () => xmlToAes('<root><child>text'),
    (err) => err instanceof XmlAesError && err.code === 'XML_UNCLOSED_ELEMENT',
  );

  // DTD / XXE / entity declaration forbidden
  assert.throws(
    () => xmlToAes('<!DOCTYPE foo [<!ENTITY xxe "boom">]><foo/>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_DTD_FORBIDDEN',
  );

  // Unknown entity reference rejected
  assert.throws(
    () => xmlToAes('<foo>&custom;</foo>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_UNKNOWN_ENTITY',
  );

  // Invalid character reference (e.g., NUL &#0; or surrogate &#xD800;)
  assert.throws(
    () => xmlToAes('<foo>&#0;</foo>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_INVALID_CHAR_REF',
  );
  assert.throws(
    () => xmlToAes('<foo>&#xD800;</foo>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_INVALID_CHAR_REF',
  );

  // Literal ']]>' outside CDATA
  assert.throws(
    () => xmlToAes('<foo>abc]]>def</foo>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_UNEXPECTED_CDATA_END',
  );

  // Invalid comment containing '--'
  assert.throws(
    () => xmlToAes('<!-- bad -- comment --><foo/>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_INVALID_COMMENT',
  );

  // Processing instruction requires a separator after its target
  assert.throws(
    () => xmlToAes('<?app!broken?><foo/>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_INVALID_PI',
  );

  // Multiple root elements rejected
  assert.throws(
    () => xmlToAes('<first/><second/>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_MULTIPLE_ROOTS',
  );

  // UTF-8 BOM rejected
  assert.throws(
    () => xmlToAes('\uFEFF<foo/>'),
    (err) => err instanceof XmlAesError && err.code === 'XML_BOM',
  );
});

test('enforces Aeonic resource limits', () => {
  assert.throws(
    () => xmlToTelex('<a/>', { limits: { maxInputBytes: 2 } }),
    (err) => err instanceof XmlAesError && err.counter === 'max_input_bytes',
  );

  assert.throws(
    () => xmlToTelex('<a><b><c/></b></a>', { limits: { maxValueNestingDepth: 2 } }),
    (err) => err instanceof XmlAesError && err.counter === 'max_value_nesting_depth',
  );

  assert.throws(
    () => xmlToTelex('<root><a/><b/><c/></root>', { limits: { maxNodeChildren: 2 } }),
    (err) => err instanceof XmlAesError && err.counter === 'max_node_children',
  );

  assert.throws(
    () => xmlToTelex('<root>hello</root>', { limits: { maxStringCodepoints: 3 } }),
    (err) => err instanceof XmlAesError && err.counter === 'max_string_codepoints',
  );
});

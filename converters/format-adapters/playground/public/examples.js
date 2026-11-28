// Examples are shared by the browser and regression tests. Each declares the
// route and expected behavior in both modes; changing the mode keeps its source.
const preserved = 'Converts with supported values preserved.';
const same = 'Same values; no scalars need stringification.';
const compare = (count, detail) => ({
  lossless: {outcome: 'error', description: 'Stops: the target cannot preserve these scalar types.'},
  lossy: {outcome: 'success', stringifiedScalars: count, description: detail},
});
function example(id, title, from, to, source, description, expected) {
  return {id, title, from, to, source, description, expected: expected ?? {
    lossless: {outcome: 'success', stringifiedScalars: 0, description: preserved},
    lossy: {outcome: 'success', stringifiedScalars: 0, description: same},
  }};
}

export const exampleCatalog = {
  json: [
    example('json-nested', 'Objects, arrays and ordinary scalars', 'json', 'aeon', `{
  "name": "Alice",
  "active": true,
  "visits": 42,
  "tags": ["research", "design"],
  "preferences": {"theme": "light", "missing": null}
}
`, 'Nested objects and lists retain strings, numbers, booleans and null.'),
    example('json-precision', 'Exact numbers, Unicode and unusual keys', 'json', 'aeon', `{
  "integer": 9007199254740993,
  "decimal": 1.234567890123456789,
  "greeting": "Hello, 世界 😀",
  "": {"a.b": "a literal key", "$": 3, "@": {"source": "data"}}
}
`, 'Exact numeric text, empty keys and quoted paths. Materializer-reserved keys produce warnings, not parse errors.'),
    example('json-array-root', 'An array as the document root', 'json', 'aeon', '[1, {"name": "Bob"}, true, null, []]\n', 'The source root is wrapped once under the AEON empty key; nested values retain their kinds.'),
    example('json-scalar-root', 'A scalar as the document root', 'json', 'aeon', '"A document can be a string"\n', 'A string root becomes one ordinary empty-key binding.'),
    example('aeon-json-native', 'AEON values JSON can preserve', 'aeon', 'json', `""@{source = |JSON|} = {
  name = "Alice"
  active = true
  visits = 42
  tags = ["research", "design"]
  missing = !none
}
`, 'Both modes retain the JSON-compatible scalar kinds and unwrap the imported root.'),
    example('aeon-json-loss', 'Symbols, dates, toggles and special values', 'aeon', 'json', `status = |active|
day = 2002-01-01
enabled = on
reason = !"unknown"
forever = Infinity
color = #ffcc00
count = 42
`, 'Use the same source in both modes: JSON has no corresponding scalar kinds for six values.', compare(6, 'Six scalars become strings; count remains a number. Reverse conversion keeps the strings.')),
  ],
  xml: [
    example('xml-elements', 'Declaration, attributes and repeated elements', 'xml', 'aeon', `<?xml version="1.0"?>
<?application mode="debug"?>
<person id="42"><name>Alice</name><active>true</active><tag>research</tag><tag>design</tag></person>
<?application done?>
`, 'Element order and repetitions survive. XML text and attributes remain strings, including numeric/boolean-looking text.'),
    example('xml-mixed', 'Mixed content, qualified names and entities', 'xml', 'aeon', '<p xmlns:user="urn:people">Hello <user:name>Alice &amp; Bob</user:name>! &#x1F600;</p>\n', 'Ordered text and nodes, namespace spelling and decoded entity/character references. Namespace identity is not resolved.'),
    example('xml-cdata', 'CDATA, whitespace and adjacent sections', 'xml', 'aeon', `<?xml version="1.0"?>
<code xml:space="preserve">before<![CDATA[

    if (a < b && c > d) {
      return "<success>";
    }
]]><![CDATA[]]>after</code>
`, 'CDATA becomes separate :cdata string children, including the empty section. Swap after conversion to restore the sections.'),
    example('aeon-xml-native', 'AEON nodes with preserved CDATA', 'aeon', 'xml', `<"?xml"@{version = "1.0"}>
<xml@{source = |XML|}(
  <person@{id = "42"}(
    <name("Alice")>,
    <active("true")>,
    :cdata = ${JSON.stringify('if (a < b && c > d) { return "<success>"; }')}
  )>
)>
`, 'The document element, string attributes, text children and :cdata marker can all be represented in XML.'),
    example('aeon-xml-loss', 'Non-string XML attributes and children', 'aeon', 'xml', `<xml(
  <reading@{sequence = 42}(2002-01-01, on, <unit("C")>)>
)>
`, 'XML attributes and text have string values. The node structure is retained while unsupported scalar values change.', compare(3, 'The numeric attribute, date and toggle become text. XML cannot restore their original scalar types.')),
  ],
  toml: [
    example('toml-tables', 'Tables, dotted keys and arrays of tables', 'toml', 'aeon', `title = "Inventory"
owner.name = "Alice"
[database]
ports = [8000, 8001]
enabled = true
[[products]]
name = "Paper"
[[products]]
name = "Cards"
`, 'Separate table declarations are assembled into one object/list hierarchy before emitting AES.'),
    example('toml-scalars', 'Numbers, radix values and temporal types', 'toml', 'aeon', `integer = 9007199254740993
ratio = 1.234567890123456789
mask = 0b1010
hex = 0xFF
infinity = inf
not_a_number = nan
birthday = 2002-01-01
opening = 09:30:00
updated = 2026-11-16T10:30:00+11:00
`, 'Decimal precision, radix annotations and declared temporal kinds survive import. Binary/octal/hex values can now be exported back losslessly within the signed 64-bit range.'),
    example('toml-text', 'Multiline text, inline tables and empty keys', 'toml', 'aeon', `"" = "an ordinary empty key"
note = """
Hello, 世界.
This is a multiline basic string.
"""
path = 'C:\\Data\\Alice'
point = { x = 1, y = 2 }
`, 'Source strings remain strings; inline tables become objects and empty keys remain ordinary members.'),
    example('aeon-toml-native', 'AEON temporal and radix values', 'aeon', 'toml', `""@{source = |TOML|, version = "1.0"} = {
  name = "Alice"
  active = true
  joined = 2002-01-01
  visits = 42
  binary:radix[2] = %001010
  octal:radix[8] = %0755
  hex:radix[16] = %DEADBEEF
  minimum = -9223372036854775808
  maximum = 9223372036854775807
}
`, 'TOML preserves temporal values, all three integer radix bases, leading zeros and both signed 64-bit endpoints.'),
    example('aeon-toml-loss', 'Unsupported scalars and oversized integers', 'aeon', 'toml', `missing = !none
state = |active|
year = 2002-
oversize = 9223372036854775808
count = 42
`, 'TOML has no null/symbol kinds or year-only dates, and integers must fit signed 64-bit bounds.', compare(4, 'Null becomes "!none", the symbol becomes "|active|", the partial date becomes "2002-", and the oversized integer becomes a string.')),
  ],
  yaml: [
    example('yaml-collections', 'Block and flow collections', 'yaml', 'aeon', `person:
  name: Alice
  active: true
  tags: [research, design]
  preferences: {theme: light, missing: null}
"": []
`, 'Mappings with string keys, sequences, null and empty collections share the ordinary empty-key root convention.'),
    example('yaml-text', 'Literal and folded block text', 'yaml', 'aeon', `# Comments are accepted but not preserved.
literal: |-
  First line.
  Second line stays separate.
folded: >-
  These two source lines
  fold into one line.
quoted: "A string with \\n an escaped newline"
`, 'Block styles and chomping controls determine the resulting string. Original styles and comments are not round-trip data.'),
    example('yaml-resolution', 'Core schema resolution and exact numbers', 'yaml', 'aeon', `yes_word: yes
on_word: on
date_text: 2002-01-01
boolean: true
missing: ~
large: 9007199254740993
decimal: 1.234567890123456789
hex: 0xFF
`, 'yes, on and date-shaped values are strings under YAML 1.2 Core resolution; declared numeric and boolean values remain distinct.'),
    example('aeon-yaml-native', 'AEON values the YAML profile preserves', 'aeon', 'yaml', `""@{source = |YAML|, support = "limited", version = "1.2"} = {
  name = "Alice"
  active = true
  visits = 42
  missing = !none
}
`, 'Both modes preserve these supported scalar kinds and remove recognized adapter provenance on export.'),
    example('aeon-yaml-loss', 'A date, a symbol and a toggle', 'aeon', 'yaml', `day = 2002-01-01
status = |active|
enabled = on
count = 42
`, 'The current YAML profile would read these three values back as strings, so lossless export rejects their AEON scalar kinds.', compare(3, 'Three values become quoted strings; count remains a number. Switching back does not infer dates, symbols or toggles.')),
  ],
  alog: [
    example('alog-records', 'Repeated records and variable field counts', 'alog', 'aeon', '&LOG v1\n1, "Alice", true\n1, "Alice", true\n2, "Bob"\n', 'Duplicate records retain separate indexes; records may contain different numbers of fields.'),
    example('alog-comments', 'Comments, commas and explicit null', 'alog', 'aeon', `&LOG v1
// Comment-only lines do not produce records.
1, "Alice, Example", !none
/* A block comment can span
   several physical lines. */
2, /* field comment */ "Bob", false
`, 'Quoted commas belong to strings. Comments are whitespace; missing values must be explicit nulls.'),
    example('alog-scalars', 'Temporal, symbolic and other scalar families', 'alog', 'aeon', '&LOG v1\n42, 1.25, true, !none, |active|, on, 2002-01-01, #ff, Infinity\n', 'ALOG uses AEON scalar syntax while representing each physical record as a list.'),
    example('aeon-alog-native', 'AEON scalar record lists', 'aeon', 'alog', `""@{source = |ALOG|} = [
  [1, "Alice", true],
  [2, "Bob", false, 2002-01-01]
]
`, 'ALOG can retain its native AEON scalar families, including the date in the second record.'),
    example('aeon-alog-loss', 'Annotated scalar fields', 'aeon', 'alog', '"" = [[:int = 42, :string = "Bob", true]]\n', 'ALOG v1 excludes explicit scalar datatype annotations.', compare(2, 'The annotated number becomes "42" and the annotated string keeps "Bob"; true remains a boolean.')),
    example('alog-yaml-loss', 'A log date exported to YAML', 'alog', 'yaml', '&LOG v1\n2, "Bob", false, 2002-01-01\n', 'Compare the same dated record in lossless and lossy mode with YAML output.', compare(1, 'The final field becomes "2002-01-01". The other fields retain their kinds.')),
  ],
  aeon: [
    example('aeon-values', 'Objects, lists and exact scalars', 'aeon', 'aeon', 'person = {name = "Alice", tags = ["research", "design"]}\ncount = 9007199254740993\nmissing = !none\n', 'AEON output preserves these native values in both modes.'),
    example('aeon-scalar-families', 'Symbols, temporal values and toggles', 'aeon', 'aeon', 'state = |active|\nday = 2002-01-01\nenabled = on\nforever = Infinity\n', 'All these scalar families are native AEON. Choose an external output to explore its representability limits.'),
    example('aeon-heads', 'Empty root and attributed scalar children', 'aeon', 'aeon', '"" = [@{unit = "cm"}:number = 42, :string = "Alice"]\n', 'Ordinary empty-key bindings and anonymous scalar datatype/attribute heads survive AEON rendering.'),
  ],
};

export function examplesFor(from, to) {
  const catalog = exampleCatalog[from === 'aeon' ? to : from] ?? exampleCatalog.aeon;
  // Prefer the current conversion route, while retaining imports and reverse
  // comparisons in the same menu. Selecting a menu item never edits the source.
  return [...catalog].sort((a, b) => Number(b.from === from && b.to === to) - Number(a.from === from && a.to === to));
}
export function sampleFor(from, to) {
  return examplesFor(from, to)[0].source;
}
export const samples = Object.fromEntries(Object.entries(exampleCatalog).map(([format, examples]) => [format, examples[0].source]));

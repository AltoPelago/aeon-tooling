import { readFileSync } from 'node:fs';

// Executable examples: portable AES kinds, schemas and SANSA addresses all refer
// to the imported representation, including the ordinary empty-key root.
const root = '$.[""]';
const inventoryQuery = `from ${root}.items.* where .active == true and .price < 10 select .sku`;
const json = '{"items":[{"sku":"A1","price":9.5,"active":true},{"sku":"B2","price":12,"active":true},{"sku":"C3","price":4,"active":false}],"large":9007199254740993}';
const toml = `released = 2026-11-18
flags = 0xFF
[[items]]
sku = "A1"
price = 9.5
active = true
[[items]]
sku = "B2"
price = 12
active = true
[[items]]
sku = "C3"
price = 4
active = false
`;
const yaml = `items:
  - {sku: A1, price: 9.5, active: true}
  - {sku: B2, price: 12, active: true}
  - {sku: C3, price: 4, active: false}
note: yes
day: 2026-11-18
`;
const alog = '&LOG v1\n"A1", 9.5, true, 2026-11-18\n"B2", 12, true, 2026-11-19\n"C3", 4, false, 2026-11-20\n';
const xml = '<inventory><item sku="A1" active="true"><price>9.5</price><![CDATA[if (a < b) run();]]></item><item sku="B2" active="false"><price>12</price></item></inventory>';

export const cases = [
  {
    format: 'json', source: json,
    description: 'Objects, lists, booleans and exact numbers; the large integer never becomes a JavaScript Number.',
    schema: readFileSync(new URL('./schemas/json.aeos', import.meta.url), 'utf8'),
    queries: [
      { text: inventoryQuery, expected: ['A1'] },
      { text: `from ${root}.large where ? > 9007199254740992 select ?`, expected: ['9007199254740993'] },
    ],
    invalidSource: json.replace('9.5', '-1'),
    invalidPath: `${root}.items[0].price`,
  },
  {
    format: 'toml', source: toml,
    description: 'Arrays of tables plus native date and hexadecimal integer kinds.',
    schema: readFileSync(new URL('./schemas/toml.aeos', import.meta.url), 'utf8'),
    queries: [
      { text: inventoryQuery, expected: ['A1'] },
      { text: `from ${root}.released select ?`, expected: ['2026-11-18'] },
      { text: `from ${root}.flags select ?`, expected: ['FF'] },
    ],
    invalidSource: toml.replace('released = 2026-11-18', 'released = "2026-11-18"'),
    invalidPath: `${root}.released`,
  },
  {
    format: 'yaml', source: yaml,
    description: 'YAML 1.2 Core: yes and date-shaped text stay strings; true is a boolean.',
    schema: readFileSync(new URL('./schemas/yaml.aeos', import.meta.url), 'utf8'),
    queries: [
      { text: inventoryQuery, expected: ['A1'] },
      { text: `from ${root}.note select ?`, expected: ['yes'] },
      { text: `from ${root}.day select ?`, expected: ['2026-11-18'] },
    ],
    invalidSource: yaml.replace('active: true', 'active: "true"'),
    invalidPath: `${root}.items[0].active`,
  },
  {
    format: 'alog', source: alog,
    description: 'Ordered record lists with positional fields and native dates.',
    schema: readFileSync(new URL('./schemas/alog.aeos', import.meta.url), 'utf8'),
    queries: [
      { text: `from ${root}.* where ?[2] == true and ?[1] < 10 select ?[0]`, expected: ['A1'] },
      { text: `from ${root}.* where ?[0] == "A1" select ?[3]`, expected: ['2026-11-18'] },
    ],
    invalidSource: alog.replace('9.5', '"cheap"'),
    invalidPath: `${root}[0][1]`,
  },
  {
    format: 'xml', source: xml,
    description: 'Node heads, attribute spaces, string text and preserved CDATA; XML does not infer numeric or boolean types.',
    schema: readFileSync(new URL('./schemas/xml.aeos', import.meta.url), 'utf8'),
    queries: [
      { text: `from ${root}[0].*[0] where .@.active == "true" select .@.sku`, expected: ['A1'] },
      { text: `from ${root}[0][0][0][0][0][0] select ?`, expected: ['9.5'] },
      { text: `from ${root}.**#cdata select ?`, expected: ['if (a < b) run();'] },
    ],
    invalidSource: xml.replace('sku="A1"', 'sku=""'),
    invalidPath: `${root}[0][0][0].@.sku`,
  },
];

# md-to-and

Convert Markdown files into canonical standalone `&ND` documents.

## Scope (v1)

- headings
- paragraphs
- blockquotes
- lists
- fenced code blocks
- links, emphasis, strong, inline code
- thematic breaks
- YAML front matter mapped to `extension_block` `document/meta`

Unsupported Markdown constructs are preserved via `extension_block` fallback content and surfaced as diagnostics.

## CLI

```bash
md-to-and ./docs/guide.md
md-to-and ./docs --recursive
md-to-and ./docs --recursive --out ./out
```

Defaults:

- file input writes `input.and`
- directory input recursively converts all `*.md` files

## Library

```ts
import { convertMarkdownToAnd, convertPath } from '@aeon-tooling/md-to-and';

const result = await convertMarkdownToAnd('# Title\n\nHello.');
console.log(result.and);

await convertPath('./docs', { recursive: true });
```

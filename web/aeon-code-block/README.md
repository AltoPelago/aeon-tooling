# AEON Code Block

Vanilla web component for AEON documentation snippets.

Current features:

- framed code block with AEON palette
- lightweight syntax coloring for documentation examples
- support for current AEON comment channels, typed keys, quoted keys, and binding paths
- optional title
- copy-to-clipboard button
- no framework dependency

## Files

- `aeon-code-block.js` - custom element implementation
- `demo.html` - standalone smoke-test page

## Usage

```html
<script type="module" src="./aeon-code-block.js"></script>

<aeon-code-block title="Example">
  <script type="text/plain">
launch:zrut = 2026-06-01T12:00:00Z&Asia/Tokyo
  </script>
</aeon-code-block>
```

## Notes

- this is a documentation component, not a full editor
- tokenization is lightweight and intentionally avoids heavy dependencies, but it now tracks the current shared highlighting fixture more closely
- prefer nested `<script type="text/plain">` content for raw AEON snippets containing `<scene` or `&`
- if this becomes a broader docs dependency later, the next step is to split the tokenizer from the element shell

## Test

```bash
cd tooling/web/aeon-code-block
node --test highlight.test.mjs
```

# tree-sitter-aeon

Starter scaffold for a Tree-sitter grammar targeting AEON.

Primary consumer:

- Neovim via `nvim-treesitter`

Planned outputs:

- parser grammar
- highlight queries
- optional injections for doc-comment markup

Status:

- starter grammar covers comments, directives, typed and annotated bindings,
  attribute maps, node literals, containers, references, and core literals
- still incomplete relative to the full AEON language surface

## Generate

From this directory:

```bash
npm ci
npx tree-sitter generate
```

This will create generated files such as `src/parser.c` and `src/node-types.json`.

## Test

```bash
npx tree-sitter test
```

Grammar corpus lives under `test/corpus/`.

## Neovim Integration

Example `nvim-treesitter` parser registration:

```lua
local parser_config = require("nvim-treesitter.parsers").get_parser_configs()

parser_config.aeon = {
  install_info = {
    url = "/path/to/aeon/tooling/grammar/tree-sitter-aeon",
    files = { "src/parser.c" },
    branch = "main",
    generate_requires_npm = true,
    requires_generate_from_grammar = true,
  },
  filetype = "aeon",
}
```

Then add:

```lua
vim.filetype.add({
  extension = {
    aeon = "aeon",
  },
})
```

If you use `lazy.nvim`, a minimal end-to-end setup looks like:

```lua
return {
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    config = function()
      local parser_config = require("nvim-treesitter.parsers").get_parser_configs()
      local aeon_parser_path = "/path/to/aeon/tooling/grammar/tree-sitter-aeon"

      parser_config.aeon = {
        install_info = {
          url = aeon_parser_path,
          files = { "src/parser.c" },
          branch = "main",
          generate_requires_npm = true,
          requires_generate_from_grammar = true,
        },
        filetype = "aeon",
      }

      vim.filetype.add({
        extension = {
          aeon = "aeon",
        },
      })

      require("nvim-treesitter.configs").setup({
        ensure_installed = {},
        highlight = {
          enable = true,
        },
      })
    end,
  },
}
```

After that, install the parser inside Neovim with:

```vim
:TSInstall aeon
```

## Markdown Doc Comments

`queries/injections.scm` injects Markdown into `/# ... #/` block doc comments.
That lets Neovim reuse its Markdown highlighting inside AEON doc blocks.

Next steps:

1. add stronger list/tuple/object item recovery and separator handling
2. add doc-comment markup captures or markdown injections
3. generate the parser and test against `language-spec/examples/highlight-cases.aeon`

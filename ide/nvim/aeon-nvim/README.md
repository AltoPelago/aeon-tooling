# aeon-nvim

Neovim plugin for AEON Tree-sitter highlighting.

This plugin provides:

- AEON Tree-sitter highlight queries
- AEON Tree-sitter captures for document comments
- AEON-specific highlight overrides
- parser registration for the in-repo `tree-sitter-aeon` grammar

## Status

- usable local plugin
- intended to work alongside `nvim-treesitter`
- assumes this repo layout, with `tooling/ide/nvim/aeon-nvim/` and `tooling/grammar/tree-sitter-aeon/` kept together

## Install With lazy.nvim

Supported path today: install from this repo checkout.

```lua
{
  dir = "/path/to/aeon/tooling/ide/nvim/aeon-nvim",
  dependencies = {
    "nvim-treesitter/nvim-treesitter",
  },
  config = function()
    require("aeon").setup()
  end,
}
```

Minimal `init.lua` shape:

```lua
vim.opt.rtp:prepend(vim.fn.stdpath("data") .. "/lazy/lazy.nvim")

require("lazy").setup({
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
  },
  {
    dir = "/path/to/aeon/tooling/ide/nvim/aeon-nvim",
    dependencies = {
      "nvim-treesitter/nvim-treesitter",
    },
    config = function()
      require("aeon").setup()
    end,
  },
})
```

After restarting Neovim:

```vim
:TSInstall aeon
```

Then open any `*.aeon` file.

If you moved the parser elsewhere, pass it explicitly:

```lua
require("aeon").setup({
  parser_path = "/path/to/tree-sitter-aeon",
})
```

## What It Does

- appends the parser and plugin query paths to `runtimepath`
- registers the `aeon` parser for `nvim-treesitter`
- starts Tree-sitter highlighting for `*.aeon`
- exposes `:AeonHighlightRefresh`
- reapplies AEON highlight overrides on colorscheme changes

## Notes

- users still need `nvim-treesitter`
- parser generation comes from `tooling/grammar/tree-sitter-aeon/src/parser.c`
- document comments use `&ND`; the current parser exposes them as single tokens, so fine-grained `&ND` captures need grammar support before they can replace the removed Markdown injection
- after first setup, install the parser with `:TSInstall aeon`
- if `:TSInstall aeon` says unsupported, the plugin has not been loaded yet; restart Neovim and check your `lazy.nvim` config

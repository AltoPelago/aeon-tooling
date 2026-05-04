local parser_config = require("nvim-treesitter.parsers").get_parser_configs()
local this_file = debug.getinfo(1, "S").source:sub(2)
local this_dir = vim.fn.fnamemodify(this_file, ":p:h")
local aeon_parser_path = vim.fn.fnamemodify(this_dir .. "/../../grammar/tree-sitter-aeon", ":p")

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

return parser_config.aeon

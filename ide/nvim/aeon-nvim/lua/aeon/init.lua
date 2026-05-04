local M = {}

local function plugin_root()
  return vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":p:h:h:h")
end

local function default_parser_path()
  return vim.fn.fnamemodify(plugin_root() .. "/../../../grammar/tree-sitter-aeon", ":p")
end

local function register_parser(parser_path)
  require("nvim-treesitter.parsers").aeon = {
    install_info = {
      path = parser_path,
      files = { "src/parser.c" },
      queries = "queries",
      generate = false,
      generate_from_json = false,
    },
  }

  vim.filetype.add({
    extension = {
      aeon = "aeon",
    },
  })
end

function M.setup(opts)
  opts = opts or {}

  local parser_path = opts.parser_path or default_parser_path()
  if vim.fn.isdirectory(parser_path) == 0 then
    error("aeon.nvim could not find tree-sitter-aeon at " .. parser_path)
  end

  vim.opt.runtimepath:append(vim.fn.fnamemodify(parser_path, ":p"))
  vim.opt.runtimepath:append(plugin_root())
  vim.opt.termguicolors = true

  register_parser(parser_path)

  vim.api.nvim_create_autocmd("FileType", {
    pattern = "aeon",
    callback = function()
      vim.treesitter.start()
    end,
  })

  require("aeon.highlights").apply()

  vim.api.nvim_create_autocmd("ColorScheme", {
    callback = function()
      require("aeon.highlights").apply()
    end,
  })
end

return M

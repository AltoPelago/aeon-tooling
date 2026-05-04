local M = {}

function M.apply()
  vim.api.nvim_set_hl(0, "@property.aeon", { fg = "#7fb2ff" })
  vim.api.nvim_set_hl(0, "@type.aeon", { fg = "#c7b8ff" })
  vim.api.nvim_set_hl(0, "@attribute.aeon", { fg = "#caa0bf" })
  vim.api.nvim_set_hl(0, "@tag.aeon", { fg = "#e2c97a", bold = true })
  vim.api.nvim_set_hl(0, "@keyword.directive.aeon", { fg = "#8ec7d9", bold = true })
  vim.api.nvim_set_hl(0, "@comment.documentation.aeon", { fg = "#9aa9c7" })
  vim.api.nvim_set_hl(0, "@comment.note.aeon", { fg = "#7fc7d4", italic = true })
  vim.api.nvim_set_hl(0, "@comment.warning.aeon", { fg = "#d9ad7c", italic = true })
  vim.api.nvim_set_hl(0, "@string.special.aeon", { fg = "#bfb7a1" })
  vim.api.nvim_set_hl(0, "@constant.aeon", { fg = "#c7d98a" })

  vim.api.nvim_set_hl(0, "@property", { fg = "#7fb2ff" })
  vim.api.nvim_set_hl(0, "@type", { fg = "#c7b8ff" })
  vim.api.nvim_set_hl(0, "@attribute", { fg = "#caa0bf" })
  vim.api.nvim_set_hl(0, "@tag", { fg = "#e2c97a", bold = true })
  vim.api.nvim_set_hl(0, "@keyword.directive", { fg = "#8ec7d9", bold = true })
end

return M

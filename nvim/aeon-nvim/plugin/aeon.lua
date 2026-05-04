if vim.g.loaded_aeon_nvim == 1 then
  return
end
vim.g.loaded_aeon_nvim = 1

vim.api.nvim_create_user_command("AeonHighlightRefresh", function()
  require("aeon.highlights").apply()
end, {
  desc = "Reapply AEON highlight overrides",
})

-- Run with: nvim --headless -u NONE -l test/property-literals.nvim.lua PARSER TOOLING_ROOT
local parser_path = assert(arg[1], "compiled AEON parser path required")
local tooling = assert(arg[2], "tooling root required")
local function read(path)
  return table.concat(vim.fn.readfile(path, "b"), "\n")
end
local fixture = vim.json.decode(read(tooling .. "/test/fixtures/property-literals.json"))
vim.treesitter.language.add("aeon", { path = parser_path })
local query = vim.treesitter.query.parse("aeon",
  read(tooling .. "/ide/nvim/aeon-nvim/queries/aeon/highlights.scm"))
local function parse(source)
  return vim.treesitter.get_string_parser(source, "aeon"):parse()[1]:root()
end
local valid, incomplete, rejected = 0, 0, 0
local contexts = {
  function(a) return "selected:sansa = " .. a .. "\nnext = 1\n" end,
  function(a) return "holder@{selected:sansa = " .. a .. "} = 1\n" end,
  function(a) return "list = [ " .. a .. " ]\n" end,
  function(a) return "tuple = ( " .. a .. " )\n" end,
  function(a) return "<tag( " .. a .. " )>\n" end,
}
for _, address in ipairs(fixture.valid) do
  for _, context in ipairs(contexts) do
    local source = context(address)
    local root, matches = parse(source), 0
    assert(not root:has_error(), source .. "\n" .. root:sexpr())
    for id, node in query:iter_captures(root, source, 0, -1) do
      if query.captures[id] == "string.special.path" then
        assert(node:type() == "sansa_address")
        assert(vim.treesitter.get_node_text(node, source) == address, source)
        matches = matches + 1
      end
    end
    assert(matches == 1, source)
    valid = valid + 1
  end
end
for _, address in ipairs(fixture.unfinished) do
  local source = "selected:sansa = " .. address .. "\nnext = 1\n"
  local root, recovered, next_key = parse(source), 0, false
  for id, node in query:iter_captures(root, source, 0, -1) do
    local capture = query.captures[id]
    local value = vim.treesitter.get_node_text(node, source)
    if capture == "error" and node:type() == "incomplete_sansa_address" then
      assert(value == address, source)
      recovered = recovered + 1
    end
    if capture == "property" and value == "next" then next_key = true end
  end
  assert(recovered == 1 and next_key, source .. "\n" .. root:sexpr())
  incomplete = incomplete + 1
end
for _, prefix in ipairs(fixture.referencePrefixes) do
  for _, address in ipairs(fixture.valid) do
    local source = "copy = " .. prefix .. address
    assert(parse(source):has_error(), source)
    rejected = rejected + 1
  end
end
for _, invalid in ipairs({'query:sansa = $&headTag("book")', 'copy = <legacy>',
                         'items = [\\wrap\\ = <legacy>]', '<"">'}) do
  assert(parse(invalid):has_error(), invalid)
end
local source = '<"?xml"@{<true>}:node>\nobj = {<member>, list = [<child>, <child()>]}'
local root = parse(source)
assert(not root:has_error(), root:sexpr())
local tags = {}
for id, node in query:iter_captures(root, source, 0, -1) do
  if query.captures[id] == "tag" then
    tags[#tags + 1] = vim.treesitter.get_node_text(node, source)
  end
end
assert(vim.deep_equal(tags, {'"?xml"', 'true', 'member', 'child', 'child'}), vim.inspect(tags))
for _, source in ipairs({"copy=~items[0].name", "copy=~>items[0].name", "copy=~a.@.meta"}) do
  assert(not parse(source):has_error(), source)
end
print(vim.json.encode({ validContexts = valid, incompleteRecovered = incomplete,
  propertyReferencesRejected = rejected, ordinaryReferences = 3, liveEditor = false }))

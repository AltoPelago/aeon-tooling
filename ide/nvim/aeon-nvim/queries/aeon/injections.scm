; AEON document comments use &ND markup, not Markdown.
; The current tree-sitter grammar represents doc comments as single tokens,
; so fine-grained &ND captures need grammar support before an injection query
; can safely replace the old Markdown injection.

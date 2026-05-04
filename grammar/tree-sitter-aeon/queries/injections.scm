; Inject Markdown into AEON block doc comments.
;
; This is intentionally coarse for now: the entire `/# ... #/` body is treated
; as markdown-oriented content so Neovim can apply markdown tree-sitter
; highlighting inside documentation blocks.

((block_doc_comment) @injection.content
  (#set! injection.language "markdown"))

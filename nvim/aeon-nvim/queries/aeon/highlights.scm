; Core bindings

(binding
  "=" @operator)

(directive_key
  "aeon" @keyword
  ":" @punctuation.delimiter
  name: (identifier) @keyword.directive)

(typed_key
  name: [
    (identifier)
    (quoted_key)
  ] @property
  ":" @punctuation.delimiter
  datatype: (type_name) @type)

(binding
  key: (identifier) @property)

(binding
  key: (quoted_key) @property)

(annotated_key
  name: [
    (identifier)
    (quoted_key)
  ] @property)

(annotated_key
  datatype: (type_name) @type)

(attribute_assignment
  key: (attribute_key) @attribute)

(attribute_map
  "@" @punctuation.special
  "{" @punctuation.bracket
  "}" @punctuation.bracket)

(type_parameters
  ["<" ">" "[" "]"] @punctuation.bracket)

(type_parameter
  (type_name) @type)

(node_literal
  "<" @punctuation.special
  tag: (identifier) @tag
  "(" @punctuation.bracket
  ")" @punctuation.bracket)

["{" "}" "[" "]" "(" ")"] @punctuation.bracket
[","] @punctuation.delimiter

(clone_reference
  "~" @operator
  path: (reference_path) @variable)

(pointer_reference
  "~>" @operator
  path: (reference_path) @variable)

(string) @string
(template_string) @string.special
(hex_literal) @number
(radix_literal) @number
(encoding_literal) @string.special
(separator_literal) @string.special
(float) @number.float
(number) @number
(boolean) @boolean
(switch_literal) @constant.builtin
(date_literal) @constant
(time_literal) @constant
(utc_datetime) @constant
(local_datetime) @constant
(zoned_datetime) @constant

[
  (line_doc_comment)
  (block_doc_comment)
] @comment.documentation

[
  (line_annotation_comment)
  (block_annotation_comment)
] @comment.note

[
  (line_hint_comment)
  (block_hint_comment)
] @comment.warning

[
  (line_comment)
  (block_comment)
] @comment

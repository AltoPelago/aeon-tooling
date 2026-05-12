# AEON Scopes

This document is the cross-editor reference for AEON token categories.

## Core Tokens

| Token kind | Intended scope |
| --- | --- |
| directive introducer | `keyword.control.directive.aeon` |
| directive identifier | `entity.name.directive.aeon` |
| binding key | `variable.other.key.aeon` |
| datatype name | `storage.type.aeon` |
| datatype parameters | `storage.type.parameters.aeon` |
| node tag | `entity.name.tag.aeon` |
| attribute delimiters | `punctuation.definition.attribute.begin.aeon`, `punctuation.definition.attribute.end.aeon` |
| assignment operator | `keyword.operator.assign.aeon` |
| reference sigils | `keyword.other.binding.sigil.aeon`, `keyword.other.binding.alias.aeon` |
| reference path | `variable.other.readwrite.aeon` |

## Literal Tokens

| Token kind | Intended scope |
| --- | --- |
| string | `string.quoted.double.aeon`, `string.quoted.single.aeon` |
| template string | `string.quoted.template.aeon` |
| integer/float | `constant.numeric.integer.aeon`, `constant.numeric.float.aeon` |
| hex | `constant.numeric.hex.aeon` |
| radix/base64 | `constant.numeric.binary.aeon`, `constant.numeric.base64.aeon` |
| separator literal payload | `constant.numeric.dimension.aeon` |
| booleans | `constant.language.boolean.aeon` |
| toggle literals | `constant.language.switch.aeon` |
| date/time/datetime | `constant.language.date.aeon`, `constant.language.time.aeon`, `constant.language.datetime.utc.aeon`, `constant.language.datetime.local.aeon`, `constant.language.datetime.zoned.aeon` |

## Comment Channels

| Token kind | Intended scope |
| --- | --- |
| line doc comment | `comment.line.doc.aeon` |
| block doc comment | `comment.block.doc.aeon` |
| annotation comment | `comment.line.annotation.aeon`, `comment.block.annotation.aeon` |
| hint comment | `comment.line.hint.aeon`, `comment.block.inline-hint.aeon` |
| reserved channels | `comment.line.reserved.*.aeon`, `comment.block.reserved.*.aeon` |

## Doc Comment Markup

Inside `/# ... #/` block doc comments, use lightweight Markdown-like scopes:

| Markup | Intended scope |
| --- | --- |
| heading | `markup.heading.markdown` |
| list item | `markup.list.markdown` |
| bold | `markup.bold.markdown` |
| italic | `markup.italic.markdown` |
| inline code | `markup.inline.raw.string.markdown` |

## Notes

- VS Code remains the current canonical implementation.
- Other editors should preserve semantic categories even if exact scope names differ.
- Tree-sitter queries should map captures back to these categories where possible.

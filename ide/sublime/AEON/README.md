# AEON for Sublime Text

Native Sublime Text syntax package for AEON.

Current coverage:

- directives like `aeon:header`
- plain, typed, and annotated bindings
- node literals and annotated node tags
- attribute maps
- strings, numbers, booleans, date/time/datetime/wtc literals
- line comments and `//#` / `/# ... #/` doc comments with `&ND` styling
- matching `AEON Dark` color scheme using the same hex palette as the VS Code theme

Status:

- usable first-pass syntax
- scope model stays aligned with `language-spec/scopes.md`
- not yet packaged as a standalone `.sublime-package`

## Install Locally

1. Open Sublime Text.
2. Choose `Setup/Preferences: Browse Packages`.
3. Create `AEON/` inside that directory.
4. Copy `AEON.sublime-syntax` and `AEON.sublime-color-scheme` into that folder.
5. Reopen any `*.aeon` file.
6. Choose the `AEON Dark` color scheme if you want the bundled palette.

## Notes

- this is a native `.sublime-syntax` grammar, not a converted TextMate file
- the grammar is intentionally kept close to the VS Code token categories
- the bundled color scheme reuses the same hex values as the current VS Code theme
- syntax tests are still missing

## Property literals (unreleased source candidate)

The grammar recognises SANSA `&key("name")` and `&tag("book")` suffixes,
including quoted payloads and chained navigation.
Incomplete known arguments recover at the line boundary. These are presentation
rules; the compiler owns validation and reference restrictions remain unchanged.
See the [source checks and host boundaries](../../../docs/property-selector-support.md).
Installed extension/application qualification remains separate; no release or
deployment is performed by this source change.

Intrinsic node declarations colour the tag, identity, attributes and inline
datatype separately when the tag starts on the opener line. Empty forms such as
`<item>` and quoted tags such as `<"?xml">` use the same tag scope. Core
supplies language diagnostics. After a datatype has started, adjacent type
delimiters such as those in `<string>>` signal a generic continuation. The
lookahead skips horizontal whitespace. A complete tag followed by a list comma
starts a new node scope.

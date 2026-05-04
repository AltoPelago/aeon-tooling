# AEON for Sublime Text

Native Sublime Text syntax package for AEON.

Current coverage:

- directives like `aeon:header`
- plain, typed, and annotated bindings
- node literals and annotated node tags
- attribute maps
- strings, numbers, booleans, date/time/datetime/zrut literals
- line comments and `/# ... #/` doc comments with lightweight markdown styling
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

# AEON macOS Quick Look Extension

Native macOS Quick Look Preview Extension providing rich syntax highlighting for `.aeon` and `.and` files in the macOS Finder Quick Look GUI (Spacebar preview and Finder column preview).

## Features

- **Official AEON Syntax Highlighting**: Renders directives, tags, type annotations, keys, strings, literals, block comments (`/# #/`), and line comments (`//@`, `//?`, `//!`, etc.) using the canonical AltoPelago theme.
- **&ND Document Formatting**: Highlights `&ND` document structures, headings, code fences, blockquotes, lists, links, emphasis, and tables.
- **Dark & Light Mode**: Automatically adapts to system appearance (`prefers-color-scheme`).
- **Clean Developer UX**: Non-selectable line numbers (so copying code only copies lines, not line numbers), sticky top bar displaying file name, line count, and file size.
- **Zero-Drift Engine**: Embeds macOS's built-in `JavaScriptCore` to execute the repository's canonical `aeon-code-block.js` tokenization engine directly—guaranteeing 100% fidelity with the official web documentation.
- **Zero External Dependencies**: Compiles directly with standard `/usr/bin/swiftc` (macOS Command Line Tools) in ~1 second without heavy Xcode project configuration or package managers.

## Installation

From the root of `aeon-tooling`:

```sh
pnpm run install:quicklook
# or: npm run install:quicklook
# or: bash ide/quicklook/scripts/install.sh
```

This will:
1. Compile the host application and Quick Look Preview App Extension.
2. Bundle the official `aeon-code-block.js` highlighting engine into the extension resources.
3. Apply ad-hoc codesigning.
4. Install the bundle to `~/Applications/AEON QuickLook.app`.
5. Register `.aeon` and `.and` Uniform Type Identifiers (UTIs) with macOS Launch Services.
6. Register and activate the Quick Look extension with `pluginkit`.
7. Refresh Quick Look daemon caches (`qlmanage -r`).

## Usage

1. Open macOS **Finder**.
2. Select any `.aeon` or `.and` file.
3. Press the **Spacebar** (or `Cmd+Y` / Column view preview pane).
4. The Quick Look window immediately opens with colored syntax highlighting.

## Uninstallation

To remove the extension and unregister file associations:

```sh
pnpm run uninstall:quicklook
# or: npm run uninstall:quicklook
# or: bash ide/quicklook/scripts/uninstall.sh
```

## Architecture

- **Host App (`AEON QuickLook.app`)**: Background agent (`LSUIElement = true`) declaring system-wide UTIs (`org.altopelago.aeon` and `org.altopelago.and`) conforming to `public.source-code` and `public.plain-text`.
- **Preview Extension (`AEONPreview.appex`)**: Conforms to `com.apple.quicklook.preview` using `QLPreviewingController`. Intercepts preview requests and returns high-performance HTML replies (`QLPreviewReply`) rendered by macOS Quick Look's internal WebKit view.
- **Highlighter**: Uses macOS `JavaScriptCore` to execute `aeon-code-block.js` in a sandboxed, in-memory context (highlighting ~800 lines in <30ms).

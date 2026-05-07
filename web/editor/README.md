# &ND Block Editor

Distraction-free, versioned block editor for composing &ND documents.

## Usage

Serve the directory with any static server:

```sh
npx serve .
```

Open the resulting URL in a browser. No build step, no dependencies.

## Concepts

An article is a vertical stack of **blocks**. Each block can have multiple **versions** that slide horizontally. The **focused version** (active dot) is the one exported to the final document.

- **Split** — hover the right edge of a block to reveal the split line; click to split at that line.
- **Join** — press `Backspace` at the start of a block, or hover the border between two blocks and click.
- **Version** — create a new version to iterate on a block without losing the original. Switch between versions with `Alt+←/→` or click the dots.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+S` | Save `.aeon` file |
| `Ctrl+O` | Open `.aeon` file |
| `Ctrl+E` | Export `.and` file |
| `Ctrl+Shift+N` | New version (copy of current) |
| `Ctrl+Shift+D` | Delete current version |
| `Alt+←/→` | Switch version |
| `Ctrl+Enter` | Split block at cursor |
| `Backspace` | Join with block above (at start) |
| `↑/↓` | Navigate between blocks |
| `Ctrl+Shift+L` | Toggle dark/light theme |
| `?` | Show shortcut help |

## File Formats

### Source — `.aeon`

The editor saves all blocks and their versions as an AEON file with profile `aeon.editor.v1`. This preserves the full editing state including version history and focused indices.

### Export — `.and`

Export produces a standard `&ND v1` document by concatenating the focused version of each block, separated by blank lines.

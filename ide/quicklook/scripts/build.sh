#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUICKLOOK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$QUICKLOOK_DIR/../.." && pwd)"

BUILD_DIR="$QUICKLOOK_DIR/build"
APP_DIR="$BUILD_DIR/AEON QuickLook.app"
APP_CONTENTS="$APP_DIR/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
PLUGINS_DIR="$APP_CONTENTS/PlugIns"
APPEX_DIR="$PLUGINS_DIR/AEONPreview.appex"
APPEX_CONTENTS="$APPEX_DIR/Contents"
APPEX_MACOS="$APPEX_CONTENTS/MacOS"
APPEX_RESOURCES="$APPEX_CONTENTS/Resources"
CACHE_DIR="$BUILD_DIR/cache"

echo "==> Preparing build layout..."
rm -rf "$BUILD_DIR"
mkdir -p "$APP_MACOS" "$APPEX_MACOS" "$APPEX_RESOURCES" "$CACHE_DIR"

echo "==> Bundling AEON highlighter JavaScript engine..."
HIGHLIGHTER_SRC="$REPO_ROOT/web/highlighter/aeon-code-block/aeon-code-block.js"

if [[ ! -f "$HIGHLIGHTER_SRC" ]]; then
  echo "Error: Highlighter source not found at $HIGHLIGHTER_SRC" >&2
  exit 1
fi

# Transform module export for standalone JavaScriptCore execution and add &ND helper
sed 's/export function highlightAeon/function highlightAeon/g' "$HIGHLIGHTER_SRC" > "$APPEX_RESOURCES/highlighter.js"
cat << 'EOF' >> "$APPEX_RESOURCES/highlighter.js"

function highlightAnd(source) {
  return renderDocComment(source);
}
EOF

echo "==> Copying property lists..."
cp "$QUICKLOOK_DIR/src/host/Info.plist" "$APP_CONTENTS/Info.plist"
cp "$QUICKLOOK_DIR/src/extension/Info.plist" "$APPEX_CONTENTS/Info.plist"

echo "==> Compiling AEON QuickLook host application..."
swiftc -O -module-cache-path "$CACHE_DIR" \
  "$QUICKLOOK_DIR/src/host/main.swift" \
  -o "$APP_MACOS/AEONQuickLook"

echo "==> Compiling AEON QuickLook preview extension..."
swiftc -O -module-cache-path "$CACHE_DIR" \
  "$QUICKLOOK_DIR/src/extension/PreviewProvider.swift" \
  "$QUICKLOOK_DIR/src/extension/main.swift" \
  -o "$APPEX_MACOS/AEONPreview"

echo "==> Ad-hoc code signing app and extension bundle..."
codesign -s - --force --deep "$APP_DIR"

echo "==> Build complete: $APP_DIR"

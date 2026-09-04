#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUICKLOOK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_APP="$QUICKLOOK_DIR/build/AEON QuickLook.app"

if [[ ! -d "$BUILD_APP" ]]; then
  echo "==> Build artifact not found. Running build.sh first..."
  bash "$SCRIPT_DIR/build.sh"
fi

TARGET_DIR="$HOME/Applications"
TARGET_APP="$TARGET_DIR/AEON QuickLook.app"

echo "==> Installing to $TARGET_APP..."
mkdir -p "$TARGET_DIR"
rm -rf "$TARGET_APP"
cp -R "$BUILD_APP" "$TARGET_APP"

echo "==> Re-signing installed bundle..."
codesign -s - --force --deep "$TARGET_APP"

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
if [[ -x "$LSREGISTER" ]]; then
  echo "==> Registering with macOS Launch Services..."
  "$LSREGISTER" -f "$TARGET_APP"
fi

echo "==> Registering Quick Look extension..."
pluginkit -a "$TARGET_APP/Contents/PlugIns/AEONPreview.appex" 2>/dev/null || true
pluginkit -e use -i org.altopelago.aeon-quicklook.preview 2>/dev/null || true

echo "==> Refreshing Quick Look generator cache..."
qlmanage -r 2>/dev/null || true
qlmanage -r cache 2>/dev/null || true
killall quicklookd 2>/dev/null || true

cat << 'EOF'

===================================================================
  AEON QuickLook successfully installed!
  Location: ~/Applications/AEON QuickLook.app
===================================================================

Quick Look GUI is now active for:
  - .aeon (AEON documents with official syntax highlighting)
  - .and  (&ND documents with structured text & inline formatting)

How to test:
  1. Open macOS Finder.
  2. Select any .aeon or .and file.
  3. Press the Spacebar to preview!

EOF

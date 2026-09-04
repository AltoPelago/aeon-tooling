#!/usr/bin/env bash
set -euo pipefail

TARGET_APP="$HOME/Applications/AEON QuickLook.app"

echo "==> Uninstalling AEON QuickLook..."

if [[ -d "$TARGET_APP" ]]; then
  pluginkit -r "$TARGET_APP/Contents/PlugIns/AEONPreview.appex" 2>/dev/null || true

  LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
  if [[ -x "$LSREGISTER" ]]; then
    "$LSREGISTER" -u "$TARGET_APP" 2>/dev/null || true
  fi

  rm -rf "$TARGET_APP"
  echo "==> Removed $TARGET_APP"
else
  echo "==> $TARGET_APP was not installed."
fi

qlmanage -r 2>/dev/null || true
qlmanage -r cache 2>/dev/null || true
killall quicklookd 2>/dev/null || true

echo "==> AEON QuickLook uninstalled successfully."

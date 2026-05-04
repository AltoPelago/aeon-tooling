#!/usr/bin/env bash
set -euo pipefail

mode="${1:---check}"

case "$mode" in
  --check|--write) ;;
  *)
    echo "Usage: bash scripts/cleanup-public.sh [--check|--write]" >&2
    exit 2
    ;;
esac

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

find_generated() {
  find . \
    -path './.git' -prune \
    -o \( -path './node_modules' -o -path '*/node_modules' -o -path '*/dist' -o -path './target' -o -path '*/target' -o -path './.vscode-test' -o -path '*/.vscode-test' -o -path './.npm-cache' -o -path '*/.npm-cache' \) -prune -print \
    -o \( -name '.DS_Store' -o -name '*.tsbuildinfo' \) -print
}

generated="$(find_generated | sort)"

if [[ "$mode" == "--check" ]]; then
  if [[ -n "$generated" ]]; then
    printf 'Generated or local-only files are present:\n%s\n' "$generated" >&2
    printf '\nRun `npm run clean` before committing or publishing.\n' >&2
    exit 1
  fi
  echo "No generated or local-only files found."
  exit 0
fi

if [[ -z "$generated" ]]; then
  echo "No generated or local-only files to remove."
  exit 0
fi

while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  rm -rf "$path"
done <<< "$generated"

echo "Removed generated and local-only files."

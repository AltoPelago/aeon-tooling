#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$script_dir/check-no-local-paths.sh"
bash "$script_dir/cleanup-public.sh" --check

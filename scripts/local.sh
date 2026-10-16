#!/usr/bin/env bash
set -euo pipefail

task_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$task_root/.devtools/bootstrap/node/bin:$task_root/.devtools/bootstrap/npm/bin:$task_root/.devtools/bootstrap/bin:/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo '缺少 Node.js，请先执行 bash scripts/bootstrap-local.sh。' >&2
  exit 1
fi
exec node "$task_root/scripts/local-dev.mjs" "$@"

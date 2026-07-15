#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"

npm run build >/dev/null
node packages/cli/dist/index.js init "$ROOT" >/dev/null
node packages/cli/dist/index.js start "$ROOT" \
  --agent fake-agent \
  --scenario usage_limit \
  --fallback fake-agent \
  --fallback-scenario success

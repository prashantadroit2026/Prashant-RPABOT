#!/bin/sh
set -eu
# Resolve workspace root: sandbox uses /workspace, local checkout uses script dir
if [ -d "/workspace" ]; then
  cd /workspace
else
  cd "$(dirname "$0")"
fi
# :8081 is QA-only — a revive must never inherit a stale built-output preview.
node scripts/preview.mjs stop || true
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &

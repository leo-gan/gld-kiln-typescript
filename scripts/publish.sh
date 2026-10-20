#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/github_release.py
if [[ -z "${NODE_AUTH_TOKEN:-}" ]]; then
  echo "npm publish skipped: NODE_AUTH_TOKEN is unset"
  exit 0
fi
npm config set //registry.npmjs.org/:_authToken "${NODE_AUTH_TOKEN}"
npm publish --access public

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p tests/generated
node src/cli.ts testdata/schema/point.json -o tests/generated/point.ts
node src/cli.ts testdata/schema/message.json -o tests/generated/message.ts

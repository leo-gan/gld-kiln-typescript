#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
node src/cli.ts testdata/schema/point.json -o "$tmpdir/point.ts"
node src/cli.ts testdata/schema/point.json -o "$tmpdir/point2.ts"
node src/cli.ts testdata/schema/message.json -o "$tmpdir/message.ts"
node src/cli.ts testdata/schema/message.json -o "$tmpdir/message2.ts"
cmp "$tmpdir/point.ts" "$tmpdir/point2.ts"
cmp "$tmpdir/message.ts" "$tmpdir/message2.ts"

#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 CLICK_REPOSITORY" >&2
  exit 2
fi

repo=$(cd "$(dirname "$0")/../.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

node "$repo/benchmark/av-exp-003/run.mjs" \
  "$1" \
  "$out/results"
node "$repo/benchmark/av-exp-003/verify-results.mjs" \
  "$out/results"

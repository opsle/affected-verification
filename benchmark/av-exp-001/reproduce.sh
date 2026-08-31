#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
target="${AV_TARGET:-/tmp/av-exp-001-target}"
scratch="${AV_SCRATCH:-/tmp/av-exp-001-scratch}"
results="$root/benchmark/av-exp-001/results-v2"

if [[ ! -d "$target/.git" ]]; then
  node "$root/benchmark/av-exp-001/run.mjs" \
    prepare \
    --target "$target"
fi

node "$root/benchmark/av-exp-001/run.mjs" \
  all \
  --target "$target" \
  --scratch "$scratch" \
  --results "$results"

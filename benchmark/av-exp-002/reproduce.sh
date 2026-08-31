#!/bin/sh
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: ./reproduce.sh CLICK_REPOSITORY [RESULTS_DIR]" >&2
  exit 2
fi

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RESULTS=${2:-"$HERE/reproduction-results"}

node "$HERE/run.mjs" "$1" "$RESULTS"
node "$HERE/verify-results.mjs" "$RESULTS"

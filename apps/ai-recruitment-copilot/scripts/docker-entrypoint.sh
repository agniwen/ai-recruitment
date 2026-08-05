#!/bin/sh
set -eu

if [ "$#" -ge 2 ] && [ "$1" = "node" ] && [ "$2" = ".output/server/index.mjs" ]; then
  node .output/migrate.mjs
fi

exec "$@"

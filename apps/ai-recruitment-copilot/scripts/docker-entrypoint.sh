#!/bin/sh
set -eu

if [ -z "$TZ" ]; then
  export TZ=Asia/Shanghai
fi

if [ "$#" -ge 2 ] && [ "$1" = "node" ] && [ "$2" = ".output/server/index.mjs" ]; then
  node .output/migrate.mjs
fi

exec "$@"

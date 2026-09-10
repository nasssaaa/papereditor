#!/bin/bash
set -euo pipefail
TASK_ROOT="${PAPEREDITOR_ROOT:-/Volumes/KIOXIA/PaperEditor}"
test -d "$TASK_ROOT/data" || { echo 'Data disk is unavailable'; exit 1; }
test "$(stat -f %d /Volumes/KIOXIA)" != "$(stat -f %d /Volumes)" || { echo 'KIOXIA is not mounted'; exit 1; }
export PATH="$TASK_ROOT/runtime/node/bin:/Applications/Docker.app/Contents/Resources/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export DATA_DIR="$TASK_ROOT/data" REQUIRED_VOLUME=/Volumes/KIOXIA HOST=127.0.0.1 PORT=18080
export COMPILE_BACKEND=macos-sandbox TEXLIVE_DIR="$TASK_ROOT/texlive" COOKIE_SECURE=true TRUST_PROXY=true
export DOCKER_BIN=/Applications/Docker.app/Contents/Resources/bin/docker
export TMPDIR="$TASK_ROOT/tmp"
cd "$TASK_ROOT/app"
exec "$TASK_ROOT/runtime/node/bin/node" dist/server/index.js

#!/bin/bash
set -euo pipefail
TASK_ROOT="${PAPEREDITOR_ROOT:-/Volumes/KIOXIA/PaperEditor}"
DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker"
export PATH="/Applications/Docker.app/Contents/Resources/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
test "$(stat -f %d /Volumes/KIOXIA)" != "$(stat -f %d /Volumes)" || { echo 'KIOXIA is not mounted'; exit 1; }
mkdir -p "$TASK_ROOT/texlive" "$TASK_ROOT/data" "$TASK_ROOT/logs" "$TASK_ROOT/tmp" "$TASK_ROOT/cache/npm"
"$DOCKER" build --platform linux/arm64 -t papereditor-tex-runtime:2026 -f "$TASK_ROOT/app/deploy/Dockerfile.tex" "$TASK_ROOT/app/deploy"
"$DOCKER" run --rm --name papereditor-tex-setup --platform linux/arm64 \
  --mount "type=bind,src=$TASK_ROOT/texlive,dst=/opt/texlive" \
  --mount "type=bind,src=$TASK_ROOT/app/deploy,dst=/setup,readonly" \
  papereditor-tex-runtime:2026 /bin/sh /setup/install-tex.sh

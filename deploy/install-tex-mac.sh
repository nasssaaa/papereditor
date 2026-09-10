#!/bin/bash
set -euo pipefail
TASK_ROOT="${PAPEREDITOR_ROOT:-/Volumes/KIOXIA/PaperEditor}"
TEX_ROOT="$TASK_ROOT/texlive"
REPOSITORY="${TEX_REPOSITORY:-https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet}"
export PATH="$TEX_ROOT/bin/universal-darwin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$TASK_ROOT/tmp/tex-setup" "$TEX_ROOT"
cd "$TASK_ROOT/tmp/tex-setup"
if [ ! -x "$TEX_ROOT/bin/universal-darwin/tlmgr" ]; then
  curl -fL --retry 3 "$REPOSITORY/install-tl-unx.tar.gz" -o install-tl.tar.gz
  tar -xzf install-tl.tar.gz
  cat > texlive.profile <<PROFILE
selected_scheme scheme-small
TEXDIR $TEX_ROOT
TEXMFCONFIG $TEX_ROOT/texmf-config
TEXMFHOME $TEX_ROOT/texmf-home
TEXMFLOCAL $TEX_ROOT/texmf-local
TEXMFSYSCONFIG $TEX_ROOT/texmf-config
TEXMFSYSVAR $TEX_ROOT/texmf-var
TEXMFVAR $TEX_ROOT/texmf-var
instopt_adjustpath 0
instopt_letter 0
instopt_portable 1
tlpdbopt_install_docfiles 0
tlpdbopt_install_srcfiles 0
PROFILE
  perl install-tl-*/install-tl -profile texlive.profile -repository "$REPOSITORY"
fi
tlmgr option repository "$REPOSITORY"
tlmgr option docfiles 0
tlmgr option srcfiles 0
tlmgr install collection-langchinese collection-latexextra collection-bibtexextra collection-mathscience collection-xetex collection-luatex latexmk synctex biber
if [ "${INSTALL_DOCKER_PLATFORM:-false}" = true ]; then
  tlmgr platform add aarch64-linux
fi
fmtutil-sys --all
xelatex --version
latexmk -v

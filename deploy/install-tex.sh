#!/bin/sh
set -eu
REPOSITORY="${TEX_REPOSITORY:-https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet}"
export TEXMFVAR=/opt/texlive/texmf-var TEXMFCONFIG=/opt/texlive/texmf-config TEXMFHOME=/opt/texlive/texmf-home HOME=/tmp
if [ ! -x /opt/texlive/bin/aarch64-linux/tlmgr ]; then
  cd /tmp
  curl -fL --retry 3 "$REPOSITORY/install-tl-unx.tar.gz" -o install-tl.tar.gz
  tar -xzf install-tl.tar.gz
  cd install-tl-*/
  cat > /tmp/texlive.profile <<'PROFILE'
selected_scheme scheme-small
TEXDIR /opt/texlive
TEXMFCONFIG /opt/texlive/texmf-config
TEXMFHOME /opt/texlive/texmf-home
TEXMFLOCAL /opt/texlive/texmf-local
TEXMFSYSCONFIG /opt/texlive/texmf-config
TEXMFSYSVAR /opt/texlive/texmf-var
TEXMFVAR /opt/texlive/texmf-var
instopt_adjustpath 0
instopt_letter 0
instopt_portable 1
tlpdbopt_install_docfiles 0
tlpdbopt_install_srcfiles 0
PROFILE
  perl install-tl -profile /tmp/texlive.profile -repository "$REPOSITORY"
fi
tlmgr option repository "$REPOSITORY"
tlmgr option docfiles 0
tlmgr option srcfiles 0
tlmgr install collection-langchinese collection-latexextra collection-bibtexextra collection-mathscience collection-xetex collection-luatex latexmk synctex biber
fmtutil-sys --all
xelatex --version
latexmk -v

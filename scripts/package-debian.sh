#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source_dir=dist/desktop-linux-x64
test -x "$source_dir/electron"
version=$(node -p "require('./apps/desktop/package.json').version")
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/DEBIAN" "$stage/opt/loja-roupas" "$stage/usr/bin" "$stage/usr/share/applications"
chmod 755 "$stage"
cp -a "$source_dir/." "$stage/opt/loja-roupas"
cat > "$stage/DEBIAN/control" <<CONTROL
Package: loja-roupas
Version: $version
Architecture: amd64
Maintainer: Loja de Roupas
Depends: libgtk-3-0 | libgtk-3-0t64, libnss3, libasound2 | libasound2t64, libgbm1, libxss1, libatk-bridge2.0-0 | libatk-bridge2.0-0t64, libnotify4
Section: utils
Priority: optional
Description: Cliente desktop para o servidor Loja de Roupas em LAN
CONTROL
cat > "$stage/usr/bin/loja-roupas" <<'LAUNCHER'
#!/bin/sh
exec /opt/loja-roupas/electron "$@"
LAUNCHER
chmod 755 "$stage/usr/bin/loja-roupas"
cat > "$stage/usr/share/applications/loja-roupas.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Loja de Roupas
Exec=loja-roupas
Terminal=false
Categories=Office;
DESKTOP
dpkg-deb --root-owner-group --build "$stage" "dist/loja-roupas_${version}_amd64.deb"

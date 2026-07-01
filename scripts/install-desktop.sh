#!/usr/bin/env bash
# Install SISpace .desktop entry and hicolor icons into the user data dir.
# Invoked automatically from gtk-app/build.rs after each cargo build of sispace-gtk.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGING="${ROOT}/packaging"
ICON_SRC="${PACKAGING}/icons/sispace.svg"
DESKTOP_IN="${PACKAGING}/dev.lev.sispace.desktop.in"
ICON_NAME="dev.lev.sispace"
LAUNCHER_ICON="sispace"

PROFILE="${SISPACE_PROFILE:-debug}"
TARGET_DIR="${CARGO_TARGET_DIR:-${ROOT}/target}"
EXEC="${SISPACE_EXEC:-${TARGET_DIR}/${PROFILE}/sispace-gtk}"

# Cargo may pass a relative target dir; launchers need a stable absolute Exec path.
if [[ "${EXEC}" != /* ]]; then
  EXEC="${ROOT}/${EXEC#./}"
fi
EXEC="$(readlink -f "${EXEC}" 2>/dev/null || realpath "${EXEC}" 2>/dev/null || echo "${EXEC}")"

if [[ ! -f "${EXEC}" ]]; then
  echo "sispace install-desktop: binary not found at ${EXEC}, skipping" >&2
  exit 0
fi

if [[ ! -f "${ICON_SRC}" || ! -f "${DESKTOP_IN}" ]]; then
  echo "sispace install-desktop: missing packaging files under ${PACKAGING}" >&2
  exit 1
fi

DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
APPS_DIR="${DATA_HOME}/applications"
ICONS_DIR="${DATA_HOME}/icons/hicolor"
DESKTOP_OUT="${APPS_DIR}/${ICON_NAME}.desktop"

mkdir -p "${APPS_DIR}"

# Remove legacy Tauri launcher (duplicate Name=SISpace confuses Quickshell search).
legacy="${APPS_DIR}/SISpace.desktop"
if [[ -f "${legacy}" ]]; then
  rm -f "${legacy}"
fi

sed "s|@SISPACE_EXEC@|${EXEC}|g" "${DESKTOP_IN}" >"${DESKTOP_OUT}"
chmod 644 "${DESKTOP_OUT}"

# hicolor index helps some launchers (e.g. Quickshell) discover user icons.
if [[ ! -f "${ICONS_DIR}/index.theme" ]]; then
  cat >"${ICONS_DIR}/index.theme" <<'EOF'
[Icon Theme]
Name=Hicolor
Comment=Default icon theme fallback
Directories=scalable/apps,16x16/apps,32x32/apps,48x48/apps,64x64/apps,128x128/apps,256x256/apps

[scalable/apps]
Size=256
Type=Scalable
MinSize=16
MaxSize=512

[16x16/apps]
Size=16
Type=Fixed

[32x32/apps]
Size=32
Type=Fixed

[48x48/apps]
Size=48
Type=Fixed

[64x64/apps]
Size=64
Type=Fixed

[128x128/apps]
Size=128
Type=Fixed

[256x256/apps]
Size=256
Type=Fixed
EOF
fi

install_icon_tree() {
  local theme_root="$1"
  mkdir -p "${theme_root}/scalable/apps"
  cp -f "${ICON_SRC}" "${theme_root}/scalable/apps/${LAUNCHER_ICON}.svg"
  cp -f "${ICON_SRC}" "${theme_root}/scalable/apps/${ICON_NAME}.svg"

  if command -v rsvg-convert >/dev/null 2>&1; then
    for size in 16 22 24 32 48 64 128 256; do
      local dir="${theme_root}/${size}x${size}/apps"
      mkdir -p "${dir}"
      rsvg-convert -w "${size}" -h "${size}" "${ICON_SRC}" \
        -o "${dir}/${LAUNCHER_ICON}.png"
      cp -f "${dir}/${LAUNCHER_ICON}.png" "${dir}/${ICON_NAME}.png"
    done
  elif command -v convert >/dev/null 2>&1; then
    for size in 16 22 24 32 48 64 128 256; do
      local dir="${theme_root}/${size}x${size}/apps"
      mkdir -p "${dir}"
      convert -background none -resize "${size}x${size}" "${ICON_SRC}" \
        "${dir}/${LAUNCHER_ICON}.png"
      cp -f "${dir}/${LAUNCHER_ICON}.png" "${dir}/${ICON_NAME}.png"
    done
  fi
}

# hicolor fallback (GTK / generic XDG)
install_icon_tree "${ICONS_DIR}"

# Qt/Quickshell uses the desktop icon theme (KDE: breeze-plus-dark), not hicolor alone.
ICON_THEMES=()
if command -v kreadconfig6 >/dev/null 2>&1; then
  kde_theme="$(kreadconfig6 --file kdeglobals --group Icons --key Theme 2>/dev/null || true)"
  [[ -n "${kde_theme}" ]] && ICON_THEMES+=("${kde_theme}")
fi
if command -v gsettings >/dev/null 2>&1; then
  gnome_theme="$(gsettings get org.gnome.desktop.interface icon-theme 2>/dev/null | tr -d "'")"
  [[ -n "${gnome_theme}" ]] && ICON_THEMES+=("${gnome_theme}")
fi
ICON_THEMES+=("breeze-plus-dark" "breeze-dark" "Papirus-Dark")

for theme in "${ICON_THEMES[@]}"; do
  [[ -z "${theme}" ]] && continue
  install_icon_tree "${DATA_HOME}/icons/${theme}"
done

# Legacy pixmap path some launchers still check
mkdir -p "${DATA_HOME}/pixmaps"
if [[ -f "${ICONS_DIR}/48x48/apps/${LAUNCHER_ICON}.png" ]]; then
  cp -f "${ICONS_DIR}/48x48/apps/${LAUNCHER_ICON}.png" "${DATA_HOME}/pixmaps/${LAUNCHER_ICON}.png"
else
  echo "sispace install-desktop: install rsvg-convert or ImageMagick for PNG icons" >&2
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APPS_DIR}" 2>/dev/null || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "${ICONS_DIR}" 2>/dev/null || true
fi

echo "sispace install-desktop: ${DESKTOP_OUT} -> ${EXEC}"

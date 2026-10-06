#!/bin/bash
# Post-install maintainer script. Derived from electron-builder 26.15.3's
# templates/linux/after-install.tpl (the pinned packaging dependency), with
# scheme registration added for the manifest user scheme.
#
# IMPORTANT: electron-builder reads this file and expands every dollar-brace
# name whose name is letters-only as its own macro (FpmTarget.writeConfigFile),
# and throws "Macro NAME is not defined" for unknown ones. Shell variables in
# this file therefore use the unbraced form ("$EXECUTABLE"), never the braced
# form. The at-placeholders below are substituted by scripts/package.mjs; the
# substituted copy is the reviewed artifact. package.test.mjs fails if
# letter-only brace syntax reappears.
set -u

EXECUTABLE="@EXECUTABLE@"
INSTALL_DIR="/opt/@SANITIZED_PRODUCT@"
DESKTOP_ENTRY="$EXECUTABLE.desktop"
SCHEME_HANDLER="x-scheme-handler/@USER_SCHEME@"
SYSTEM_MIMEAPPS="/etc/xdg/mimeapps.list"

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L "/usr/bin/$EXECUTABLE" ] && [ -e "/usr/bin/$EXECUTABLE" ] && [ "$(readlink "/usr/bin/$EXECUTABLE")" != "/etc/alternatives/$EXECUTABLE" ]; then
        rm -f "/usr/bin/$EXECUTABLE"
    fi
    update-alternatives --install "/usr/bin/$EXECUTABLE" "$EXECUTABLE" "$INSTALL_DIR/$EXECUTABLE" 100 || ln -sf "$INSTALL_DIR/$EXECUTABLE" "/usr/bin/$EXECUTABLE"
else
    ln -sf "$INSTALL_DIR/$EXECUTABLE" "/usr/bin/$EXECUTABLE"
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [ -L /proc/self/ns/user ] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 "$INSTALL_DIR/chrome-sandbox" || true
else
    chmod 0755 "$INSTALL_DIR/chrome-sandbox" || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Register the manifest user scheme as a handler. update-desktop-database only
# lists the desktop entry; xdg-open needs a default handler. apt runs this
# script as root, so register the desktop user when sudo started the install
# and always write the system-wide default under /etc/xdg for every user.
if hash xdg-mime 2>/dev/null; then
    # ${SUDO_USER:-} is safe from the macro expansion: the name contains "_".
    if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER:-}" != "root" ] && hash su 2>/dev/null; then
        su -s /bin/sh "$SUDO_USER" -c "xdg-mime default '$DESKTOP_ENTRY' '$SCHEME_HANDLER'" >/dev/null 2>&1 || true
    fi
    mkdir -p /etc/xdg
    tmp="$(mktemp)"
    if [ -f "$SYSTEM_MIMEAPPS" ]; then cp "$SYSTEM_MIMEAPPS" "$tmp"; else printf '[Default Applications]\n' > "$tmp"; fi
    grep -q '^\[Default Applications\]' "$tmp" || printf '\n[Default Applications]\n' >> "$tmp"
    grep -v "^$SCHEME_HANDLER=" "$tmp" > "$tmp.filtered" || true
    mv "$tmp.filtered" "$tmp"
    printf '%s=%s\n' "$SCHEME_HANDLER" "$DESKTOP_ENTRY" >> "$tmp"
    install -m 0644 "$tmp" "$SYSTEM_MIMEAPPS"
    rm -f "$tmp"
fi

# Install the apparmor profile. (Ubuntu 24+)
# First check if the version of AppArmor running on the device supports our profile.
# This is in order to keep backwards compatibility with Ubuntu 22.04 which does not support abi/4.0.
# In that case, we just skip installing the profile since the app runs fine without it on 22.04.
#
# Those apparmor_parser flags are akin to performing a dry run of loading a profile.
# https://wiki.debian.org/AppArmor/HowToUse
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE="$INSTALL_DIR/resources/apparmor-profile"
  APPARMOR_PROFILE_TARGET="/etc/apparmor.d/$EXECUTABLE"
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Updating the current AppArmor profile is not possible and probably not meaningful in a chroot'ed environment.
    # Use cases are for example environments where images for clients are maintained.
    # There, AppArmor might correctly be installed but live updating makes no sense.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      # Extra flags taken from dh_apparmor:
      # > By using '-W -T' we ensure that any abstraction updates are also pulled in.
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi

exit 0

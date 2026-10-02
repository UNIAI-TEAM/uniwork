#!/bin/bash
# Removal maintainer script. Derived from electron-builder 26.15.3's
# templates/linux/after-remove.tpl (the pinned packaging dependency) plus the
# cleanup of the system-wide scheme mapping after-install.sh adds. Same macro
# caveat as after-install.sh: electron-builder expands letter-only brace
# syntax as its own macro, so shell variables stay in the unbraced form.
# The at-placeholders are substituted by scripts/package.mjs.
set -u

EXECUTABLE="@EXECUTABLE@"
INSTALL_DIR="/opt/@SANITIZED_PRODUCT@"
SCHEME_HANDLER="x-scheme-handler/@USER_SCHEME@"
SYSTEM_MIMEAPPS="/etc/xdg/mimeapps.list"

# Delete the link to the binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove "$EXECUTABLE" "$INSTALL_DIR/$EXECUTABLE"
else
    rm -f "/usr/bin/$EXECUTABLE"
fi

APPARMOR_PROFILE_DEST="/etc/apparmor.d/$EXECUTABLE"

# Remove and unload the apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi

# Strip the scheme mapping after-install.sh wrote, so a removed package leaves
# no system-wide default pointing at a deleted desktop entry.
if [ -f "$SYSTEM_MIMEAPPS" ]; then
  grep -v "^$SCHEME_HANDLER=" "$SYSTEM_MIMEAPPS" > "$SYSTEM_MIMEAPPS.uniwork-remove" || true
  mv "$SYSTEM_MIMEAPPS.uniwork-remove" "$SYSTEM_MIMEAPPS"
fi

if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi

exit 0

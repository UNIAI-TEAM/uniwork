/**
 * DESIGN-ONLY PLACEHOLDER (UNI-2098 Step 1, r3): apt command text pending UNI-2097
 * wording. The real commands live in packages/core/office/apt-repo.ts, owned by the
 * apt lane; this one module only keeps the contract's text so the placeholder
 * screens read true. Step 2 deletes it.
 */
export const APT_BASE = "https://uniworkos.com/downloads/office/apt";
export const INSTALL_SCRIPT_URL = "https://uniworkos.com/downloads/office/install.sh";
export const APT_KEY_URL = `${APT_BASE}/key.gpg`;
export const APT_KEY_ASC_URL = `${APT_BASE}/key.asc`;
export const APT_KEYRING = "/usr/share/keyrings/uniwork-office-archive-keyring.gpg";
export const APT_SOURCE_FILE = "/etc/apt/sources.list.d/uniwork-office.sources";
export const APT_PACKAGE = "uniwork-office";

export interface AptCommands { script: string; deb: string; key: string; source: string; install: string; manual: string }

export function aptCommands(suite: string): AptCommands {
  // Two equal ways in (r3, user answer): the install script (placeholder text, names no channel yet: open question 1) and the channel's latest .deb.
  const script = `curl -fsSL ${INSTALL_SCRIPT_URL} | sudo sh`;
  const deb = `wget -qO /tmp/uniwork-office.deb ${APT_BASE}/latest/${suite}/uniwork-office_amd64.deb && sudo apt install /tmp/uniwork-office.deb`;
  const key = `curl -fsSL ${APT_KEY_URL} | sudo tee ${APT_KEYRING} > /dev/null`;
  const source = [
    `sudo tee ${APT_SOURCE_FILE} > /dev/null <<'EOF'`,
    "Types: deb",
    `URIs: ${APT_BASE}`,
    `Suites: ${suite}`,
    "Components: main",
    "Architectures: amd64",
    `Signed-By: ${APT_KEYRING}`,
    "EOF",
  ].join("\n");
  const install = `sudo apt update && sudo apt install ${APT_PACKAGE}`;
  return { script, deb, key, source, install, manual: [key, source, install].join("\n\n") };
}

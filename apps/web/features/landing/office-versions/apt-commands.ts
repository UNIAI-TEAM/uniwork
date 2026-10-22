/**
 * DESIGN-ONLY PLACEHOLDER (UNI-2098 Step 1): apt command text pending UNI-2097
 * wording. The real commands live in packages/core/office/apt-repo.ts
 * (aptInstallCommands, aptSourcesText), owned by the apt lane; this one module
 * only keeps the contract's commands so the placeholder screens read true.
 * Step 2 deletes it.
 */
export const APT_BASE = "https://uniworkos.com/downloads/office/apt";
export const APT_KEY_URL = `${APT_BASE}/key.gpg`;
export const APT_KEY_ASC_URL = `${APT_BASE}/key.asc`;
export const APT_KEYRING = "/usr/share/keyrings/uniwork-office-archive-keyring.gpg";
export const APT_SOURCE_FILE = "/etc/apt/sources.list.d/uniwork-office.sources";
export const APT_PACKAGE = "uniwork-office";
export const APT_UPGRADE = "sudo apt update && sudo apt upgrade";

export interface AptCommands { key: string; source: string; install: string; all: string }

export function aptCommands(suite: string): AptCommands {
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
  return { key, source, install, all: [key, source, install].join("\n\n") };
}

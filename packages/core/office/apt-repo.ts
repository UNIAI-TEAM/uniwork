import type { OfficeChannel } from "./desktop-handoff";

/** The apt repository of UniWork Office, served under the downloads origin (UNI-2097). */
export const APT_REPO_URL = "https://uniworkos.com/downloads/office/apt";
export const APT_KEY_URL = `${APT_REPO_URL}/key.gpg`;
export const APT_KEYRING_PATH = "/usr/share/keyrings/uniwork-office-archive-keyring.gpg";
export const APT_SOURCES_PATH = "/etc/apt/sources.list.d/uniwork-office.sources";
export const APT_KEY_FINGERPRINT = "58A9 0232 2C8D 45C4 33B5 25F5 1198 D109 26F3 4831";
export const APT_INSTALL_COMMAND = "sudo apt update && sudo apt install uniwork-office";

/** The apt suite of a channel carries the channel's name. */
export type AptSuite = OfficeChannel;

/** The deb822 source file for one suite, one field per line. */
export function aptSourcesText(suite: AptSuite): string {
  return [
    "Types: deb",
    `URIs: ${APT_REPO_URL}`,
    `Suites: ${suite}`,
    "Components: main",
    "Architectures: amd64",
    `Signed-By: ${APT_KEYRING_PATH}`,
  ].join("\n");
}

/**
 * Every shell line that adds the repository and installs the app, in order:
 * save the key, write the source, then the final line updates and installs.
 */
export function aptInstallCommands(suite: AptSuite): string[] {
  return [
    `curl -fsSL ${APT_KEY_URL} | sudo tee ${APT_KEYRING_PATH} > /dev/null`,
    `sudo tee ${APT_SOURCES_PATH} > /dev/null <<'EOF'`,
    ...aptSourcesText(suite).split("\n"),
    "EOF",
    APT_INSTALL_COMMAND,
  ];
}

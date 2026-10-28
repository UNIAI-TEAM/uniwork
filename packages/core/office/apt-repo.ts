import type { OfficeChannel } from "./desktop-handoff";

/** The apt repository of UniWork Office, served under the downloads origin (UNI-2097). */
export const APT_REPO_URL = "https://uniworkos.com/downloads/office/apt";
export const APT_KEY_URL = `${APT_REPO_URL}/key.gpg`;
export const APT_KEYRING_PATH = "/usr/share/keyrings/uniwork-office-archive-keyring.gpg";
export const APT_SOURCES_PATH = "/etc/apt/sources.list.d/uniwork-office.sources";
export const APT_KEY_FINGERPRINT = "58A9 0232 2C8D 45C4 33B5 25F5 1198 D109 26F3 4831";
export const APT_INSTALL_SCRIPT_URL = "https://uniworkos.com/downloads/office/install.sh";
export const APT_INSTALL_COMMAND = "sudo apt update && sudo apt install uniwork-office";

/** The apt suite of a channel carries the channel's name. */
export type AptSuite = OfficeChannel;

/**
 * The deb822 source file for one suite, one field per line, without the final
 * newline (the heredoc adds it). The first line is the marker the Office deb's
 * postinst / postrm look for: with it the package updates the file on a suite
 * change and removes it on purge; without it they leave the file alone.
 */
export function aptSourcesText(suite: AptSuite): string {
  return [
    "# managed by uniwork-office",
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
 * The source write is chained behind the key download (`&&`), and curl creates
 * no file when it fails, so a 404 or a missing curl leaves the machine unchanged.
 */
export function aptInstallCommands(suite: AptSuite): string[] {
  return [
    `sudo curl -fsSL -o ${APT_KEYRING_PATH} ${APT_KEY_URL} &&`,
    `sudo tee ${APT_SOURCES_PATH} > /dev/null <<'EOF'`,
    ...aptSourcesText(suite).split("\n"),
    "EOF",
    APT_INSTALL_COMMAND,
  ];
}

/**
 * The newest .deb of one suite, at a fixed address (the repository keeps it current).
 * Stable has the short address; dev and beta keep their suite in the path.
 */
export function aptLatestDebUrl(suite: AptSuite): string {
  return suite === "stable"
    ? `${APT_REPO_URL}/latest/uniwork-office_amd64.deb`
    : `${APT_REPO_URL}/latest/${suite}/uniwork-office_amd64.deb`;
}

/**
 * The one-line install: download the newest .deb and let apt install it. The
 * deb's postinst adds the keyring and the source, so later versions arrive
 * through `apt upgrade`. `&&` keeps apt from running on a failed download, and
 * `-nv` (not `-q`) still prints wget's error line when the download is a 404.
 */
export function aptQuickInstallCommand(suite: AptSuite): string {
  return `wget -nv -O /tmp/uniwork-office.deb ${aptLatestDebUrl(suite)} && sudo apt install /tmp/uniwork-office.deb`;
}

/**
 * The install-script line: the script adds the same key and source the .deb does,
 * then installs. It defaults to stable, so only dev and beta name their suite
 * after `sh -s --`.
 */
export function aptScriptInstallCommand(suite: AptSuite): string {
  const run = `curl -fsSL ${APT_INSTALL_SCRIPT_URL} | sudo sh`;
  return suite === "stable" ? run : `${run} -s -- ${suite}`;
}

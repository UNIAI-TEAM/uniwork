import { describe, expect, it } from "vitest";
import { APT_INSTALL_COMMAND, APT_KEY_FINGERPRINT, APT_KEY_URL, APT_KEYRING_PATH, APT_REPO_URL, aptInstallCommands, aptSourcesText } from "./apt-repo";

describe("apt repository commands", () => {
  it("keeps the repository, key and keyring where the published repository puts them", () => {
    expect(APT_REPO_URL).toBe("https://uniworkos.com/downloads/office/apt");
    expect(APT_KEY_URL).toBe("https://uniworkos.com/downloads/office/apt/key.gpg");
    expect(APT_KEYRING_PATH).toBe("/usr/share/keyrings/uniwork-office-archive-keyring.gpg");
    expect(APT_KEY_FINGERPRINT).toMatch(/^([0-9A-F]{4} ){9}[0-9A-F]{4}$/);
  });

  it.each(["dev", "beta", "stable"] as const)("writes a deb822 source for the %s suite", (suite) => {
    expect(aptSourcesText(suite)).toBe([
      "Types: deb",
      "URIs: https://uniworkos.com/downloads/office/apt",
      `Suites: ${suite}`,
      "Components: main",
      "Architectures: amd64",
      "Signed-By: /usr/share/keyrings/uniwork-office-archive-keyring.gpg",
    ].join("\n"));
  });

  it("lists the key, the source heredoc and the install line in order", () => {
    const lines = aptInstallCommands("beta");
    expect(lines[0]).toBe("curl -fsSL https://uniworkos.com/downloads/office/apt/key.gpg | sudo tee /usr/share/keyrings/uniwork-office-archive-keyring.gpg > /dev/null");
    expect(lines[1]).toBe("sudo tee /etc/apt/sources.list.d/uniwork-office.sources > /dev/null <<'EOF'");
    expect(lines.slice(2, -2)).toEqual(aptSourcesText("beta").split("\n"));
    expect(lines.at(-2)).toBe("EOF");
    expect(lines.at(-1)).toBe(APT_INSTALL_COMMAND);
    expect(APT_INSTALL_COMMAND).toBe("sudo apt update && sudo apt install uniwork-office");
  });
});

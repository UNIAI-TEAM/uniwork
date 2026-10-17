// The packaging contract (UNI-1835): the files electron-builder names from
// electron-builder.ts are the ones the download server maps to its platform
// keys, the mac signing mode follows the certificate, and a release tag gives
// the version and channel the workflow builds.
import { describe, expect, test } from "vitest";
import { INSTALLER_PLATFORMS, installerPlatformOf } from "../../../scripts/office/installer-urls.mjs";
import { builderConfig, UPDATE_FEED_URL } from "../electron-builder";
import { absoluteFeed, releaseFromTag } from "./release.mjs";

const VERSION = "0.1.0-dev.3";
const EXT = { nsis: "exe" };

/** Every file name the config produces, expanded the way electron-builder does
 * for the macros these patterns use. */
function artifactNames(config) {
  return ["mac", "win", "linux"].flatMap((platform) => {
    const { artifactName, target } = config[platform];
    return target.flatMap(({ target: kind, arch }) =>
      arch.map((a) => artifactName.replace("${version}", VERSION).replace("${arch}", a).replace("${ext}", EXT[kind] ?? kind)),
    );
  });
}

function platformMap(names, channel = "dev") {
  return Object.fromEntries(names.flatMap((name) => {
    const platform = installerPlatformOf(name, channel, "unichat");
    return platform ? [[platform, name]] : [];
  }));
}

describe("installer names", () => {
  test("unsigned builds cover every platform key but the Windows zip, all labelled", () => {
    const names = artifactNames(builderConfig({}));
    expect(platformMap(names)).toEqual({
      "darwin-arm64": "unichat_0.1.0-dev.3_unsigned_darwin_arm64.dmg",
      "darwin-x64": "unichat_0.1.0-dev.3_unsigned_darwin_x64.dmg",
      "win32-x64": "unichat_0.1.0-dev.3_unsigned_win32_x64-setup.exe",
      "linux-x64-appimage": "unichat_0.1.0-dev.3_unsigned_linux_x64.AppImage",
      "linux-x64-deb": "unichat_0.1.0-dev.3_unsigned_linux_x64.deb",
    });
    expect(INSTALLER_PLATFORMS.filter((key) => !(key in platformMap(names)))).toEqual(["win32-x64-zip"]);
    // The mac zips are the update payload, not downloads.
    expect(names.filter((name) => name.endsWith(".zip"))).toEqual([
      "unichat_0.1.0-dev.3_unsigned_darwin_arm64.zip",
      "unichat_0.1.0-dev.3_unsigned_darwin_x64.zip",
    ]);
    expect(names.filter((name) => name.endsWith(".zip")).map((name) => installerPlatformOf(name, "dev", "unichat"))).toEqual([undefined, undefined]);
  });

  test("a certificate drops the label for its platform only; Linux keeps it", () => {
    const names = artifactNames(builderConfig({ CSC_LINK: "mac.p12", WIN_CSC_LINK: "win.pfx" }));
    expect(Object.keys(platformMap(names)).sort()).toEqual(["darwin-arm64", "darwin-x64", "linux-x64-appimage", "linux-x64-deb", "win32-x64"]);
    expect(names.filter((name) => name.includes("_unsigned_"))).toEqual([
      "unichat_0.1.0-dev.3_unsigned_linux_x64.AppImage",
      "unichat_0.1.0-dev.3_unsigned_linux_x64.deb",
    ]);
    expect(artifactNames(builderConfig({ WIN_CSC_LINK: "win.pfx" })).filter((name) => name.includes("_unsigned_darwin_"))).toHaveLength(4);
  });
});

describe("mac signing", () => {
  test("without a certificate the app is signed ad hoc, without hardened runtime or notarization", () => {
    const { mac } = builderConfig({});
    expect(mac).toMatchObject({ identity: "-", hardenedRuntime: false, notarize: false });
    expect(mac.entitlements).toBeUndefined();
  });

  test("with a certificate it gets hardened runtime and the entitlements, and notarization is left to the Apple env", () => {
    const { mac } = builderConfig({ CSC_LINK: "mac.p12" });
    expect(mac).toMatchObject({ hardenedRuntime: true, entitlements: "build/entitlements.mac.plist", entitlementsInherit: "build/entitlements.mac.plist" });
    expect(mac.identity).toBeUndefined();
    expect(mac.notarize).toBeUndefined();
  });
});

test("identity, feed and protocol", () => {
  const config = builderConfig({});
  expect(config).toMatchObject({
    appId: "com.uniworkos.chat",
    productName: "UniChat",
    directories: { output: "dist/package" },
    publish: { provider: "generic", url: UPDATE_FEED_URL },
    protocols: [{ name: "UniChat", schemes: ["uniworkchat"] }],
  });
  // No channel here: electron-builder takes it from the version (dev.yml, beta.yml, latest.yml).
  expect(config.publish).not.toHaveProperty("channel");
  expect(UPDATE_FEED_URL).toBe("https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-feed");
});

describe("releaseFromTag", () => {
  test.each([
    ["chat-desktop-v0.1.0-dev.1", { version: "0.1.0-dev.1", channel: "dev" }],
    ["chat-desktop-v0.2.0-beta.12", { version: "0.2.0-beta.12", channel: "beta" }],
    ["chat-desktop-v1.2.3", { version: "1.2.3", channel: "stable" }],
  ])("%s", (tag, release) => expect(releaseFromTag(tag)).toEqual(release));

  test.each(["v1.2.3-dev.1", "chat-desktop-v1.2", "chat-desktop-v1.2.3-rc.1", "chat-desktop-v01.2.3", "chat-desktop-v1.2.3-dev", "office-desktop-v0.1.0-beta.1", "chat-desktop-v1.2.3-dev.1 "])(
    "refuses %j",
    (tag) => expect(() => releaseFromTag(tag)).toThrow(/tag must be/),
  );
});

describe("absoluteFeed", () => {
  const BASE = "https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-v0.1.0-dev.3";
  const MAC = [
    "version: 0.1.0-dev.3",
    "files:",
    "  - url: unichat_0.1.0-dev.3_unsigned_darwin_arm64.zip",
    "    sha512: abc==",
    "    size: 1",
    "  - url: unichat_0.1.0-dev.3_unsigned_darwin_x64.zip",
    "    sha512: def==",
    "    size: 2",
    "path: unichat_0.1.0-dev.3_unsigned_darwin_arm64.zip",
    "sha512: abc==",
    "releaseDate: '2026-10-17T00:00:00.000Z'",
    "",
  ].join("\n");

  test("points every file entry at the versioned release and leaves the rest", () => {
    expect(absoluteFeed(MAC, `${BASE}/`)).toBe(MAC
      .replace("- url: unichat_0.1.0-dev.3_unsigned_darwin_arm64.zip", `- url: ${BASE}/unichat_0.1.0-dev.3_unsigned_darwin_arm64.zip`)
      .replace("- url: unichat_0.1.0-dev.3_unsigned_darwin_x64.zip", `- url: ${BASE}/unichat_0.1.0-dev.3_unsigned_darwin_x64.zip`)
      .replace("path: unichat", `path: ${BASE}/unichat`));
  });

  test("refuses a file it would have to encode and a base that is not plain https", () => {
    expect(() => absoluteFeed("path: ../x.exe\n", BASE)).toThrow(/unexpected file name/);
    expect(() => absoluteFeed("  - url: 'quoted.exe'\n", BASE)).toThrow(/unexpected file name/);
    for (const base of ["http://downloads.test/a", "https://downloads.test/a?x=1", "https://downloads.test/a#f"]) {
      expect(() => absoluteFeed(MAC, base)).toThrow(/https without query/);
    }
  });
});

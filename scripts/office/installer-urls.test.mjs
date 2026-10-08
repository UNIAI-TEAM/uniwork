// Tests for scripts/office/installer-urls.mjs (O04, UNI-944): the map the
// installer workflow emits must be exactly what the server's
// OFFICE_INSTALLER_<CHANNEL>_URLS parser accepts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INSTALLER_PLATFORMS, buildInstallerUrls, installerPlatformOf, parseInstallerUrlArguments } from "./installer-urls.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = "https://github.com/unicomhub/uniwork/releases/download/office-desktop-v0.1.0-dev.7";
const DEV_FILES = [
  "uniwork-office-test_0.1.0-dev.7_unsigned_win32_x64-setup.exe",
  "uniwork-office-test_0.1.0-dev.7_unsigned_win32_x64.zip",
  "uniwork-office-test_0.1.0-dev.7_unsigned_linux_x64.deb",
  "uniwork-office-test_0.1.0-dev.7_unsigned_linux_x64.AppImage",
  "SHA256SUMS-win32-x64.txt",
  "SHA256SUMS-linux-x64.txt",
];

test("maps every package.mjs artifact to the platform key the server expects", () => {
  const urls = buildInstallerUrls({ channel: "dev", baseUrl: BASE, files: DEV_FILES });
  assert.deepEqual(urls, {
    "win32-x64": `${BASE}/uniwork-office-test_0.1.0-dev.7_unsigned_win32_x64-setup.exe`,
    "win32-x64-zip": `${BASE}/uniwork-office-test_0.1.0-dev.7_unsigned_win32_x64.zip`,
    "linux-x64-deb": `${BASE}/uniwork-office-test_0.1.0-dev.7_unsigned_linux_x64.deb`,
    "linux-x64-appimage": `${BASE}/uniwork-office-test_0.1.0-dev.7_unsigned_linux_x64.AppImage`,
  });
  assert.deepEqual(Object.keys(urls), INSTALLER_PLATFORMS.filter((platform) => platform in urls), "contract order");
});

test("the platform key set equals the one the Go config declares", () => {
  const go = readFileSync(resolve(here, "../../server/internal/config/office_installers.go"), "utf8");
  const declared = /OfficeInstallerPlatforms = \[\]string\{([^}]*)\}/.exec(go)?.[1].match(/"([^"]+)"/g)?.map((quoted) => quoted.slice(1, -1));
  assert.deepEqual(INSTALLER_PLATFORMS, declared);
});

test("a beta build only picks beta files, a dev file never fills beta", () => {
  const beta = ["uniwork-office_0.1.0-beta.3_unsigned_win32_x64-setup.exe", "uniwork-office_0.1.0-beta.3_unsigned_linux_x64.deb"];
  assert.deepEqual(Object.keys(buildInstallerUrls({ channel: "beta", baseUrl: BASE, files: [...beta, ...DEV_FILES] })), ["win32-x64", "linux-x64-deb"]);
  assert.throws(() => buildInstallerUrls({ channel: "beta", baseUrl: BASE, files: DEV_FILES }), /no unsigned beta installer/);
});

test("macOS keys are supported when a Mac-built asset exists", () => {
  assert.equal(installerPlatformOf("uniwork-office_0.1.0-beta.1_unsigned_darwin_arm64.dmg", "beta"), "darwin-arm64");
  assert.equal(installerPlatformOf("uniwork-office_0.1.0-beta.1_unsigned_darwin_x64.dmg", "beta"), "darwin-x64");
});

test("stable is refused: no signed release exists", () => {
  assert.throws(() => buildInstallerUrls({ channel: "stable", baseUrl: BASE, files: DEV_FILES }), /dev or beta/);
  assert.throws(() => installerPlatformOf(DEV_FILES[0], "stable"), /dev or beta/);
});

test("signed-looking or unsafe names are ignored", () => {
  assert.equal(installerPlatformOf("uniwork-office-test_0.1.0-dev.7_win32_x64-setup.exe", "dev"), undefined, "no unsigned label");
  assert.equal(installerPlatformOf("uniwork-office-test_0.1.0-dev.7_unsigned_win32_x64-setup.exe.sha256", "dev"), undefined);
  assert.equal(installerPlatformOf("my office_0.1.0-dev.7_unsigned_win32_x64-setup.exe", "dev"), undefined, "space");
  assert.equal(installerPlatformOf("a%20b_0.1.0-dev.7_unsigned_linux_x64.deb", "dev"), undefined, "percent");
});

test("two installers for one platform is ambiguous", () => {
  assert.throws(() => buildInstallerUrls({ channel: "dev", baseUrl: BASE, files: [DEV_FILES[0], DEV_FILES[0].replace("dev.7", "dev.8")] }), /two dev installers for win32-x64/);
});

test("the base URL must be https without credentials, query or fragment", () => {
  for (const baseUrl of ["http://downloads.test/a", "https://user:pw@downloads.test/a", "https://downloads.test/a?x=1", "https://downloads.test/a#f", "downloads.test/a"]) {
    assert.throws(() => buildInstallerUrls({ channel: "dev", baseUrl, files: DEV_FILES }), /base URL/, baseUrl);
  }
  assert.equal(buildInstallerUrls({ channel: "dev", baseUrl: `${BASE}/`, files: [DEV_FILES[2]] })["linux-x64-deb"], `${BASE}/${DEV_FILES[2]}`);
});

test("http is accepted only on a loopback host and only for dev, as the server does", () => {
  const BETA_FILE = DEV_FILES[2].replace("dev.7", "beta.7");
  for (const host of ["localhost:9000", "127.0.0.1:9000", "[::1]:9000"]) {
    const baseUrl = `http://${host}/office-installers/dev/0.1.0-dev.7`;
    assert.equal(buildInstallerUrls({ channel: "dev", baseUrl, files: [DEV_FILES[2]] })["linux-x64-deb"], `${baseUrl}/${DEV_FILES[2]}`, host);
    assert.throws(() => buildInstallerUrls({ channel: "beta", baseUrl, files: [BETA_FILE] }), /base URL/, `beta on ${host}`);
  }
  for (const baseUrl of ["http://downloads.test/a", "http://192.168.1.10:9000/a", "http://localhost.example.test/a", "http://user:pw@localhost:9000/a", "ftp://localhost/a"]) {
    assert.throws(() => buildInstallerUrls({ channel: "dev", baseUrl, files: DEV_FILES }), /base URL/, baseUrl);
  }
});

test("argument parsing rejects unknown and incomplete input", () => {
  assert.deepEqual(parseInstallerUrlArguments(["--channel", "dev", "--base-url", BASE, "--files", "a,b"]), { channel: "dev", baseUrl: BASE, files: "a,b" });
  assert.throws(() => parseInstallerUrlArguments(["--channel", "dev"]), /usage/);
  assert.throws(() => parseInstallerUrlArguments(["--bogus", "x"]), /unknown argument/);
  assert.throws(() => parseInstallerUrlArguments(["--channel"]), /needs a value/);
});

test("the CLI prints the compact JSON for a directory and exits non-zero on bad input", () => {
  const directory = mkdtempSync(join(tmpdir(), "installer-urls-"));
  for (const file of DEV_FILES) writeFileSync(join(directory, file), "x");
  const script = join(here, "installer-urls.mjs");
  const out = execFileSync(process.execPath, [script, "--channel", "dev", "--base-url", BASE, "--dir", directory], { encoding: "utf8" });
  assert.equal(out.trim().split("\n").length, 1);
  assert.deepEqual(Object.keys(JSON.parse(out)), ["win32-x64", "win32-x64-zip", "linux-x64-deb", "linux-x64-appimage"]);
  assert.throws(() => execFileSync(process.execPath, [script, "--channel", "stable", "--base-url", BASE, "--dir", directory], { stdio: "pipe" }), /installer-urls: installer channel must be dev or beta|Command failed/);
});

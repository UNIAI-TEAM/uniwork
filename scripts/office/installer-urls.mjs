#!/usr/bin/env node
// O04 (UNI-944) - build the OFFICE_INSTALLER_<CHANNEL>_URLS value from the files
// the desktop installer workflow uploaded.
//
//   node scripts/office/installer-urls.mjs --channel dev \
//     --base-url https://github.com/<owner>/<repo>/releases/download/<tag> \
//     --dir <artifacts directory>          # or --files a.deb,b.exe
//
// Prints the compact JSON map the server parses (server/internal/config/
// office_installers.go): {"win32-x64":"https://...","linux-x64-deb":"..."}.
// Only dev and beta exist - stable stays empty while signing is parked - and
// every file must carry the `unsigned` label and the channel's own version
// (`-dev.N` / `-beta.N`), so a dev asset can never fill the beta variable.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Same keys, same order as config.OfficeInstallerPlatforms (Go) and core's registry. */
export const INSTALLER_PLATFORMS = ["win32-x64", "win32-x64-zip", "darwin-arm64", "darwin-x64", "linux-x64-deb", "linux-x64-appimage"];
export const INSTALLER_CHANNELS = ["dev", "beta"];

// The suffix package.mjs's artifact names end with, per platform key.
const PLATFORM_SUFFIX = {
  "win32-x64": "_win32_x64-setup.exe",
  "win32-x64-zip": "_win32_x64.zip",
  "darwin-arm64": "_darwin_arm64.dmg",
  "darwin-x64": "_darwin_x64.dmg",
  "linux-x64-deb": "_linux_x64.deb",
  "linux-x64-appimage": "_linux_x64.AppImage",
};
// The characters the server's filename check accepts for the URL basename and
// that a release host serves verbatim; anything else would need encoding.
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The platform key a release file belongs to, or undefined for anything else
 * (checksum files, evidence, other channels' assets). */
export function installerPlatformOf(fileName, channel) {
  if (!INSTALLER_CHANNELS.includes(channel)) throw new Error(`installer channel must be dev or beta, got: ${channel}`);
  if (!SAFE_FILE_NAME.test(fileName) || !fileName.includes("_unsigned_") || !fileName.includes(`-${channel}.`)) return undefined;
  return INSTALLER_PLATFORMS.find((platform) => fileName.endsWith(PLATFORM_SUFFIX[platform]));
}

/** `{platform: url}` for one channel. Two files for one platform is an error
 * (an ambiguous download), an empty result is an error (nothing was uploaded). */
export function buildInstallerUrls({ channel, baseUrl, files }) {
  if (!INSTALLER_CHANNELS.includes(channel)) throw new Error(`installer channel must be dev or beta, got: ${channel}`);
  let base;
  try { base = new URL(baseUrl); } catch { throw new Error("base URL must be absolute"); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("base URL must be https without credentials, query or fragment");
  const prefix = base.href.replace(/\/+$/, "");
  const urls = {};
  for (const file of files) {
    const platform = installerPlatformOf(file, channel);
    if (!platform) continue;
    if (urls[platform]) throw new Error(`two ${channel} installers for ${platform}: ${urls[platform].split("/").pop()} and ${file}`);
    urls[platform] = `${prefix}/${file}`;
  }
  if (Object.keys(urls).length === 0) throw new Error(`no unsigned ${channel} installer among ${files.length} file(s)`);
  // Keep the contract order so the output is stable between runs.
  return Object.fromEntries(INSTALLER_PLATFORMS.filter((platform) => urls[platform]).map((platform) => [platform, urls[platform]]));
}

export function parseInstallerUrlArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!["--channel", "--base-url", "--dir", "--files"].includes(name)) throw new Error(`unknown argument: ${name}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${name} needs a value`);
    options[name.slice(2).replace("-u", "U")] = value;
    index += 1;
  }
  if (!options.channel || !options.baseUrl || (!options.dir && !options.files)) throw new Error("usage: installer-urls.mjs --channel dev|beta --base-url <https base> (--dir <directory> | --files a,b)");
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseInstallerUrlArguments(process.argv.slice(2));
    const files = options.files ? options.files.split(",").map((file) => file.trim()).filter(Boolean) : readdirSync(resolve(options.dir));
    process.stdout.write(`${JSON.stringify(buildInstallerUrls({ channel: options.channel, baseUrl: options.baseUrl, files }))}\n`);
  } catch (error) {
    process.stderr.write(`installer-urls: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

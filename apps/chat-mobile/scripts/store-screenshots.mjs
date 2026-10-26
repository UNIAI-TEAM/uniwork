#!/usr/bin/env node
// The store's pictures of UniChat (store/listing.md › Ảnh chụp và đồ hoạ): taking the screenshots, and checking
// that every listed language has them, in sizes the stores accept, with Play's 512 px icon beside them.
//
//   node apps/chat-mobile/scripts/store-screenshots.mjs check [--platform android|ios]
//     Fails, naming each gap, when a store's pictures are missing or the wrong size. chat-mobile-promote.yml runs it
//     before a release goes to production, so no store version ships without them.
//
//   node apps/chat-mobile/scripts/store-screenshots.mjs capture --platform android|ios --locale vi|en [--device <id>]
//     On a booted phone-sized emulator (1080 x 1920: Play refuses a side more than twice the other) or simulator
//     (iPhone 16 Pro Max, 1320 x 2868) with the staging build installed and the MAESTRO_* settings of the "UniChat
//     Review" organization exported: sets the app's language and a clean status bar, runs
//     maestro/flows/store-screenshots.yaml, and files the shots where fastlane supply (Play) and the App Store
//     upload read them. The calls tab is shot for Play only while calling is off on iPhone.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE = path.join(APP, "store");
/** The fewest screenshots each language shows (the listing promises three: the list, a conversation, a third). */
export const MIN_SHOTS = 3;
/** The app's languages → each store's locale folder (store/play/<locale>, store.config.json › apple.info). */
export const LOCALES = { vi: { play: "vi-VN", apple: "vi" }, en: { play: "en-US", apple: "en-US" } };
/** iPhone sizes App Store Connect takes for the required 6.9" / 6.5" set, portrait. */
const APPLE_SIZES = ["1320x2868", "1290x2796", "1242x2688", "1284x2778"];

export const playShotsDir = (root, locale) => path.join(root, "play", LOCALES[locale].play, "images", "phoneScreenshots");
export const appleShotsDir = (root, locale) => path.join(root, "apple", "screenshots", LOCALES[locale].apple);
export const playIcon = (root) => path.join(root, "play", "icon-512.png");

/** Width, height and colour type of a PNG from its IHDR, or null for anything that is not a PNG. */
export function pngInfo(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.length < 26 || buffer.subarray(0, 8).toString("hex") !== signature || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer.readUInt8(25) };
}

/** Play: every side 320–3840 px, the longer at most twice the shorter. */
export function playSizeProblem({ width, height }) {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < 320 || long > 3840) return `${width}x${height} is outside 320–3840 px`;
  if (long > 2 * short) return `${width}x${height}: the longer side is more than twice the shorter`;
  return null;
}

/** App Store: one of the iPhone 6.9" / 6.5" portrait sizes. */
export function appleSizeProblem({ width, height }) {
  return APPLE_SIZES.includes(`${width}x${height}`) ? null : `${width}x${height} is not an iPhone 6.9"/6.5" portrait size (${APPLE_SIZES.join(", ")})`;
}

function shotProblems(dir, label, sizeProblem) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort() : [];
  const problems = files.length < MIN_SHOTS ? [`${label}: ${files.length} screenshots, at least ${MIN_SHOTS} needed (${path.relative(APP, dir)})`] : [];
  for (const file of files) {
    const info = pngInfo(fs.readFileSync(path.join(dir, file)));
    const problem = info ? sizeProblem(info) : "not a PNG";
    if (problem) problems.push(`${label}: ${file}: ${problem}`);
  }
  return problems;
}

/** Every gap between the store folders and what the stores take, for the given platforms; empty when ready. */
export function storeAssetProblems(root = STORE, platforms = ["android", "ios"]) {
  const problems = [];
  if (platforms.includes("android")) {
    const icon = fs.existsSync(playIcon(root)) ? pngInfo(fs.readFileSync(playIcon(root))) : null;
    if (!icon) problems.push("Play: icon-512.png is missing (pnpm brand:build)");
    else if (icon.width !== 512 || icon.height !== 512 || icon.colorType !== 6) problems.push("Play: icon-512.png must be a 512 x 512 32-bit PNG");
    for (const locale of Object.keys(LOCALES)) problems.push(...shotProblems(playShotsDir(root, locale), `Play ${LOCALES[locale].play}`, playSizeProblem));
  }
  if (platforms.includes("ios")) {
    for (const locale of Object.keys(LOCALES)) problems.push(...shotProblems(appleShotsDir(root, locale), `App Store ${LOCALES[locale].apple}`, appleSizeProblem));
  }
  return problems;
}

function argument(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

/** The language, the status bar, the flow, then the shots filed for the store. */
function capture(platform, locale, device) {
  const pkg = "com.uniworkos.chat.staging";
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "unichat-shots-"));
  const tag = platform === "android" ? LOCALES[locale].play : LOCALES[locale].apple;
  if (platform === "android") {
    const adb = (...a) => run("adb", [...(device ? ["-s", device] : []), "shell", ...a]);
    adb("cmd", "locale", "set-app-locales", pkg, "--locales", locale);
    adb("settings", "put", "global", "sysui_demo_allowed", "1");
    adb("am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "enter");
    adb("am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "clock", "-e", "hhmm", "0941");
    adb("am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false");
    adb("am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "notifications", "-e", "visible", "false");
  } else {
    const udid = device ?? "booted";
    run("xcrun", ["simctl", "spawn", udid, "defaults", "write", pkg, "AppleLanguages", "-array", locale]);
    run("xcrun", ["simctl", "status_bar", udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--cellularBars", "4"]);
  }
  const env = { ...process.env, MAESTRO_SHOT_DIR: out, MAESTRO_CALLS: platform === "android" ? "1" : "0" };
  run("maestro", [...(device ? ["--device", device] : []), "test", "flows/store-screenshots.yaml"], { cwd: path.join(APP, "maestro"), env });
  const dest = platform === "android" ? playShotsDir(STORE, locale) : appleShotsDir(STORE, locale);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(out).filter((f) => f.endsWith(".png")).sort()) fs.copyFileSync(path.join(out, file), path.join(dest, file));
  console.log(`filed ${fs.readdirSync(dest).length} screenshots for ${tag} in ${path.relative(process.cwd(), dest)}`);
}

function main(args) {
  const platform = argument(args, "--platform");
  if (args[0] === "check") {
    const problems = storeAssetProblems(STORE, platform ? [platform] : ["android", "ios"]);
    for (const problem of problems) console.error(`✗ ${problem}`);
    if (problems.length === 0) console.log("store pictures ready");
    return problems.length === 0 ? 0 : 1;
  }
  const locale = argument(args, "--locale");
  if (args[0] === "capture" && (platform === "android" || platform === "ios") && (locale === "vi" || locale === "en")) {
    capture(platform, locale, argument(args, "--device"));
    return 0;
  }
  console.error("usage: store-screenshots.mjs check [--platform android|ios] | capture --platform android|ios --locale vi|en [--device id]");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));

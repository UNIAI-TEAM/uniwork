#!/usr/bin/env node
// Picks the real phones the weekly device-farm run uses (chat-mobile-device-farm.yml, audit "no-real-device-farm":
// the matrix was emulators only, while Vietnam's phones are mostly Samsung, Xiaomi, Oppo and Vivo, whose battery
// managers and notification shades are where Android apps break). Reads Firebase Test Lab's own catalogue
// (`gcloud firebase test android models list --format=json`) instead of naming model ids that come and go: for each
// maker, in the order below, the physical phone with the newest Android the catalogue runs, plus the phone with the
// oldest Android at or above the app's floor, so a low-end, old-OS device is always in the set. Only phones whose
// catalogue entry lists ABI below: the workflow builds the APKs for that one ABI, and the old, low-end slice of the
// catalogue is where 32-bit-only phones live (an install there fails with INSTALL_FAILED_NO_MATCHING_ABIS).
//
//   gcloud firebase test android models list --format=json > models.json
//   node scripts/mobile-ftl-devices.mjs models.json      one `--device model=…,version=…,locale=vi,orientation=portrait` per line
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** The makers that matter in the market the app ships to first, most phones first. */
export const MAKERS = ["samsung", "xiaomi", "oppo", "vivo", "google"];
/** React Native's minSdk (the matrix's oldest emulator leg). */
export const MIN_API = 24;
export const MAX_DEVICES = 6;
/** The one ABI chat-mobile-device-farm.yml builds (-PreactNativeArchitectures). */
export const ABI = "arm64-v8a";

const versionsOf = (model) =>
  (model.supportedVersionIds ?? [])
    .map(Number)
    .filter((v) => Number.isInteger(v) && v >= MIN_API)
    .sort((a, b) => a - b);

const isPhone = (model) =>
  model.form === "PHYSICAL" &&
  (model.formFactor ?? "PHONE") === "PHONE" &&
  !(model.tags ?? []).includes("deprecated") &&
  (model.supportedAbis ?? []).includes(ABI);

/** The devices to run on, as {model, version, maker}; at most MAX_DEVICES, no model twice. */
export function pickDevices(models) {
  const phones = models.filter(isPhone).filter((m) => versionsOf(m).length > 0);
  const picked = [];
  const take = (model, version) => {
    if (picked.length >= MAX_DEVICES || picked.some((p) => p.model === model.id)) return;
    picked.push({ model: model.id, version: String(version), maker: String(model.manufacturer ?? "").toLowerCase() });
  };
  for (const maker of MAKERS) {
    const own = phones.filter((m) => String(m.manufacturer ?? "").toLowerCase() === maker);
    const newest = own.sort((a, b) => versionsOf(b).at(-1) - versionsOf(a).at(-1) || String(a.id).localeCompare(String(b.id)))[0];
    if (newest) take(newest, versionsOf(newest).at(-1));
  }
  const oldest = [...phones].sort((a, b) => versionsOf(a)[0] - versionsOf(b)[0] || String(a.id).localeCompare(String(b.id)))[0];
  if (oldest) take(oldest, versionsOf(oldest)[0]);
  return picked;
}

/** gcloud's flag for one device: Vietnamese, portrait, as the app's first users hold it. */
export function deviceFlag({ model, version }) {
  return `--device=model=${model},version=${version},locale=vi,orientation=portrait`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/mobile-ftl-devices.mjs <models.json>");
    process.exit(2);
  }
  const devices = pickDevices(JSON.parse(fs.readFileSync(file, "utf8")));
  if (devices.length === 0) {
    console.error("Test Lab's catalogue offers no physical phone at or above API " + MIN_API);
    process.exit(1);
  }
  for (const device of devices) console.log(deviceFlag(device));
}

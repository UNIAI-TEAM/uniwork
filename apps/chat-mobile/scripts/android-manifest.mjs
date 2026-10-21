#!/usr/bin/env node
// The Android permissions and services a UniChat release build ends up with,
// for the Play Console's App content declarations (data safety, foreground
// services; docs/runbooks/unichat-mobile-release.md). It merges what Gradle
// merges: the app manifest that `expo prebuild` writes (read without writing
// anything, through `expo config --type introspect`, with the production
// variant's env) and the AndroidManifest.xml of every native library the
// build links — the Expo modules autolinking reports and the app's direct
// dependencies that ship an android/ folder. expo-dev-* is left out: the dev
// client is linked into debug builds only. A `tools:node="remove"` entry in
// the app manifest drops the library's (plugins/with-removed-android-services.js).
// android-manifest.test.ts holds the result; the CI release build
// (mobile-verify.yml › android-release) is what proves it on a device build.
//   node apps/chat-mobile/scripts/android-manifest.mjs   # prints the JSON
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const require = createRequire(path.join(appRoot, "package.json"));

function introspect() {
  const cli = require.resolve("expo/bin/cli");
  const out = execFileSync(process.execPath, [cli, "config", "--type", "introspect", "--json"], {
    cwd: appRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      UNICHAT_ENV: "production",
      UNICHAT_API_URL: "https://api.example.invalid",
      UNICHAT_APP_URL: "https://app.example.invalid",
      EAS_BUILD: "",
      EXPO_NO_TELEMETRY: "1",
      EXPO_OFFLINE: "1",
    },
  });
  return JSON.parse(out);
}

/** Node's lookup: the nearest node_modules/<name> at or above `fromDir`. */
function locate(name, fromDirs) {
  for (const from of fromDirs) {
    let dir = from;
    for (;;) {
      const candidate = path.join(dir, "node_modules", name, "package.json");
      if (fs.existsSync(candidate)) return path.dirname(fs.realpathSync(candidate));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

function qualify(name, pkg) {
  if (!name.startsWith(".")) return name.includes(".") || !pkg ? name : `${pkg}.${name}`;
  return `${pkg}${name}`;
}

/** Permissions and services one library manifest declares, its own `remove`s apart. */
function readLibrary(dir) {
  const file = path.join(dir, "android", "src", "main", "AndroidManifest.xml");
  if (!fs.existsSync(file)) return null;
  const xml = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  let pkg = attrs(xml.match(/<manifest\b[^>]*>/)?.[0] ?? "").package ?? "";
  if (!pkg) {
    const gradle = ["build.gradle", "build.gradle.kts"].map((f) => path.join(dir, "android", f)).find((f) => fs.existsSync(f));
    pkg = (gradle && fs.readFileSync(gradle, "utf8").match(/namespace\s*=?\s*["']([^"']+)["']/)?.[1]) || "";
  }
  const permissions = [...xml.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*>/g)].map((m) => attrs(m[0]));
  const services = [...xml.matchAll(/<service\b[^>]*>/g)].map((m) => attrs(m[0]));
  return {
    permissions: permissions.filter((p) => p["tools:node"] !== "remove").map((p) => p["android:name"]),
    services: services.filter((s) => s["tools:node"] !== "remove").map((s) => ({ name: qualify(s["android:name"], pkg), type: s["android:foregroundServiceType"] ?? "" })),
  };
}

export function androidManifestReport() {
  const config = introspect();
  const manifest = config._internal.modResults.android.manifest.manifest;
  const application = manifest.application?.[0] ?? {};
  const appPkg = config.android?.package ?? "";
  const removed = { permissions: new Set(), services: new Set() };
  const permissions = new Set();
  const services = new Map();
  for (const p of manifest["uses-permission"] ?? []) {
    if (p.$["tools:node"] === "remove") removed.permissions.add(p.$["android:name"]);
    else permissions.add(p.$["android:name"]);
  }
  for (const s of application.service ?? []) {
    const name = qualify(s.$["android:name"], appPkg);
    if (s.$["tools:node"] === "remove") removed.services.add(name);
    else services.set(name, s.$["android:foregroundServiceType"] ?? "");
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
  const expoDir = locate("expo", [appRoot]);
  const libraries = new Set([...(config._internal.autolinkedModules ?? []), ...Object.keys(pkg.dependencies ?? {})]);
  for (const name of [...libraries].sort()) {
    if (name.startsWith("expo-dev-") || name.startsWith("@uniwork/")) continue;
    const dir = locate(name, [appRoot, expoDir].filter(Boolean));
    const library = dir && readLibrary(dir);
    if (!library) continue;
    for (const permission of library.permissions) permissions.add(permission);
    for (const service of library.services) if (!services.has(service.name)) services.set(service.name, service.type);
  }
  for (const name of removed.permissions) permissions.delete(name);
  for (const name of removed.services) services.delete(name);
  const appAttrs = application.$ ?? {};
  return {
    // What leaves the phone in a backup or a device transfer, and whether cleartext is allowed (MASVS-STORAGE, -NETWORK).
    application: {
      allowBackup: appAttrs["android:allowBackup"] ?? "",
      dataExtractionRules: appAttrs["android:dataExtractionRules"] ?? "",
      usesCleartextTraffic: appAttrs["android:usesCleartextTraffic"] ?? "",
      networkSecurityConfig: appAttrs["android:networkSecurityConfig"] ?? "",
    },
    permissions: [...permissions].sort(),
    removedPermissions: [...removed.permissions].sort(),
    services: [...services].map(([name, foregroundServiceType]) => ({ name, foregroundServiceType })).sort((a, b) => a.name.localeCompare(b.name)),
    removedServices: [...removed.services].sort(),
  };
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.stdout.write(`${JSON.stringify(androidManifestReport(), null, 2)}\n`);

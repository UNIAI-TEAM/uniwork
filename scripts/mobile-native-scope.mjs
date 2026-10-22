#!/usr/bin/env node
// Which of UniChat mobile's checks (mobile-verify.yml) does a change need?
//
// mobile: anything the app's checks read — the app, what it imports, the
// install graph, the four mobile workflows, and the contracts its tests hold
// it to on the server's side (the event catalogue, the response SDOs). The
// workflow runs on every pull request so that its gate job, the one required
// status check (scripts/branch-protection.json), always reports; without
// this a PR outside the list skips every job and the gate passes at once.
// The same list is the workflow's push filter (scripts/mobile-workflows.test.mjs).
//
// native: does it need the native release builds (android-release, ios-release)?
// Those prebuild and compile for ~20 minutes each, so a PR
// pays for it only when it touches what reaches the binary: the app itself
// (not its docs, store copy, Maestro flows, tests or test/lint config), the install graph, or a
// packages/core file the app imports at runtime (the allowlist's import
// closure, scripts/mobile-core-graph.mjs). Everything else still runs
// typecheck, lint, tests and the JS bundle budget.
//
//   node scripts/mobile-native-scope.mjs --base <sha> [--head <sha>]
//   echo "<changed paths>" | node scripts/mobile-native-scope.mjs --stdin
//
// Prints mobile=true|false and native=true|false (also to $GITHUB_OUTPUT) and
// the paths that decided native.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { root, runtimeClosure } from "./mobile-core-graph.mjs";

const APP = "apps/chat-mobile/";
// Docs, store copy, device flows, tests and the configs only the checks read.
// The cold-start smoke flow is the exception: android-smoke runs it.
const APP_NOT_NATIVE = [/\.md$/, /^maestro\/(?!flows\/smoke-launch\.yaml$)/, /^store\//, /\.test\.tsx?$/, /^test\//, /^(eslint|jest|vitest)\.config\.[cm]?[jt]s$/, /^coverage-floor\.json$/, /^data\/persisted-schema\.lock\.json$/];
// scripts/mobile-perf.mjs is what android-smoke times the APK with, scripts/maestro-retry.sh what it runs
// the flows through: a change to either is proved there.
const INSTALL_GRAPH = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".github/workflows/mobile-verify.yml",
  "scripts/mobile-native-scope.mjs",
  "scripts/mobile-perf.mjs",
  "scripts/maestro-retry.sh",
]);

// GitHub `paths` globs: mobile-verify.yml's push filter is exactly this list.
export const MOBILE_PATHS = [
  "apps/chat-mobile/**",
  "packages/core/**",
  "packages/eslint-config/**",
  "packages/tsconfig/**",
  "scripts/**",
  "patches/**",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  // Read by scripts/mobile-knip.test.mjs and scripts/mobile-easignore.test.mjs.
  "knip.json",
  // ktlint's settings for the modules' Kotlin.
  ".editorconfig",
  ".easignore",
  ".gitignore",
  "**/.gitignore",
  ".github/workflows/mobile-verify.yml",
  ".github/workflows/chat-mobile-release.yml",
  ".github/workflows/chat-mobile-verify.yml",
  ".github/workflows/chat-mobile-update.yml",
  ".github/workflows/chat-mobile-production.yml",
  ".github/workflows/chat-mobile-promote.yml",
  ".github/workflows/chat-mobile-release-health.yml",
  // scripts/mobile-workflows.test.mjs reads the release runbook.
  "docs/runbooks/unichat-mobile-release.md",
  // The server's side of the app's contracts: data/realtime/frames.test.ts reads the event
  // catalogue, data/server-contract.test.ts the response SDOs.
  "docs/events/CATALOGUE.md",
  "server/internal/handler/dto/sdo/**",
  // The handlers that answer with those SDOs (wrapper keys of map-literal answers), the config
  // struct /config embeds and the flag catalogue the kill switches come from.
  "server/internal/handler/chat*.go",
  "server/internal/handler/auth.go",
  "server/internal/handler/identity.go",
  "server/internal/handler/config.go",
  "server/internal/handler/push_preview_policy.go",
  "server/internal/handler/workspace.go",
  "server/internal/handler/task.go",
  "server/internal/config/unichat_downloads.go",
  "server/internal/featureflags/keys.go",
];

/** A GitHub `paths` glob as a RegExp: `**` crosses folders, `*` does not. */
function globRegExp(glob) {
  const source = glob
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => (part === "**/" ? "(?:.*/)?" : part === "**" ? ".*" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}$`);
}
const MOBILE_RES = MOBILE_PATHS.map(globRegExp);

/** Whether any changed path is one the app's checks read (or one that needs the native build). */
export function touchesMobile(changed, coreFiles) {
  return changed.some((file) => MOBILE_RES.some((re) => re.test(file))) || nativePaths(changed, coreFiles).length > 0;
}

/** The changed paths that need the native build; empty when none does. */
export function nativePaths(changed, coreFiles = runtimeClosure()) {
  return changed.filter((file) => {
    if (INSTALL_GRAPH.has(file) || file.startsWith("patches/")) return true;
    if (file.startsWith(APP)) return !APP_NOT_NATIVE.some((re) => re.test(file.slice(APP.length)));
    return coreFiles.has(file);
  });
}

function changedFiles(argv) {
  if (argv.includes("--stdin")) return fs.readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const base = arg("--base");
  if (!base) throw new Error("mobile-native-scope: pass --base <sha> or --stdin");
  const out = execFileSync("git", ["diff", "--name-only", `${base}...${arg("--head") ?? "HEAD"}`], { cwd: root, encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const changed = changedFiles(process.argv.slice(2));
  const coreFiles = runtimeClosure();
  const hits = nativePaths(changed, coreFiles);
  const native = hits.length > 0;
  const mobile = touchesMobile(changed, coreFiles);
  console.log(`mobile=${mobile}`);
  console.log(`native=${native}`);
  for (const file of hits.slice(0, 20)) console.log(`  ${file}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `mobile=${mobile}\nnative=${native}\n`);
}

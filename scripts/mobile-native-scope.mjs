#!/usr/bin/env node
// Does a change need UniChat mobile's native release build (mobile-verify.yml ›
// android-release)? That job prebuilds and runs Gradle for ~20 minutes, so a PR
// pays for it only when it touches what reaches the binary: the app itself
// (not its docs, store copy, Maestro flows, tests or test/lint config), the install graph, or a
// packages/core file the app imports at runtime (the allowlist's import
// closure, scripts/mobile-core-graph.mjs). Everything else still runs
// typecheck, lint, tests and the JS bundle budget.
//
//   node scripts/mobile-native-scope.mjs --base <sha> [--head <sha>]
//   echo "<changed paths>" | node scripts/mobile-native-scope.mjs --stdin
//
// Prints native=true|false (also to $GITHUB_OUTPUT) and the paths that decided it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { root, runtimeClosure } from "./mobile-core-graph.mjs";

const APP = "apps/chat-mobile/";
// Docs, store copy, device flows, tests and the configs only the checks read.
// The cold-start smoke flow is the exception: android-smoke runs it.
const APP_NOT_NATIVE = [/\.md$/, /^maestro\/(?!flows\/smoke-launch\.yaml$)/, /^store\//, /\.test\.tsx?$/, /^test\//, /^(eslint|jest|vitest)\.config\.[cm]?[jt]s$/, /^coverage-floor\.json$/, /^data\/persisted-schema\.lock\.json$/];
const INSTALL_GRAPH = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".github/workflows/mobile-verify.yml", "scripts/mobile-native-scope.mjs"]);

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
  const hits = nativePaths(changedFiles(process.argv.slice(2)));
  const native = hits.length > 0;
  console.log(`native=${native}`);
  for (const file of hits.slice(0, 20)) console.log(`  ${file}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `native=${native}\n`);
}

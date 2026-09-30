import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createRequire } from "node:module";
import identity from "../identity.json" with { type: "json" };
import { generateReleaseInventory } from "./release-inventory.mjs";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronPackage = require("electron/package.json");
const repositoryRoot = resolve(appDirectory, "../..");
const distDirectory = join(appDirectory, "dist");
const outputDirectory = resolve(process.env.OFFICE_DESKTOP_OUTPUT ?? join(repositoryRoot, ".uniwork-dev", "office-desktop", "artifacts"));
const cacheRoot = resolve(process.env.OFFICE_DESKTOP_CACHE ?? join(repositoryRoot, ".uniwork-dev", "office-desktop", "cache"));

export function createPackagerConfig({ platform = "win32", arch = "x64", output = outputDirectory } = {}) {
  if (platform !== "win32" && platform !== "darwin") throw new Error(`unsupported desktop package platform: ${platform}`);
  const allowed = identity.build.platforms[platform];
  if (!allowed.includes(arch)) throw new Error(`unsupported ${platform} architecture: ${arch}`);
  // ZIP is the unsigned dev distribution format. It is a complete Windows
  // x64 artifact without invoking NSIS/signing; installer targets remain in
  // the 07c scope.
  const target = platform === "win32" ? { target: "zip", arch: [arch] } : { target: "dmg", arch: [arch] };
  return {
    appId: identity.appId,
    productName: identity.product,
    executableName: identity.executable,
    artifactName: `${identity.artifactPrefix}_${identity.build.appVersion}_${identity.build.buildId}_${platform}_${arch}.${platform === "win32" ? "zip" : "dmg"}`,
    directories: { app: appDirectory, output },
    files: ["dist/**", "identity.json", "package.json"],
    extraResources: [{ from: join(distDirectory, "release-inventory"), to: "release-inventory" }],
    asar: true,
    compression: "store",
    npmRebuild: false,
    nodeGypRebuild: false,
    buildDependenciesFromSource: false,
    forceCodeSigning: false,
    electronVersion: electronPackage.version,
    publish: null,
    win: platform === "win32" ? { target: [target], signAndEditExecutable: false } : undefined,
    mac: platform === "darwin" ? { target: [target], hardenedRuntime: false } : undefined,
  };
}

export function assertNoExternalEngineSource() {
  const forbiddenSource = resolve(repositoryRoot, "..", "genoffice");
  if (existsSync(forbiddenSource)) throw new Error("desktop packaging refuses the external ../genoffice source; use the pinned in-repo engine");
}

export function validateMacTargets(config = { mac: { target: [{ target: "dmg", arch: ["arm64", "x64"] }] } }) {
  const targets = config.mac?.target ?? [];
  const architectures = new Set(targets.flatMap((target) => target.arch ?? []));
  if (!architectures.has("arm64") || !architectures.has("x64")) throw new Error("macOS config must declare arm64 and x64 targets");
  return true;
}

function runBuild() {
  const result = spawnSync(process.execPath, [join(appDirectory, "scripts", "build.mjs")], { cwd: appDirectory, stdio: "inherit", env: process.env, windowsHide: true });
  if (result.status !== 0) throw new Error("desktop build failed before packaging");
}

function configureCaches() {
  process.env.ELECTRON_CACHE ??= join(cacheRoot, "electron");
  process.env.electron_config_cache ??= join(cacheRoot, "electron-config");
  process.env.ELECTRON_BUILDER_CACHE ??= join(cacheRoot, "electron-builder");
}

export async function packageUnsignedDev() {
  configureCaches();
  await mkdir(outputDirectory, { recursive: true });
  validateMacTargets();
  assertNoExternalEngineSource();
  runBuild();
  await generateReleaseInventory();
  const { Arch, Platform, build } = await import("electron-builder");
  const config = createPackagerConfig({ platform: "win32", arch: "x64" });
  const targets = Platform.WINDOWS.createTarget(["zip"], Arch.x64);
  const artifacts = await build({ targets, config });
  if (artifacts.length === 0 || !artifacts.some((artifact) => /_unsigned-dev_win32_x64\.zip$/i.test(artifact))) throw new Error("electron-builder did not produce a labelled unsigned-dev Windows x64 artifact");
  return { artifacts, outputDirectory, config };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await packageUnsignedDev();
    process.stdout.write(`office-desktop: unsigned-dev Windows x64 artifact written to ${result.outputDirectory}\n`);
    for (const artifact of result.artifacts) process.stdout.write(`${artifact}\n`);
  } catch (error) {
    process.stderr.write(`office-desktop: package failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

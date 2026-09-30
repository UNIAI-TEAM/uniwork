import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createRequire } from "node:module";
import identity from "../identity.json" with { type: "json" };
import { generateReleaseInventory } from "./release-inventory.mjs";
import { deriveBuildMetadata, readDeploymentProfileFromEnv } from "./deployment-profile.mjs";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronPackage = require("electron/package.json");
const packageJson = require(join(appDirectory, "package.json"));
const repositoryRoot = resolve(appDirectory, "../..");
const distDirectory = join(appDirectory, "dist");
const outputDirectory = resolve(process.env.OFFICE_DESKTOP_OUTPUT ?? join(repositoryRoot, ".uniwork-dev", "office-desktop", "artifacts"));
const cacheRoot = resolve(process.env.OFFICE_DESKTOP_CACHE ?? join(repositoryRoot, ".uniwork-dev", "office-desktop", "cache"));

export function createPackagerConfig({ platform = "win32", arch = "x64", output = outputDirectory, channel = process.env.UNIWORK_OFFICE_CHANNEL ?? identity.build.channel, version = packageJson.version, artifactLabel = "unsigned", nsisInclude = process.env.UNIWORK_NSIS_INCLUDE ?? "installer.nsh" } = {}) {
  if (platform !== "win32" && platform !== "darwin") throw new Error(`unsupported desktop package platform: ${platform}`);
  const allowed = identity.build.platforms[platform];
  if (!allowed.includes(arch)) throw new Error(`unsupported ${platform} architecture: ${arch}`);
  const channelIdentity = identity.channelProfiles[channel];
  if (!channelIdentity) throw new Error(`unsupported identity channel: ${channel}`);
  const buildVersion = version.includes("-") ? version : channel === "stable" ? version : `${version}-${channel}.0`;
  const target = platform === "win32" ? { target: "zip", arch: [arch] } : { target: "dmg", arch: [arch] };
  const zipArtifactName = `${channelIdentity.artifactPrefix}_${buildVersion}_${artifactLabel}_${platform}_${arch}.${platform === "win32" ? "zip" : "dmg"}`;
  return {
    appId: channelIdentity.appId,
    productName: channelIdentity.product,
    executableName: channelIdentity.executable,
    artifactName: zipArtifactName,
    directories: { app: appDirectory, output },
    // All host code is bundled by esbuild.  Keep dependency auto-discovery
    // from copying the workspace node_modules tree (including tests/fixtures)
    // into the asar; the generated package metadata has no runtime deps.
    files: ["dist/**", "identity.json", "package.json", "!node_modules/**", "!dist/**/*.map", "!dist/.build-metafile.json"],
    // electron-builder derives the per-user NSIS install directory from the
    // sanitized package name. Keep that name in the accepted channel profile
    // so dev is isolated while beta and stable intentionally upgrade in place.
    extraMetadata: { name: channelIdentity.userDataNamespace, version: buildVersion, dependencies: {}, devDependencies: {} },
    extraResources: [{ from: join(distDirectory, "release-inventory"), to: "release-inventory" }],
    asar: true,
    compression: "store",
    npmRebuild: false,
    nodeGypRebuild: false,
    buildDependenciesFromSource: false,
    forceCodeSigning: false,
    electronVersion: electronPackage.version,
    publish: null,
    protocols: platform === "win32" ? [{ name: channelIdentity.product, schemes: [channelIdentity.userScheme] }] : undefined,
    win: platform === "win32" ? { target: [{ target: "zip", arch: [arch] }, { target: "nsis", arch: [arch] }], signAndEditExecutable: false } : undefined,
    nsis: platform === "win32" ? {
      artifactName: `${channelIdentity.artifactPrefix}_${buildVersion}_${artifactLabel}_${platform}_${arch}-setup.exe`,
      oneClick: true,
      perMachine: false,
      allowElevation: false,
      createStartMenuShortcut: true,
      createDesktopShortcut: false,
      shortcutName: channelIdentity.product,
      deleteAppDataOnUninstall: false,
      runAfterFinish: false,
      include: nsisInclude,
    } : undefined,
    mac: platform === "darwin" ? { target: [target], identity: null, hardenedRuntime: false, gatekeeperAssess: false } : undefined,
  };
}

function isInside(root, file) {
  const canonicalRoot = resolve(root);
  const canonicalFile = resolve(file);
  return canonicalFile === canonicalRoot || canonicalFile.startsWith(`${canonicalRoot}${process.platform === "win32" ? "\\" : "/"}`);
}

/** Refuse any esbuild input whose real path escapes this checkout. */
export function assertBuildInputsInsideRepository(metafile, { root = repositoryRoot, cwd = appDirectory } = {}) {
  const outside = [];
  for (const input of Object.keys(metafile?.inputs ?? {})) {
    const candidate = resolve(cwd, input);
    let canonical = candidate;
    try { canonical = realpathSync.native(candidate); } catch { /* esbuild may report a generated/virtual input */ }
    if (!isInside(root, canonical)) outside.push(canonical);
  }
  if (outside.length > 0) throw new Error(`desktop build input escaped repository: ${outside.join(", ")}`);
  return true;
}

/** Compatibility name retained for callers of the old sibling-folder guard. */
export function assertNoExternalEngineSource(metafile) {
  return assertBuildInputsInsideRepository(metafile ?? { inputs: {} });
}

function asarModule() {
  const builderEntry = require.resolve("electron-builder");
  return require(require.resolve("@electron/asar", { paths: [dirname(builderEntry)] }));
}

/** Verify the generated asar contains only the reviewed app payload. */
export function assertPackagedAsarContents(unpackedDirectory) {
  const asarPath = join(unpackedDirectory, "resources", "app.asar");
  if (!existsSync(asarPath)) throw new Error(`packaged app.asar is missing: ${asarPath}`);
  const files = asarModule().listPackage(asarPath);
  const normalizedFiles = files.map((file) => file.replaceAll("\\", "/").replace(/^\/+/, ""));
  const nodeModules = normalizedFiles.filter((file) => /^node_modules(?:\/|$)/.test(file));
  if (nodeModules.length > 0) throw new Error(`packaged asar contains raw node_modules (${nodeModules.slice(0, 5).join(", ")})`);
  const unexpected = normalizedFiles.filter((file) => !/^dist(?:\/|$)/.test(file) && file !== "identity.json" && file !== "package.json");
  if (unexpected.length > 0) throw new Error(`packaged asar contains unreviewed payload (${unexpected.slice(0, 5).join(", ")})`);
  return files;
}

export function validateMacTargets(config = { mac: { target: [{ target: "dmg", arch: ["arm64", "x64"] }] } }) {
  const targets = config.mac?.target ?? [];
  const architectures = new Set(targets.flatMap((target) => target.arch ?? []));
  if (!architectures.has("arm64") || !architectures.has("x64")) throw new Error("macOS config must declare arm64 and x64 targets");
  return true;
}

async function runBuild() {
  const result = spawnSync(process.execPath, [join(appDirectory, "scripts", "build.mjs")], { cwd: appDirectory, stdio: "inherit", env: process.env, windowsHide: true });
  if (result.status !== 0) throw new Error("desktop build failed before packaging");
  const metafilePath = join(distDirectory, ".build-metafile.json");
  const metafile = JSON.parse(await readFile(metafilePath, "utf8"));
  assertBuildInputsInsideRepository(metafile);
  return metafile;
}

function configureCaches() {
  process.env.ELECTRON_CACHE ??= join(cacheRoot, "electron");
  process.env.electron_config_cache ??= join(cacheRoot, "electron-config");
  process.env.ELECTRON_BUILDER_CACHE ??= join(cacheRoot, "electron-builder");
}

async function configureShortNsisTemplates() {
  if (process.platform !== "win32") return;
  // NSIS has a legacy path-length limit. The pnpm store path of this checkout
  // can exceed it before makensis even opens the stock include files. Copy the
  // reviewed electron-builder templates to the D: cache and redirect the
  // in-process template seam; no source or dependency is modified.
  const builderRoot = dirname(require.resolve("electron-builder"));
  const nsisUtil = require(require.resolve("app-builder-lib/out/targets/nsis/nsisUtil.js", { paths: [builderRoot] }));
  const source = join(dirname(require.resolve("app-builder-lib/package.json", { paths: [builderRoot] })), "templates", "nsis");
  const target = join(cacheRoot, "nsis-templates");
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
  nsisUtil.nsisTemplatesDir = target;
}

async function prepareInstallerInclude(channelIdentity) {
  const source = join(appDirectory, "build", "installer.nsh");
  const generated = join(cacheRoot, `installer-${channelIdentity.userScheme}.nsh`);
  const template = await readFile(source, "utf8");
  await writeFile(generated, template
    .replaceAll("@USER_SCHEME@", channelIdentity.userScheme)
    .replaceAll("@USER_DATA_NAMESPACE@", channelIdentity.userDataNamespace), "utf8");
  return generated;
}

export async function packageUnsignedDev() {
  configureCaches();
  await configureShortNsisTemplates();
  // Resolve before any build work so missing/invalid deployment configuration
  // fails with the typed error rather than silently producing a production app.
  const buildMetadata = deriveBuildMetadata(process.env, identity, packageJson.version);
  const deploymentProfile = readDeploymentProfileFromEnv(process.env, identity, packageJson.version);
  await mkdir(outputDirectory, { recursive: true });
  validateMacTargets();
  try {
    const metafile = await runBuild();
    await generateReleaseInventory({ metafile });
    const { Arch, Platform, build } = await import("electron-builder");
    const installerInclude = await prepareInstallerInclude(buildMetadata.identity);
    const config = createPackagerConfig({ platform: "win32", arch: "x64", channel: buildMetadata.channel, version: buildMetadata.version, artifactLabel: buildMetadata.artifactLabel, nsisInclude: installerInclude });
    const targets = Platform.WINDOWS.createTarget(["zip", "nsis"], Arch.x64);
    const artifacts = await build({ targets, config });
    const zipPattern = new RegExp(`_${buildMetadata.artifactLabel}_win32_x64\\.zip$`, "i");
    const setupPattern = new RegExp(`_${buildMetadata.artifactLabel}_win32_x64-setup\\.exe$`, "i");
    if (artifacts.length === 0 || !artifacts.some((artifact) => zipPattern.test(artifact)) || !artifacts.some((artifact) => setupPattern.test(artifact))) throw new Error("electron-builder did not produce the labelled unsigned Windows x64 ZIP and NSIS artifacts");
    assertPackagedAsarContents(join(outputDirectory, "win-unpacked"));
    return { artifacts, outputDirectory, config };
  } finally {
    await rm(join(distDirectory, ".build-metafile.json"), { force: true });
  }
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

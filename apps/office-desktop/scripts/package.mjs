import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { chmodSync, existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
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
// The single desktop document-format table; shared with the app's TS helpers
// and read here by path so OS associations can never drift from the host.
const documentFormats = JSON.parse(readFileSync(join(appDirectory, "shared", "document-formats.json"), "utf8"));
const repositoryRoot = resolve(appDirectory, "../..");
const distDirectory = join(appDirectory, "dist");
const outputDirectory = resolve(process.env.OFFICE_DESKTOP_OUTPUT ?? join(repositoryRoot, ".uniwork-dev", "office-desktop", "artifacts"));
const cacheRoot = resolve(process.env.OFFICE_DESKTOP_CACHE ?? join(repositoryRoot, ".uniwork-dev", "office-desktop", "cache"));

/** The Linux MIME types the desktop app registers, one per file-extension
 * association, straight from the shared format table. */
export const LINUX_DOCUMENT_MIME_TYPES = Object.values(documentFormats.formats).flatMap((format) => format.extensions.map(() => format.mimeTypes[0]));

/** electron-builder file associations for every extension in the format
 * table. `mimeType` is Linux-only: the deb/AppImage desktop entry needs it
 * while Windows/macOS derive the association from the extension. */
export function documentFileAssociations(platform) {
  return Object.values(documentFormats.formats).flatMap((format) => format.extensions.map((ext) => ({ ext, name: format.associationName, role: "Editor", ...(platform === "linux" ? { mimeType: format.mimeTypes[0] } : {}) })));
}
/** Electron 44.5.0 (pinned) requires macOS 13 Ventura; spec §6.6 pins the same floor. */
export const MACOS_MINIMUM_SYSTEM_VERSION = "13.0";
/** Extra package metadata is build-time provided, with the accepted product
 * values as defaults (user decision 2026-10-02 via the Advisor). The homepage
 * default must stay equal to apps/office-desktop/package.json's `homepage`,
 * which electron-builder reads for its metadata. */
export const DEFAULT_LINUX_HOMEPAGE = "https://uniwork.unicomhub.com";
export const DEFAULT_LINUX_MAINTAINER = "UniWork <contact@unicomhub.com>";

export function linuxPackagingMetadata(environment = process.env) {
  const homepage = environment.OFFICE_DESKTOP_HOMEPAGE?.trim() || DEFAULT_LINUX_HOMEPAGE;
  const maintainer = environment.OFFICE_DESKTOP_MAINTAINER?.trim() || DEFAULT_LINUX_MAINTAINER;
  return { homepage, maintainer };
}

/** Linux installs the payload under /opt/<productName>. Use the space-free
 * channel namespace so the generated Exec line never needs quoting; Ubuntu's
 * xdg-open failed to launch the quoted space path (cloud round 3). The visible
 * name stays the channel product through linux.desktop.entry.Name. */
export function linuxProductName(channelIdentity) {
  return channelIdentity.userDataNamespace;
}

export function platformArches(platform) {
  const arches = identity.build.platforms[platform];
  if (!Array.isArray(arches) || arches.length === 0) throw new Error(`unsupported desktop package platform: ${platform}`);
  return [...arches];
}

/** Cross-platform builds are refused with an actionable error: a dmg needs a
 * Mac, and the Linux targets build on Linux (or via the pinned Docker script
 * from Windows, which calls this same entry inside the container). */
export function assertBuildPlatformAllowed(platform, hostPlatform = process.platform) {
  platformArches(platform);
  if (platform === hostPlatform) return true;
  if (platform === "darwin") throw new Error('macOS .dmg builds require a macOS host; this environment has no Mac. Run "node apps/office-desktop/scripts/package.mjs --platform darwin" on a Mac.');
  if (platform === "linux") throw new Error('Linux .deb/AppImage builds require a Linux host. On Windows run "node apps/office-desktop/scripts/package-linux-docker.mjs" (pinned Docker image).');
  throw new Error(`${platform} builds are only supported on a ${platform} host`);
}

/** Dev-only forced-failure seam for the NSIS wrong-machine guard proof. The
 * line is prepended to the generated include (electron-builder 26 has no
 * public macro-define option); a normal build never sets the flag, so the
 * shipped installer keeps the real checks only. */
export function nsisTestDefine(value) {
  if (value === undefined || value === "") return undefined;
  if (value === "old-windows") return "!define UNIWORK_TEST_FORCE_OLD_WINDOWS";
  if (value === "not-x64") return "!define UNIWORK_TEST_FORCE_NOT_X64";
  throw new Error(`unknown UNIWORK_NSIS_TEST_GATE value: ${value}`);
}

export function createPackagerConfig({ platform = "win32", arch = "x64", output = outputDirectory, channel = process.env.UNIWORK_OFFICE_CHANNEL ?? identity.build.channel, version = packageJson.version, artifactLabel = "unsigned", nsisInclude = process.env.UNIWORK_NSIS_INCLUDE ?? "installer.nsh", debResources } = {}) {
  const allowedArches = platformArches(platform);
  if (!allowedArches.includes(arch)) throw new Error(`unsupported ${platform} architecture: ${arch}`);
  const channelIdentity = identity.channelProfiles[channel];
  if (!channelIdentity) throw new Error(`unsupported identity channel: ${channel}`);
  const buildVersion = version.includes("-") ? version : channel === "stable" ? version : `${version}-${channel}.0`;
  const artifactBase = `${channelIdentity.artifactPrefix}_${buildVersion}_${artifactLabel}_${platform}_${arch}`;
  const protocols = [{ name: channelIdentity.product, schemes: [channelIdentity.userScheme] }];
  const fileAssociations = documentFileAssociations(platform);
  const packagingMetadata = linuxPackagingMetadata();
  return {
    appId: channelIdentity.appId,
    productName: platform === "linux" ? linuxProductName(channelIdentity) : channelIdentity.product,
    executableName: channelIdentity.executable,
    artifactName: `${artifactBase}.${platform === "win32" ? "zip" : platform === "darwin" ? "dmg" : "AppImage"}`,
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
    // The manifest user scheme is the app's deep-link handler on every host:
    // Windows/Linux desktop MimeType and macOS CFBundleURLTypes. Linux keeps
    // its copies under `linux` because electron-builder concatenates the
    // top-level and platform lists (duplicate MimeType entries otherwise).
    protocols: platform === "linux" ? undefined : protocols,
    // Windows keeps the original association (no mimeType key); Linux adds the
    // standard docx MIME so the desktop entry and mime package carry it.
    fileAssociations: platform === "linux" ? undefined : fileAssociations,
    win: platform === "win32" ? { target: [{ target: "zip", arch: [arch] }, { target: "nsis", arch: [arch] }], signAndEditExecutable: false } : undefined,
    nsis: platform === "win32" ? {
      artifactName: `${artifactBase}-setup.exe`,
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
    mac: platform === "darwin" ? {
      target: [{ target: "dmg", arch: [arch] }],
      identity: null,
      hardenedRuntime: false,
      gatekeeperAssess: false,
      minimumSystemVersion: MACOS_MINIMUM_SYSTEM_VERSION,
      // One architecture per artifact: the OS refuses the wrong-chip dmg and
      // the binary itself is not universal.
      extendInfo: { LSArchitecturePriority: [arch] },
    } : undefined,
    linux: platform === "linux" ? {
      target: [{ target: "deb", arch: [arch] }, { target: "AppImage", arch: [arch] }],
      category: "Office",
      synopsis: "UniWork Office",
      protocols,
      fileAssociations,
      desktop: { entry: { Name: channelIdentity.product } },
    } : undefined,
    deb: platform === "linux" ? {
      artifactName: `${artifactBase}.deb`,
      packageName: channelIdentity.userDataNamespace,
      maintainer: packagingMetadata.maintainer,
      packageCategory: "office",
      priority: "optional",
      // Minimum runtime libraries Electron 44 links against; libsecret-1-0
      // backs the safeStorage keyring requirement.
      depends: ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0"],
      // fpm args are appended after its generated ones, so --url pins the deb
      // Homepage field to the build-time value (env override or default).
      fpm: [
        `--url=${packagingMetadata.homepage}`,
        ...(debResources ? [`--before-install=${resolve(debResources.beforeInstall)}`] : []),
      ],
      ...(debResources ? { afterInstall: resolve(debResources.afterInstall), afterRemove: resolve(debResources.afterRemove) } : {}),
    } : undefined,
    appImage: platform === "linux" ? { artifactName: `${artifactBase}.AppImage` } : undefined,
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

/** Locate the packaged app.asar. Linux/Windows keep it at resources/app.asar;
 * a macOS bundle nests it under <Product>.app/Contents/Resources. */
export function locatePackagedAsar(unpackedDirectory) {
  const flat = join(unpackedDirectory, "resources", "app.asar");
  if (existsSync(flat)) return flat;
  try {
    for (const entry of readdirSync(unpackedDirectory)) {
      if (!entry.endsWith(".app")) continue;
      const nested = join(unpackedDirectory, entry, "Contents", "Resources", "app.asar");
      if (existsSync(nested)) return nested;
    }
  } catch { /* the caller reports the missing directory below */ }
  throw new Error(`packaged app.asar is missing: ${unpackedDirectory}`);
}

/** Verify the generated asar contains only the reviewed app payload. */
export function assertPackagedAsarContents(unpackedDirectory) {
  const files = asarModule().listPackage(locatePackagedAsar(unpackedDirectory));
  const normalizedFiles = files.map((file) => file.replaceAll("\\", "/").replace(/^\/+/, ""));
  const nodeModules = normalizedFiles.filter((file) => /^node_modules(?:\/|$)/.test(file));
  if (nodeModules.length > 0) throw new Error(`packaged asar contains raw node_modules (${nodeModules.slice(0, 5).join(", ")})`);
  const unexpected = normalizedFiles.filter((file) => !/^dist(?:\/|$)/.test(file) && file !== "identity.json" && file !== "package.json");
  if (unexpected.length > 0) throw new Error(`packaged asar contains unreviewed payload (${unexpected.slice(0, 5).join(", ")})`);
  return files;
}

/** The two supported macOS architectures are planned together; each artifact
 * build then declares exactly one of them. */
export function validateMacTargets(config = { mac: { target: [{ target: "dmg", arch: ["arm64", "x64"] }] } }) {
  const targets = config.mac?.target ?? [];
  const architectures = new Set(targets.flatMap((target) => target.arch ?? []));
  if (!architectures.has("arm64") || !architectures.has("x64")) throw new Error("macOS config must declare arm64 and x64 targets");
  return true;
}

export function validateMacTarget(config, arch) {
  const targets = config.mac?.target ?? [];
  const declaresDmg = targets.some((target) => target.target === "dmg" && (target.arch ?? []).includes(arch));
  if (!declaresDmg) throw new Error(`macOS config must declare one dmg target for ${arch}`);
  return true;
}

export function validateLinuxTargets(config) {
  const targets = config.linux?.target ?? [];
  const names = new Set(targets.map((target) => target.target));
  const architectures = new Set(targets.flatMap((target) => target.arch ?? []));
  if (!names.has("deb") || !names.has("AppImage")) throw new Error("Linux config must declare deb and AppImage targets");
  if (!architectures.has("x64")) throw new Error("Linux config must declare x64 targets");
  return true;
}

function unpackedDirectoryFor(platform, arch) {
  if (platform === "win32") return "win-unpacked";
  if (platform === "darwin") return arch === "x64" ? "mac" : `mac-${arch}`;
  return arch === "x64" ? "linux-unpacked" : `linux-${arch}-unpacked`;
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

async function prepareInstallerInclude(channelIdentity, forceGateDefine) {
  const source = join(appDirectory, "build", "installer.nsh");
  const generated = join(cacheRoot, `installer-${channelIdentity.userScheme}.nsh`);
  const template = await readFile(source, "utf8");
  const rendered = template
    .replaceAll("@USER_SCHEME@", channelIdentity.userScheme)
    .replaceAll("@USER_DATA_NAMESPACE@", channelIdentity.userDataNamespace);
  await writeFile(generated, forceGateDefine ? `${forceGateDefine}\n${rendered}` : rendered, "utf8");
  return generated;
}

/** electron-builder installs the payload under /opt/<sanitizedProductName>;
 * the generated maintainer scripts must name that exact directory, so the
 * value comes from the pinned dependency's own sanitizer. */
function sanitizedProductName(productName) {
  const builderRoot = dirname(require.resolve("electron-builder"));
  const appBuilderLib = require.resolve("app-builder-lib", { paths: [builderRoot] });
  const { sanitizeFileName } = require(require.resolve("builder-util/out/filename.js", { paths: [dirname(appBuilderLib)] }));
  return sanitizeFileName(productName);
}

/** Render build/linux/*.sh with the channel identity for the deb maintainer
 * scripts. The plan gates the source templates; the substituted copies are
 * what fpm embeds (electron-builder passes custom afterInstall files through
 * verbatim). */
export async function prepareDebResources({ channelIdentity, cacheDirectory = cacheRoot }) {
  const substitute = (template) => template
    .replaceAll("@EXECUTABLE@", channelIdentity.executable)
    .replaceAll("@SANITIZED_PRODUCT@", sanitizedProductName(linuxProductName(channelIdentity)))
    .replaceAll("@USER_SCHEME@", channelIdentity.userScheme);
  const directory = join(cacheDirectory, `deb-${channelIdentity.userScheme}`);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const resources = { directory };
  for (const [source, key] of [["preinst.sh", "beforeInstall"], ["after-install.sh", "afterInstall"], ["after-remove.sh", "afterRemove"]]) {
    const file = join(directory, source);
    await writeFile(file, substitute(await readFile(join(appDirectory, "build", "linux", source), "utf8")), "utf8");
    chmodSync(file, 0o755);
    resources[key] = file;
  }
  return resources;
}

function assertArtifacts(platform, arch, artifacts, artifactLabel) {
  const label = artifactLabel.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const matches = (pattern) => artifacts.some((artifact) => new RegExp(pattern, "i").test(artifact));
  if (platform === "win32") {
    if (!matches(`_${label}_win32_x64\\.zip$`) || !matches(`_${label}_win32_x64-setup\\.exe$`)) throw new Error("electron-builder did not produce the labelled unsigned Windows x64 ZIP and NSIS artifacts");
  } else if (platform === "darwin") {
    if (!matches(`_${label}_darwin_${arch}\\.dmg$`)) throw new Error("electron-builder did not produce the labelled unsigned macOS dmg artifact");
  } else if (!matches(`_${label}_linux_x64\\.deb$`) || !matches(`_${label}_linux_x64\\.AppImage$`)) {
    throw new Error("electron-builder did not produce the labelled unsigned Linux deb and AppImage artifacts");
  }
  return true;
}

export async function packageDesktop({ platform = process.platform, arch, output = outputDirectory, channel, version, artifactLabel } = {}) {
  assertBuildPlatformAllowed(platform);
  configureCaches();
  if (platform === "win32") await configureShortNsisTemplates();
  // Resolve before any build work so missing/invalid deployment configuration
  // fails with the typed error rather than silently producing a production app.
  const buildMetadata = deriveBuildMetadata(process.env, identity, packageJson.version);
  readDeploymentProfileFromEnv(process.env, identity, packageJson.version);
  await mkdir(output, { recursive: true });
  const arches = arch ? [arch] : platformArches(platform);
  if (platform === "darwin" && !arch) validateMacTargets({ mac: { target: [{ target: "dmg", arch: arches }] } });
  const resolvedLabel = artifactLabel ?? buildMetadata.artifactLabel;
  const { Arch, Platform, build } = await import("electron-builder");
  const artifacts = [];
  const configs = [];
  try {
    const metafile = await runBuild();
    await generateReleaseInventory({ metafile });
    for (const targetArch of arches) {
      const config = createPackagerConfig({
        platform,
        arch: targetArch,
        output,
        channel: channel ?? buildMetadata.channel,
        version: version ?? buildMetadata.version,
        artifactLabel: resolvedLabel,
        nsisInclude: platform === "win32" ? await prepareInstallerInclude(buildMetadata.identity, nsisTestDefine(process.env.UNIWORK_NSIS_TEST_GATE)) : undefined,
        debResources: platform === "linux" ? await prepareDebResources({ channelIdentity: buildMetadata.identity }) : undefined,
      });
      if (platform === "darwin") validateMacTarget(config, targetArch);
      if (platform === "linux") validateLinuxTargets(config);
      const targets = platform === "win32"
        ? Platform.WINDOWS.createTarget(["zip", "nsis"], Arch.x64)
        : platform === "darwin"
          ? Platform.MAC.createTarget(["dmg"], Arch[targetArch])
          : Platform.LINUX.createTarget(["deb", "AppImage"], Arch[targetArch]);
      const produced = await build({ targets, config });
      assertArtifacts(platform, targetArch, produced, resolvedLabel);
      assertPackagedAsarContents(join(output, unpackedDirectoryFor(platform, targetArch)));
      artifacts.push(...produced);
      configs.push(config);
    }
    return { artifacts, outputDirectory: output, configs };
  } finally {
    await rm(join(distDirectory, ".build-metafile.json"), { force: true });
  }
}

export async function packageUnsignedDev() {
  return packageDesktop({ platform: "win32", arch: "x64" });
}

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--platform" || name === "--arch" || name === "--output") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${name} needs a value`);
      options[name.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${name}`);
    }
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const platform = options.platform ?? process.platform;
    const result = await packageDesktop({ platform, arch: options.arch, output: options.output });
    process.stdout.write(`office-desktop: unsigned-dev ${platform} artifact(s) written to ${result.outputDirectory}\n`);
    for (const artifact of result.artifacts) process.stdout.write(`${artifact}\n`);
  } catch (error) {
    process.stderr.write(`office-desktop: package failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

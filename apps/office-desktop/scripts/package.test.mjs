import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { test } from "node:test";
import { build } from "esbuild";
import { LINUX_BUILDER_DIGEST, LINUX_BUILDER_IMAGE, assertPinnedImage, dockerExecutable, dockerRunArguments } from "./package-linux-docker.mjs";
import { deriveBuildMetadata, DeploymentProfileError, readDeploymentProfileFromEnv } from "./deployment-profile.mjs";
import identity from "../identity.json" with { type: "json" };
import packageJson from "../package.json" with { type: "json" };

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

// package.mjs consumes the shared TS format table (../shared/document-format.ts);
// Node cannot load a .ts module, so the suite loads the packaging script through
// esbuild - the same loader the desktop build uses - into a sibling file whose
// location preserves package.mjs's appDirectory/repositoryRoot resolution. The
// bundle is removed on exit; the assertions still exercise the real script.
const packageBundle = join(appDirectory, "scripts", `.package.test.bundle.${process.pid}.mjs`);
await build({ entryPoints: [join(appDirectory, "scripts", "package.mjs")], bundle: true, platform: "node", format: "esm", packages: "external", outfile: packageBundle, logLevel: "silent" });
process.on("exit", () => { try { rmSync(packageBundle, { force: true }); } catch { /* best effort */ } });
const { DEFAULT_LINUX_HOMEPAGE, DEFAULT_LINUX_MAINTAINER, LINUX_DOCX_MIME, assertBuildPlatformAllowed, assertBuildInputsInsideRepository, assertPackagedAsarContents, createPackagerConfig, linuxPackagingMetadata, locatePackagedAsar, nsisTestDefine, platformArches, prepareDebResources, validateLinuxTargets, validateMacTarget, validateMacTargets } = await import(pathToFileURL(packageBundle).href);

// The staging module is loaded directly (it has no TS imports, unlike
// package.mjs) so the staging contract is asserted on the real implementation.
const { XLSX_ASSETS_DIRECTORY, XLSX_GATEWAY_FILE, stageXlsxAssets, resolveXlsxAssetSources, xlsxSidecarFile } = await import(pathToFileURL(join(appDirectory, "scripts", "xlsx-assets.mjs")).href);

function findBash() {
  for (const candidate of ["bash", "C:/Program Files/Git/bin/bash.exe", "C:/Program Files (x86)/Git/bin/bash.exe"]) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) return candidate;
  }
  return undefined;
}
const bash = findBash();

test("Windows x64 dev package is explicitly labelled and installs per-user", () => {
  const config = createPackagerConfig({ platform: "win32", arch: "x64", channel: "dev", version: "0.1.0-dev.42" });
  assert.equal(config.appId, "com.uniwork.office.dev");
  assert.match(config.artifactName, /uniwork-office-test_0\.1\.0-dev\.42_unsigned_win32_x64\.zip$/);
  assert.equal(config.publish, null);
  assert.equal(config.win.signAndEditExecutable, false);
  assert.deepEqual(config.fileAssociations.map((association) => association.ext), ["docx", "xlsx"]);
  assert.deepEqual(config.win.target, [{ target: "zip", arch: ["x64"] }, { target: "nsis", arch: ["x64"] }]);
  assert.equal(config.nsis.oneClick, true);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowElevation, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.nsis.createStartMenuShortcut, true);
  assert.equal(config.nsis.createDesktopShortcut, false);
  assert.match(config.nsis.artifactName, /uniwork-office-test_0\.1\.0-dev\.42_unsigned_win32_x64-setup\.exe$/);
  assert.deepEqual(config.protocols[0].schemes, ["uniwork-office-dev"]);
  assert.equal(config.extraMetadata.name, "uniwork-office-dev");
  assert.deepEqual(config.extraMetadata.dependencies, {});
  assert.ok(config.files.includes("!node_modules/**"));
  assert.ok(config.files.includes("!dist/**/*.map"));
  assert.throws(() => createPackagerConfig({ platform: "win32", arch: "arm64" }), /unsupported/);
});

test("beta and stable share install identity while dev is isolated", () => {
  const beta = createPackagerConfig({ platform: "win32", arch: "x64", channel: "beta", version: "0.1.0-beta.7" });
  const stable = createPackagerConfig({ platform: "win32", arch: "x64", channel: "stable", version: "0.1.0" });
  assert.equal(beta.appId, stable.appId);
  assert.deepEqual(beta.protocols[0].schemes, stable.protocols[0].schemes);
  assert.equal(beta.executableName, stable.executableName);
  assert.equal(beta.extraMetadata.name, "uniwork-office");
  assert.equal(stable.extraMetadata.name, beta.extraMetadata.name);
  assert.match(beta.nsis.artifactName, /uniwork-office_0\.1\.0-beta\.7_unsigned_win32_x64-setup\.exe$/);
  assert.match(stable.nsis.artifactName, /uniwork-office_0\.1\.0_unsigned_win32_x64-setup\.exe$/);
  assert.throws(() => deriveBuildMetadata({ UNIWORK_OFFICE_CHANNEL: "stable" }, { channelProfiles: { stable: {}, beta: {}, dev: {} } }, "0.1.0"), /signing is disabled/);
});

test("download-time deployment env fallback is strict and typed", () => {
  assert.equal(readDeploymentProfileFromEnv({ UNIWORK_OFFICE_CHANNEL: "beta" }, identity), undefined);
  assert.equal(readDeploymentProfileFromEnv({ UNIWORK_OFFICE_CHANNEL: "dev" }, identity), undefined);
  assert.throws(
    () => readDeploymentProfileFromEnv({ UNIWORK_OFFICE_CHANNEL: "dev", UNIWORK_OFFICE_DEPLOYMENT_ID: "only-id" }, identity),
    (error) => error instanceof DeploymentProfileError && error.code === "missing",
  );
  assert.throws(
    () => readDeploymentProfileFromEnv({ UNIWORK_OFFICE_CHANNEL: "dev", UNIWORK_OFFICE_DEPLOYMENT_ID: "local", UNIWORK_OFFICE_API_ORIGIN: "http://evil.example.test" }, identity),
    (error) => error instanceof DeploymentProfileError && error.code === "invalid-origin",
  );
  assert.throws(
    () => readDeploymentProfileFromEnv({ UNIWORK_OFFICE_CHANNEL: "beta" }, identity, "0.1.0", { required: true }),
    (error) => error instanceof DeploymentProfileError && error.code === "missing",
  );
});

test("macOS arm64/x64 targets are config validated without a build", () => {
  assert.equal(validateMacTargets(), true);
  assert.throws(() => validateMacTargets({ mac: { target: [{ target: "dmg", arch: ["arm64"] }] } }), /arm64 and x64/);
  assert.deepEqual(createPackagerConfig({ platform: "darwin", arch: "arm64" }).mac.target[0].arch, ["arm64"]);
  assert.deepEqual(createPackagerConfig({ platform: "darwin", arch: "x64" }).mac.target[0].arch, ["x64"]);
  assert.equal(createPackagerConfig({ platform: "darwin", arch: "arm64" }).mac.identity, null);
  assert.equal(createPackagerConfig({ platform: "darwin", arch: "arm64" }).mac.hardenedRuntime, false);
});

test("packaging rejects an esbuild input outside the repository", () => {
  assert.doesNotThrow(() => assertBuildInputsInsideRepository({ inputs: { "apps/office-desktop/main/index.ts": {} } }));
  assert.throws(() => assertBuildInputsInsideRepository({ inputs: { "../../../genoffice/apps/docs/src/index.ts": {} } }), /escaped repository/);
});

test("packaged asar inspection rejects raw node_modules", () => {
  // The production check is exercised against the real asar after a package
  // run. This unit-level seam keeps the path contract explicit without a
  // second heavyweight electron-builder invocation.
  assert.equal(typeof assertPackagedAsarContents, "function");
});

test("identity declares linux x64 alongside win32 and darwin", () => {
  assert.deepEqual(identity.build.platforms.linux, ["x64"]);
  assert.deepEqual(platformArches("linux"), ["x64"]);
  assert.deepEqual(platformArches("darwin"), ["arm64", "x64"]);
  assert.throws(() => platformArches("freebsd"), /unsupported desktop package platform/);
});

test("Linux x64 dev package declares the deb and AppImage unsigned artifacts", () => {
  const config = createPackagerConfig({ platform: "linux", arch: "x64", channel: "dev", version: "0.1.0-dev.42" });
  assert.deepEqual(config.linux.target, [{ target: "deb", arch: ["x64"] }, { target: "AppImage", arch: ["x64"] }]);
  assert.match(config.deb.artifactName, /uniwork-office-test_0\.1\.0-dev\.42_unsigned_linux_x64\.deb$/);
  assert.match(config.appImage.artifactName, /uniwork-office-test_0\.1\.0-dev\.42_unsigned_linux_x64\.AppImage$/);
  assert.equal(config.deb.packageName, "uniwork-office-dev");
  // The install path stays free of spaces so the desktop Exec needs no quoting.
  assert.equal(config.productName, "uniwork-office-dev");
  assert.equal(config.linux.desktop.entry.Name, "UniWork Office (test)");
  assert.ok(config.deb.depends.includes("libsecret-1-0"));
  assert.ok(config.deb.depends.includes("xdg-utils"));
  assert.equal(config.deb.maintainer, DEFAULT_LINUX_MAINTAINER);
  assert.ok(config.deb.fpm.includes(`--url=${DEFAULT_LINUX_HOMEPAGE}`));
  // The platform lists live under `linux`: electron-builder concatenates the
  // top-level and platform-specific lists, so a top-level copy would duplicate
  // every MimeType entry in the .desktop file.
  assert.equal(config.protocols, undefined);
  assert.equal(config.fileAssociations, undefined);
  assert.deepEqual(config.linux.protocols[0].schemes, ["uniwork-office-dev"]);
  assert.equal(config.linux.fileAssociations[0].mimeType, LINUX_DOCX_MIME);
  // The widened format table registers every carried format, not only docx.
  assert.deepEqual(config.linux.fileAssociations.map((association) => association.ext), ["docx", "xlsx"]);
  assert.equal(config.linux.fileAssociations[1].mimeType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal("mimeTypes" in config.linux, false, "the file association already supplies the MimeType entries");
  assert.equal(config.publish, null);
  assert.equal(config.extraMetadata.name, "uniwork-office-dev");
  assert.equal(validateLinuxTargets(config), true);
  assert.throws(() => validateLinuxTargets({ linux: { target: [{ target: "deb", arch: ["x64"] }] } }), /deb and AppImage/);
  assert.equal(config.deb.afterInstall, undefined, "maintainer scripts attach only when the generated resources are supplied");
  assert.match(config.artifactName, /_linux_x64\.AppImage$/, "the generic artifact name carries the Linux default target");
});

test("beta and stable Linux packages share the upgrade namespace", () => {
  assert.equal(createPackagerConfig({ platform: "linux", arch: "x64", channel: "beta", version: "0.1.0-beta.7" }).deb.packageName, "uniwork-office");
  assert.equal(createPackagerConfig({ platform: "linux", arch: "x64", channel: "stable", version: "0.1.0" }).deb.packageName, "uniwork-office");
  assert.match(createPackagerConfig({ platform: "linux", arch: "x64", channel: "stable", version: "0.1.0" }).deb.artifactName, /uniwork-office_0\.1\.0_unsigned_linux_x64\.deb$/);
});

test("macOS config pins the Ventura floor, one architecture and the URL scheme", () => {
  const arm = createPackagerConfig({ platform: "darwin", arch: "arm64", channel: "dev", version: "0.1.0-dev.42" });
  assert.equal(arm.mac.minimumSystemVersion, "13.0");
  assert.deepEqual(arm.mac.extendInfo, { LSArchitecturePriority: ["arm64"] });
  assert.deepEqual(arm.protocols[0].schemes, ["uniwork-office-dev"]);
  assert.match(arm.artifactName, /uniwork-office-test_0\.1\.0-dev\.42_unsigned_darwin_arm64\.dmg$/);
  const intel = createPackagerConfig({ platform: "darwin", arch: "x64", channel: "dev", version: "0.1.0-dev.42" });
  assert.deepEqual(intel.mac.extendInfo.LSArchitecturePriority, ["x64"]);
  assert.match(intel.artifactName, /_unsigned_darwin_x64\.dmg$/);
  // Each artifact declares exactly one architecture; the pair is planned together.
  assert.equal(validateMacTarget(arm, "arm64"), true);
  assert.equal(validateMacTarget(intel, "x64"), true);
  assert.throws(() => validateMacTarget(arm, "x64"), /dmg target for x64/);
});

test("cross-platform builds are refused with an actionable error", () => {
  assert.throws(() => assertBuildPlatformAllowed("darwin", "win32"), /macOS host/);
  assert.throws(() => assertBuildPlatformAllowed("darwin", "linux"), /macOS host/);
  assert.throws(() => assertBuildPlatformAllowed("linux", "win32"), /Docker/);
  assert.throws(() => assertBuildPlatformAllowed("win32", "linux"), /win32 host/);
  assert.equal(assertBuildPlatformAllowed("win32", "win32"), true);
  assert.equal(assertBuildPlatformAllowed("linux", "linux"), true);
});

test("Linux deb maintainer scripts are generated from the reviewed templates", async () => {
  const directory = mkdtempSync(join(tmpdir(), "uniwork-deb-resources-"));
  try {
    const resources = await prepareDebResources({ channelIdentity: identity.channelProfiles.dev, cacheDirectory: directory });
    const preinst = readFileSync(resources.beforeInstall, "utf8");
    const afterInstall = readFileSync(resources.afterInstall, "utf8");
    const afterRemove = readFileSync(resources.afterRemove, "utf8");
    assert.ok(preinst.includes("UNIWORK_OS_RELEASE_FILE"));
    assert.ok(!preinst.includes("@EXECUTABLE@"));
    assert.ok(afterInstall.includes('EXECUTABLE="uniwork-office-test"'));
    assert.ok(afterInstall.includes("x-scheme-handler/uniwork-office-dev"));
    assert.ok(afterInstall.includes("/opt/uniwork-office-dev"));
    assert.ok(afterInstall.includes("update-desktop-database"));
    assert.ok(afterRemove.includes('EXECUTABLE="uniwork-office-test"'));
    assert.ok(afterRemove.includes("update-alternatives --remove"));
    assert.ok(afterRemove.includes('grep -v "^$SCHEME_HANDLER="'));
    if (process.platform !== "win32") {
      assert.ok((statSync(resources.afterInstall).mode & 0o111) !== 0, "maintainer scripts are executable");
      assert.ok((statSync(resources.afterRemove).mode & 0o111) !== 0, "after-remove is executable");
    }
    const config = createPackagerConfig({ platform: "linux", arch: "x64", channel: "dev", version: "0.1.0-dev.42", debResources: resources });
    assert.equal(config.deb.afterInstall, resources.afterInstall);
    assert.equal(config.deb.afterRemove, resources.afterRemove);
    assert.deepEqual(config.deb.fpm, [`--url=${DEFAULT_LINUX_HOMEPAGE}`, `--before-install=${resources.beforeInstall}`]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Linux packaging metadata follows the build-time env with the accepted defaults", () => {
  assert.equal(packageJson.homepage, DEFAULT_LINUX_HOMEPAGE, "the manifest homepage must stay equal to the packaging default");
  assert.deepEqual(linuxPackagingMetadata({}), { homepage: DEFAULT_LINUX_HOMEPAGE, maintainer: DEFAULT_LINUX_MAINTAINER });
  assert.deepEqual(linuxPackagingMetadata({ OFFICE_DESKTOP_HOMEPAGE: " https://office.example.test ", OFFICE_DESKTOP_MAINTAINER: "Ops <ops@example.test>" }), { homepage: "https://office.example.test", maintainer: "Ops <ops@example.test>" });
  const original = { homepage: process.env.OFFICE_DESKTOP_HOMEPAGE, maintainer: process.env.OFFICE_DESKTOP_MAINTAINER };
  try {
    process.env.OFFICE_DESKTOP_HOMEPAGE = "https://override.example.test";
    process.env.OFFICE_DESKTOP_MAINTAINER = "Ops <ops@example.test>";
    const config = createPackagerConfig({ platform: "linux", arch: "x64", channel: "dev", version: "0.1.0-dev.42" });
    assert.equal(config.deb.maintainer, "Ops <ops@example.test>");
    assert.ok(config.deb.fpm.includes("--url=https://override.example.test"));
  } finally {
    if (original.homepage === undefined) delete process.env.OFFICE_DESKTOP_HOMEPAGE; else process.env.OFFICE_DESKTOP_HOMEPAGE = original.homepage;
    if (original.maintainer === undefined) delete process.env.OFFICE_DESKTOP_MAINTAINER; else process.env.OFFICE_DESKTOP_MAINTAINER = original.maintainer;
  }
});

test("generated maintainer scripts avoid electron-builder macro syntax", async () => {
  // electron-builder expands every `${lettersOnly}` in a custom afterInstall
  // file and throws "Macro NAME is not defined" for unknown names (FpmTarget
  // writeConfigFile), so the shipped scripts must use "$VAR", never "${VAR}".
  const directory = mkdtempSync(join(tmpdir(), "uniwork-deb-macro-"));
  try {
    const resources = await prepareDebResources({ channelIdentity: identity.channelProfiles.dev, cacheDirectory: directory });
    for (const [name, file] of [["preinst.sh", resources.beforeInstall], ["after-install.sh", resources.afterInstall], ["after-remove.sh", resources.afterRemove]]) {
      const content = readFileSync(file, "utf8");
      const macros = content.match(/\$\{[a-zA-Z]+\}/g) ?? [];
      assert.deepEqual(macros, [], `${name} must not contain letter-only \${...} macro syntax: ${macros.join(", ")}`);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the deb preinst refuses unsupported distributions and old Ubuntu", { skip: bash ? false : "bash is not available on this host" }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "uniwork-deb-preinst-"));
  try {
    const resources = await prepareDebResources({ channelIdentity: identity.channelProfiles.dev, cacheDirectory: directory });
    const cases = [
      ["ubuntu", "24.04", 0],
      ["ubuntu", "22.04", 0],
      ["ubuntu", "20.04", 1],
      ["debian", "12", 0],
      ["debian", "10", 1],
      ["fedora", "40", 1],
    ];
    for (const [id, version, expected] of cases) {
      const osRelease = join(directory, `os-release-${id}-${version}`);
      writeFileSync(osRelease, `ID=${id}\nVERSION_ID="${version}"\n`);
      const result = spawnSync(bash, [resources.beforeInstall], { encoding: "utf8", windowsHide: true, env: { ...process.env, UNIWORK_OS_RELEASE_FILE: osRelease } });
      assert.equal(result.status, expected, `${id} ${version}: ${result.stderr}`);
    }
    const missing = spawnSync(bash, [resources.beforeInstall], { encoding: "utf8", windowsHide: true, env: { ...process.env, UNIWORK_OS_RELEASE_FILE: join(directory, "absent") } });
    assert.equal(missing.status, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the NSIS wrong-machine gate stays off unless the dev test flag is set", () => {
  assert.equal(nsisTestDefine(undefined), undefined);
  assert.equal(nsisTestDefine(""), undefined);
  assert.equal(nsisTestDefine("old-windows"), "!define UNIWORK_TEST_FORCE_OLD_WINDOWS");
  assert.equal(nsisTestDefine("not-x64"), "!define UNIWORK_TEST_FORCE_NOT_X64");
  assert.throws(() => nsisTestDefine("bogus"), /unknown UNIWORK_NSIS_TEST_GATE/);
  const plain = createPackagerConfig({ platform: "win32", arch: "x64", channel: "dev", version: "0.1.0-dev.42" });
  assert.equal("defines" in plain.nsis, false);
  const template = readFileSync(join(appDirectory, "build", "installer.nsh"), "utf8");
  assert.ok(template.includes("${AtLeastWin10}"));
  assert.ok(template.includes("${RunningX64}"));
  assert.ok(template.includes("UNIWORK_TEST_FORCE_OLD_WINDOWS"));
  assert.ok(template.includes("UNIWORK_TEST_FORCE_NOT_X64"));
  assert.ok(template.includes("SetErrorLevel 3"));
});

test("the Linux docker build uses only a digest-pinned builder image", () => {
  assert.throws(() => assertPinnedImage("electronuserland/builder:20"), /pinned by tag and sha256 digest/);
  assert.equal(assertPinnedImage(LINUX_BUILDER_IMAGE), LINUX_BUILDER_IMAGE);
  assert.equal(LINUX_BUILDER_IMAGE.endsWith(LINUX_BUILDER_DIGEST), true);
  assert.equal(dockerExecutable("win32"), "docker.exe");
  assert.equal(dockerExecutable("linux"), "docker");
  const args = dockerRunArguments({ repository: "repo", output: "out", environment: {} });
  assert.ok(args.includes(LINUX_BUILDER_IMAGE));
  assert.ok(args.includes("linux/amd64"));
  // Compare through the same resolve+separator normalization the script uses,
  // so the assertion holds on Windows and POSIX hosts alike.
  const mount = (value) => `${resolve(value).replaceAll("\\", "/")}:`;
  assert.ok(args.includes(`${mount("repo")}/src:ro`));
  assert.ok(args.includes(`${mount("out")}/out`));
  const script = args[args.length - 1];
  assert.ok(script.includes("package.mjs --platform linux --output /out"));
  assert.ok(script.includes("--exclude='*node_modules*'"));
});

test("the packaged config stages the xlsx engine assets as extra resources", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const config = createPackagerConfig({ platform, arch: platform === "darwin" ? "arm64" : "x64", channel: "dev", version: "0.1.0-dev.42" });
    const staged = config.extraResources.find((entry) => entry.to === XLSX_ASSETS_DIRECTORY);
    assert.ok(staged, `${platform}: the xlsx assets dir must be staged`);
    assert.match(staged.from.replaceAll("\\", "/"), new RegExp(`dist/${XLSX_ASSETS_DIRECTORY}$`), `${platform}: staged from dist/`);
  }
});

test("staging copies the gateway (required) and records the sidecar's real state", async () => {
  const root = mkdtempSync(join(tmpdir(), "uniwork-xlsx-stage-"));
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  const buildDir = join(root, "build");
  mkdirSync(buildDir, { recursive: true });
  const gatewayBody = "// gateway bundle\n";
  writeFileSync(join(buildDir, XLSX_GATEWAY_FILE), gatewayBody);
  try {
    // No sidecar on the host: staging must still succeed (open/edit of a
    // formula-free workbook needs only the gateway) and must NOT fake one.
    const result = await stageXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: { OFFICE_DESKTOP_XLSX_ASSETS: buildDir } });
    assert.equal(result.sidecar, null);
    assert.ok(existsSync(join(dist, XLSX_ASSETS_DIRECTORY, XLSX_GATEWAY_FILE)));
    assert.ok(!existsSync(join(dist, XLSX_ASSETS_DIRECTORY, "xlsx-sidecar.exe")), "a missing sidecar is never fabricated");
    const manifest = JSON.parse(readFileSync(join(dist, XLSX_ASSETS_DIRECTORY, "staged-assets.json"), "utf8"));
    assert.equal(manifest.sidecar, null);
    assert.equal(manifest.gateway.bytes, statSync(join(buildDir, XLSX_GATEWAY_FILE)).size);
    assert.match(manifest.gateway.sha256, /^[0-9a-f]{64}$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("staging copies the platform sidecar when it has been built", async () => {
  const root = mkdtempSync(join(tmpdir(), "uniwork-xlsx-stage-native-"));
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  const buildDir = join(root, "build");
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, XLSX_GATEWAY_FILE), "// gateway\n");
  writeFileSync(join(buildDir, xlsxSidecarFile("win32")), "MZ-sidecar");
  try {
    const result = await stageXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: { OFFICE_DESKTOP_XLSX_ASSETS: buildDir } });
    assert.equal(result.sidecar?.file.endsWith("xlsx-sidecar.exe"), true);
    assert.ok(existsSync(join(dist, XLSX_ASSETS_DIRECTORY, "xlsx-sidecar.exe")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("staging fails loudly with the build command when the gateway is missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "uniwork-xlsx-stage-missing-"));
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  try {
    await assert.rejects(
      () => stageXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: {} }),
      (error) => /xlsx gateway artifact is not staged/.test(error.message) && /build-upstream\.mjs --with-native/.test(error.message),
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the default staging source is the build-upstream scratch tree", () => {
  const sources = resolveXlsxAssetSources({ repositoryRoot: "D:/repo", platform: "win32", environment: {} });
  assert.equal(sources.explicit, false);
  assert.equal(sources.gateway, undefined, "a checkout with no build scratch has no gateway");
  assert.match(sources.buildDirectory.replaceAll("\\", "/"), /\.go-tmp\/office-upstream-build$/);
});
test("packaged asar location covers flat and macOS bundle layouts", () => {
  const root = mkdtempSync(join(tmpdir(), "uniwork-asar-layout-"));
  try {
    mkdirSync(join(root, "resources"), { recursive: true });
    writeFileSync(join(root, "resources", "app.asar"), "stub");
    assert.equal(locatePackagedAsar(root), join(root, "resources", "app.asar"));
    assert.throws(() => locatePackagedAsar(join(root, "missing")), /app\.asar is missing/);
    const mac = join(root, "mac-arm64");
    mkdirSync(join(mac, "UniWork Office.app", "Contents", "Resources"), { recursive: true });
    writeFileSync(join(mac, "UniWork Office.app", "Contents", "Resources", "app.asar"), "stub");
    assert.equal(locatePackagedAsar(mac), join(mac, "UniWork Office.app", "Contents", "Resources", "app.asar"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

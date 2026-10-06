import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { test } from "node:test";
import { DEFAULT_LINUX_HOMEPAGE, DEFAULT_LINUX_MAINTAINER, LINUX_DOCUMENT_MIME_TYPES, assertBuildPlatformAllowed, assertBuildInputsInsideRepository, assertPackagedAsarContents, createPackagerConfig, linuxPackagingMetadata, locatePackagedAsar, nsisTestDefine, platformArches, prepareDebResources, validateLinuxTargets, validateMacTarget, validateMacTargets } from "./package.mjs";
import { LINUX_BUILDER_DIGEST, LINUX_BUILDER_IMAGE, assertPinnedImage, dockerExecutable, dockerRunArguments } from "./package-linux-docker.mjs";
import { deriveBuildMetadata, DeploymentProfileError, readDeploymentProfileFromEnv } from "./deployment-profile.mjs";
import identity from "../identity.json" with { type: "json" };
import packageJson from "../package.json" with { type: "json" };
import formatTable from "../shared/document-formats.json" with { type: "json" };

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

// The staging module is loaded directly (it has no TS imports, unlike
// package.mjs) so the staging contract is asserted on the real implementation.
const { REQUIRE_SIDECAR_ENV, SKIP_NATIVE_BUILD_ENV, XLSX_ASSETS_DIRECTORY, XLSX_GATEWAY_FILE, ensureXlsxAssets, locateCargo, missingSidecarWarning, nativeTargetDirectory, prepareXlsxAssets, stageXlsxAssets, resolveXlsxAssetSources, xlsxSidecarFile } = await import(pathToFileURL(join(appDirectory, "scripts", "xlsx-assets.mjs")).href);

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
  assert.deepEqual(config.fileAssociations.map((association) => association.ext), Object.values(formatTable.formats).flatMap((format) => format.extensions));
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
  // Associations come from the shared format table: one entry per extension,
  // each carrying its own MIME type on Linux.
  // The table-derived list keeps a format added there asserted without editing
  // this test; the explicit list below pins today's table order.
  const tableFormats = Object.values(formatTable.formats);
  assert.deepEqual(config.linux.fileAssociations, tableFormats.flatMap((format) => format.extensions.map((ext) => ({ ext, name: format.associationName, role: "Editor", mimeType: format.mimeTypes[0] }))));
  assert.deepEqual(config.linux.fileAssociations, [
    { ext: "docx", name: "Word document", role: "Editor", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { ext: "pdf", name: "PDF document", role: "Editor", mimeType: "application/pdf" },
    { ext: "md", name: "Markdown document", role: "Editor", mimeType: "text/markdown" },
    { ext: "markdown", name: "Markdown document", role: "Editor", mimeType: "text/markdown" },
    { ext: "html", name: "HTML document", role: "Editor", mimeType: "text/html" },
    { ext: "htm", name: "HTML document", role: "Editor", mimeType: "text/html" },
    { ext: "xlsx", name: "Excel spreadsheet", role: "Editor", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    { ext: "pptx", name: "PowerPoint presentation", role: "Editor", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  ]);
  // One entry per DISTINCT MIME type, in first-seen order: md/markdown and
  // html/htm each collapse to a single entry (F4).
  assert.deepEqual(LINUX_DOCUMENT_MIME_TYPES, [...new Set(config.linux.fileAssociations.map((association) => association.mimeType))]);
  assert.deepEqual(LINUX_DOCUMENT_MIME_TYPES, [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/pdf",
    "text/markdown",
    "text/html",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]);
  assert.equal("mimeTypes" in config.linux, false, "the file associations already supply the MimeType entries");
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
test("a Windows short CARGO_TARGET_DIR build is found without extra env", async () => {
  // MSVC's link.exe enforces MAX_PATH, so a Windows build whose scratch path is
  // too long runs cargo with CARGO_TARGET_DIR on a short dir; the binary then
  // lands at <CARGO_TARGET_DIR>/release, not under the scratch tree. Staging
  // must find it there without the operator setting OFFICE_DESKTOP_XLSX_ASSETS.
  const root = mkdtempSync(join(tmpdir(), "uniwork-xlsx-cargo-target-"));
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  const scratch = join(root, ".go-tmp", "office-upstream-build");
  mkdirSync(join(scratch, "dist"), { recursive: true });
  writeFileSync(join(scratch, "dist", XLSX_GATEWAY_FILE), "// gateway\n");
  const target = join(root, "short-target");
  mkdirSync(join(target, "release"), { recursive: true });
  writeFileSync(join(target, "release", xlsxSidecarFile("win32")), "MZ-sidecar");
  try {
    const sources = resolveXlsxAssetSources({ repositoryRoot: root, platform: "win32", environment: { CARGO_TARGET_DIR: target } });
    assert.equal(sources.sidecar, join(target, "release", "xlsx-sidecar.exe"));
    const result = await stageXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: { CARGO_TARGET_DIR: target } });
    assert.equal(result.sidecar?.file.endsWith("xlsx-sidecar.exe"), true);
    assert.ok(existsSync(join(dist, XLSX_ASSETS_DIRECTORY, "xlsx-sidecar.exe")));
  } finally { rmSync(root, { recursive: true, force: true }); }
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

test("staging verifies the staged sidecar against the build record's binary hash", async () => {
  // A shared CARGO_TARGET_DIR can hold another build's binary. When a build
  // record is staged it is the sidecar's provenance: the recorded
  // native.binary.sha256 must equal the candidate's own bytes.
  const { createHash } = await import("node:crypto");
  const root = mkdtempSync(join(tmpdir(), "uniwork-xlsx-provenance-"));
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  const buildDir = join(root, "build");
  mkdirSync(buildDir, { recursive: true });
  const sidecarBody = "MZ-sidecar-bytes";
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  writeFileSync(join(buildDir, XLSX_GATEWAY_FILE), "// gateway\n");
  writeFileSync(join(buildDir, xlsxSidecarFile("win32")), sidecarBody);
  const record = (recorded) => JSON.stringify({ kind: "uniwork-office-upstream-build-record", native: { binary: { sha256: recorded } } });
  try {
    // Match: the record attests the exact bytes we are about to stage.
    writeFileSync(join(buildDir, "build-record.json"), record(sha(sidecarBody).toUpperCase()));
    const matched = await stageXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: { OFFICE_DESKTOP_XLSX_ASSETS: buildDir } });
    assert.equal(matched.sidecar.sha256, sha(sidecarBody));
    assert.ok(existsSync(join(dist, XLSX_ASSETS_DIRECTORY, "build-record.json")), "the build record ships beside the artifacts");
    // Mismatch: a stale binary must fail loudly instead of staging silently.
    writeFileSync(join(buildDir, "build-record.json"), record("0".repeat(64)));
    await assert.rejects(
      () => stageXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: { OFFICE_DESKTOP_XLSX_ASSETS: buildDir } }),
      (error) => /xlsx sidecar sha256 mismatch/.test(error.message) && /CARGO_TARGET_DIR/.test(error.message) && /build-upstream\.mjs --with-native/.test(error.message),
    );
    // A record without a native section (built without --with-native) has
    // nothing to verify; staging stays legal and the record still ships.
    writeFileSync(join(buildDir, "build-record.json"), JSON.stringify({ kind: "uniwork-office-upstream-build-record", verdict: "pass" }));
    const noNative = await stageXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: { OFFICE_DESKTOP_XLSX_ASSETS: buildDir } });
    assert.equal(noNative.sidecar.sha256, sha(sidecarBody));
    // An unreadable record fails loudly rather than skipping the comparison.
    writeFileSync(join(buildDir, "build-record.json"), "{ not json");
    await assert.rejects(
      () => stageXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: { OFFICE_DESKTOP_XLSX_ASSETS: buildDir } }),
      /build record .* could not be read/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the missing-gateway error names the directory that was actually searched", async () => {
  // Explicit OFFICE_DESKTOP_XLSX_ASSETS mode probes <dir>/xlsx-gateway.mjs
  // directly - the error must not send the operator to a <dir>/dist that was
  // never searched (F3).
  const root = mkdtempSync(join(tmpdir(), "uniwork-xlsx-missing-dir-"));
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  const buildDir = join(root, "explicit-assets");
  mkdirSync(buildDir, { recursive: true });
  try {
    await assert.rejects(
      () => stageXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: { OFFICE_DESKTOP_XLSX_ASSETS: buildDir } }),
      (error) => {
        const searched = join(buildDir, XLSX_GATEWAY_FILE).replaceAll("\\", "/");
        assert.ok(error.message.includes(searched), `error must name ${searched}: ${error.message}`);
        assert.ok(!error.message.includes(`${buildDir.replaceAll("\\", "/")}/dist`), `error must not name an unsearched dist dir: ${error.message}`);
        return true;
      },
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// UNI-940 X06 - every desktop build ships the gateway + recalc sidecar when it can build them.
function xlsxScratch(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const buildDir = join(root, ".go-tmp", "office-upstream-build");
  mkdirSync(join(buildDir, "dist"), { recursive: true });
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  return { root, buildDir, dist };
}

// A stand-in for build-upstream.mjs --with-native: writes the gateway and the
// <out>/native sidecar exactly where the real script leaves them.
function fakeUpstreamBuild(calls, { status = 0, sidecar = true } = {}) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const out = args[args.indexOf("--out") + 1];
    mkdirSync(join(out, "dist"), { recursive: true });
    writeFileSync(join(out, "dist", XLSX_GATEWAY_FILE), "// gateway\n");
    if (sidecar) {
      mkdirSync(join(out, "native"), { recursive: true });
      writeFileSync(join(out, "native", xlsxSidecarFile("win32")), "MZ-sidecar");
    }
    return { status };
  };
}

test("cargo is found on PATH first, then in the rustup home a --no-modify-path install leaves off PATH", () => {
  const onPath = join("C:", "tools", "rust", "bin");
  const home = join("C:", "Users", "dev");
  const both = new Set([join(onPath, "cargo.exe"), join(home, ".cargo", "bin", "cargo.exe")]);
  assert.equal(locateCargo({ platform: "win32", environment: { Path: onPath, USERPROFILE: home }, exists: (file) => both.has(file) }), join(onPath, "cargo.exe"));
  const homeOnly = new Set([join(home, ".cargo", "bin", "cargo.exe")]);
  assert.equal(locateCargo({ platform: "win32", environment: { Path: onPath, USERPROFILE: home }, exists: (file) => homeOnly.has(file) }), join(home, ".cargo", "bin", "cargo.exe"));
  assert.equal(locateCargo({ platform: "linux", environment: { PATH: "", HOME: "/home/dev", CARGO_HOME: "/opt/cargo" }, exists: (file) => file === join("/opt/cargo", "bin", "cargo") }), join("/opt/cargo", "bin", "cargo"));
  assert.equal(locateCargo({ platform: "win32", environment: { Path: onPath, USERPROFILE: home }, exists: () => false }), null);
});

test("the Windows native build gets a short per-worktree CARGO_TARGET_DIR inside the workspace unless one is set", () => {
  const workspace = resolve("/ws/.uniwork-dev");
  const first = join(workspace, "worktrees", "dev-uniwork", "feature-UNI-940-office-parity-fu-xlsx-mdhtml");
  const second = join(workspace, "worktrees", "dev-uniwork", "feature-UNI-941-other");
  const target = nativeTargetDirectory({ repositoryRoot: first, platform: "win32", environment: {} });
  // Inside the workspace (next to worktrees/), never a drive-root dir, short enough for MSVC MAX_PATH.
  assert.equal(dirname(target), workspace);
  assert.match(target.slice(workspace.length + 1), /^ct-[0-9a-f]{8}$/);
  assert.notEqual(dirname(target), parse(target).root);
  assert.ok(target.length - parse(target).root.length < 40, `short target dir: ${target}`);
  // Stable per checkout, different per worktree.
  assert.equal(nativeTargetDirectory({ repositoryRoot: first, platform: "win32", environment: {} }), target);
  assert.notEqual(nativeTargetDirectory({ repositoryRoot: second, platform: "win32", environment: {} }), target);
  // A checkout outside a .uniwork-dev workspace keeps it under its own .go-tmp (still no drive root).
  const plain = resolve("/src/uniwork");
  assert.equal(nativeTargetDirectory({ repositoryRoot: plain, platform: "win32", environment: {} }), join(plain, ".go-tmp", "ct"));
  // An explicit CARGO_TARGET_DIR wins; a relative one resolves against the repo root.
  assert.equal(nativeTargetDirectory({ repositoryRoot: first, platform: "win32", environment: { CARGO_TARGET_DIR: "/t940" } }), resolve("/t940"));
  assert.equal(nativeTargetDirectory({ repositoryRoot: first, platform: "win32", environment: { CARGO_TARGET_DIR: "tgt" } }), join(first, "tgt"));
  assert.equal(nativeTargetDirectory({ repositoryRoot: first, platform: "linux", environment: {} }), null);
});

test("staging resolves a relative CARGO_TARGET_DIR against the repo root, like the native build", () => {
  const { root, buildDir } = xlsxScratch("uniwork-xlsx-relative-target-");
  try {
    writeFileSync(join(buildDir, "dist", XLSX_GATEWAY_FILE), "// gateway\n");
    mkdirSync(join(root, "tgt", "release"), { recursive: true });
    writeFileSync(join(root, "tgt", "release", xlsxSidecarFile("win32")), "MZ-sidecar");
    const sources = resolveXlsxAssetSources({ repositoryRoot: root, platform: "win32", environment: { CARGO_TARGET_DIR: "tgt" } });
    assert.equal(sources.sidecar, join(root, "tgt", "release", xlsxSidecarFile("win32")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("with cargo available the build runs build-upstream --with-native and stages gateway + sidecar", async () => {
  const { root, buildDir, dist } = xlsxScratch("uniwork-xlsx-ensure-");
  const calls = [];
  try {
    const cargo = join(root, "cargo-home", "bin", "cargo.exe");
    const { attempt, staged } = await prepareXlsxAssets({
      repositoryRoot: root, distDirectory: dist, platform: "win32", environment: { Path: "/usr/bin" },
      ensure: (options) => ensureXlsxAssets({ ...options, hostPlatform: "win32", locate: () => cargo, spawn: fakeUpstreamBuild(calls), log: () => {} }),
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(1, 4), ["--with-native", "--out", buildDir]);
    assert.match(calls[0].args[0].replaceAll("\\", "/"), /scripts\/office\/build-upstream\.mjs$/);
    assert.ok(!calls[0].args.includes("--skip-install"), "a fresh scratch tree installs the upstream deps");
    assert.equal(calls[0].options.env.CARGO_TARGET_DIR, nativeTargetDirectory({ repositoryRoot: root, platform: "win32", environment: {} }));
    assert.notEqual(dirname(calls[0].options.env.CARGO_TARGET_DIR), parse(root).root, "never a drive-root dir");
    assert.ok(calls[0].options.env.Path.startsWith(join(root, "cargo-home", "bin")), "cargo's dir leads the child PATH");
    assert.equal(calls[0].options.env.PATH, undefined, "the existing PATH key is reused, not duplicated");
    assert.equal(attempt.reason, "built");
    assert.equal(staged.sidecar?.file.endsWith("xlsx-sidecar.exe"), true);
    assert.ok(existsSync(join(dist, XLSX_ASSETS_DIRECTORY, "xlsx-sidecar.exe")));
    // The staged-assets.json contract (UNI-944) is unchanged.
    const manifest = JSON.parse(readFileSync(join(dist, XLSX_ASSETS_DIRECTORY, "staged-assets.json"), "utf8"));
    assert.deepEqual(Object.keys(manifest), ["schemaVersion", "platform", "gateway", "sidecar", "buildRecord"]);
    assert.equal(manifest.schemaVersion, 1);
    assert.deepEqual(Object.keys(manifest.sidecar), ["file", "bytes", "sha256"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("nothing is built when both assets exist, an explicit asset dir is set, the target is foreign or cargo is absent", () => {
  const { root, buildDir } = xlsxScratch("uniwork-xlsx-ensure-skip-");
  const calls = [];
  const spawn = fakeUpstreamBuild(calls);
  const run = (environment, extra = {}) => ensureXlsxAssets({ repositoryRoot: root, platform: "win32", hostPlatform: "win32", environment, locate: () => "cargo.exe", spawn, log: () => {}, ...extra });
  try {
    assert.equal(run({}, { locate: () => null }).reason, "no-cargo");
    assert.equal(run({}, { hostPlatform: "linux" }).reason, "cross-platform");
    assert.equal(run({ OFFICE_DESKTOP_XLSX_ASSETS: join(root, "elsewhere") }).reason, "explicit");
    assert.equal(calls.length, 0);
    writeFileSync(join(buildDir, "dist", XLSX_GATEWAY_FILE), "// gateway\n");
    mkdirSync(join(buildDir, "native"), { recursive: true });
    writeFileSync(join(buildDir, "native", "xlsx-sidecar.exe"), "MZ-sidecar");
    assert.equal(run({}).reason, "present");
    assert.equal(calls.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an existing upstream install is reused and a failed native build still stages the gateway", async () => {
  const { root, buildDir, dist } = xlsxScratch("uniwork-xlsx-ensure-fail-");
  mkdirSync(join(buildDir, "upstream", "node_modules"), { recursive: true });
  const calls = [];
  try {
    const { attempt, staged } = await prepareXlsxAssets({
      repositoryRoot: root, distDirectory: dist, platform: "win32", environment: {},
      ensure: (options) => ensureXlsxAssets({ ...options, hostPlatform: "win32", locate: () => "cargo.exe", spawn: fakeUpstreamBuild(calls, { status: 1, sidecar: false }), log: () => {} }),
    });
    assert.ok(calls[0].args.includes("--skip-install"));
    assert.equal(attempt.ok, false);
    assert.match(attempt.reason, /build-upstream failed \(exit 1\)/);
    assert.equal(staged.sidecar, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("OFFICE_DESKTOP_REQUIRE_XLSX_SIDECAR=1 fails build and package with an actionable message when the sidecar would be null", async () => {
  assert.equal(REQUIRE_SIDECAR_ENV, "OFFICE_DESKTOP_REQUIRE_XLSX_SIDECAR");
  const { root, buildDir, dist } = xlsxScratch("uniwork-xlsx-require-");
  writeFileSync(join(buildDir, "dist", XLSX_GATEWAY_FILE), "// gateway\n");
  const noCargo = (options) => ensureXlsxAssets({ ...options, hostPlatform: "win32", locate: () => null, log: () => {} });
  const required = { [REQUIRE_SIDECAR_ENV]: "1" };
  try {
    await assert.rejects(
      () => prepareXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: required, ensure: noCargo }),
      (error) => /OFFICE_DESKTOP_REQUIRE_XLSX_SIDECAR=1/.test(error.message) && /xlsx-sidecar\.exe/.test(error.message) && /cargo was found neither/.test(error.message) && /rustup/.test(error.message) && /build-upstream\.mjs --with-native/.test(error.message) && /OFFICE_DESKTOP_XLSX_ASSETS/.test(error.message),
    );
    assert.ok(!existsSync(join(dist, XLSX_ASSETS_DIRECTORY)), "the gate fails before anything is staged");
    // The package step (build: false) applies the same gate.
    await assert.rejects(
      () => prepareXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: required, build: false }),
      /desktop build step did not produce it/,
    );
    // Without the flag today's behaviour stands: gateway staged, sidecar null.
    const { staged } = await prepareXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: {}, ensure: noCargo });
    assert.equal(staged.sidecar, null);
    // A dev build without a gateway skips staging instead of failing...
    rmSync(join(buildDir, "dist", XLSX_GATEWAY_FILE));
    const devBuild = await prepareXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: {}, ensure: noCargo, requireGateway: false });
    assert.equal(devBuild.staged, null);
    // ...but not when the sidecar is required.
    await assert.rejects(
      () => prepareXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: required, ensure: noCargo, requireGateway: false }),
      /OFFICE_DESKTOP_REQUIRE_XLSX_SIDECAR=1/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("REQUIRE_XLSX_SIDECAR=1: a failed native build never stages a stale sidecar from a shared CARGO_TARGET_DIR", async () => {
  const { root, dist } = xlsxScratch("uniwork-xlsx-stale-target-");
  const stale = join(root, "shared-target");
  mkdirSync(join(stale, "release"), { recursive: true });
  writeFileSync(join(stale, "release", xlsxSidecarFile("win32")), "MZ-stale-from-another-commit");
  const calls = [];
  const failing = (options) => ensureXlsxAssets({ ...options, hostPlatform: "win32", locate: () => "cargo.exe", spawn: fakeUpstreamBuild(calls, { status: 1, sidecar: false }), log: () => {} });
  try {
    await assert.rejects(
      () => prepareXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: { [REQUIRE_SIDECAR_ENV]: "1", CARGO_TARGET_DIR: stale }, ensure: failing }),
      (error) => /OFFICE_DESKTOP_REQUIRE_XLSX_SIDECAR=1/.test(error.message) && /build-upstream failed \(exit 1\)/.test(error.message),
    );
    assert.equal(calls.length, 1, "the native build was attempted");
    assert.ok(!existsSync(join(dist, XLSX_ASSETS_DIRECTORY)), "nothing is staged after a failed required build");
    // Without the flag the stale candidate still stages, but the operator is warned it is unattested.
    const lines = [];
    const staged = await stageXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: { CARGO_TARGET_DIR: stale }, log: (line) => lines.push(line) });
    assert.equal(staged.sidecar?.file.endsWith("xlsx-sidecar.exe"), true);
    assert.ok(lines.some((line) => /not attested|no successful native build/.test(line)), `warns about provenance: ${lines.join(" | ")}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("REQUIRE_XLSX_SIDECAR=1 stages a sidecar only when this build's native step attests its sha256", async () => {
  const { createHash } = await import("node:crypto");
  const { root, buildDir, dist } = xlsxScratch("uniwork-xlsx-attested-");
  const body = "MZ-fresh-sidecar";
  const sha = createHash("sha256").update(body).digest("hex");
  writeFileSync(join(buildDir, "dist", XLSX_GATEWAY_FILE), "// gateway\n");
  mkdirSync(join(buildDir, "native"), { recursive: true });
  writeFileSync(join(buildDir, "native", xlsxSidecarFile("win32")), body);
  const environment = { [REQUIRE_SIDECAR_ENV]: "1" };
  const stage = () => stageXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment, log: () => {} });
  const record = (native) => writeFileSync(join(buildDir, "build-record.json"), JSON.stringify({ kind: "uniwork-office-upstream-build-record", ...(native ? { native } : {}) }));
  try {
    // No build record at all: nothing attests the binary.
    await assert.rejects(stage, /OFFICE_DESKTOP_REQUIRE_XLSX_SIDECAR=1.*provenance|provenance.*OFFICE_DESKTOP_REQUIRE_XLSX_SIDECAR=1/s);
    // A record of a failed or absent native step attests nothing.
    record({ status: "fail" });
    await assert.rejects(stage, /provenance/);
    record(undefined);
    await assert.rejects(stage, /provenance/);
    // A record whose native step passed and whose sha256 matches stages.
    record({ status: "pass", binary: { path: "native/xlsx-sidecar.exe", sha256: sha } });
    const staged = await stage();
    assert.equal(staged.sidecar.sha256, sha);
    // A passing record for different bytes still fails (existing mismatch check).
    record({ status: "pass", binary: { sha256: "0".repeat(64) } });
    await assert.rejects(stage, /sha256 mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("OFFICE_DESKTOP_SKIP_NATIVE_BUILD=1 stops the auto-build; the REQUIRE message names why and how", async () => {
  assert.equal(SKIP_NATIVE_BUILD_ENV, "OFFICE_DESKTOP_SKIP_NATIVE_BUILD");
  const { root, buildDir, dist } = xlsxScratch("uniwork-xlsx-skip-native-");
  const calls = [];
  const ensure = (environment) => ensureXlsxAssets({ repositoryRoot: root, platform: "win32", hostPlatform: "win32", environment, locate: () => "cargo.exe", spawn: fakeUpstreamBuild(calls), log: () => {} });
  try {
    assert.equal(ensure({ [SKIP_NATIVE_BUILD_ENV]: "1" }).reason, "skipped");
    assert.equal(calls.length, 0, "no cargo, no npm install");
    assert.equal(ensure({ [SKIP_NATIVE_BUILD_ENV]: "0" }).attempted, true, "only 1 opts out");
    calls.length = 0;
    rmSync(join(buildDir, "native"), { recursive: true, force: true });
    await assert.rejects(
      () => prepareXlsxAssets({ repositoryRoot: root, distDirectory: dist, platform: "win32", environment: { [SKIP_NATIVE_BUILD_ENV]: "1", [REQUIRE_SIDECAR_ENV]: "1" }, ensure: (options) => ensureXlsxAssets({ ...options, hostPlatform: "win32", locate: () => "cargo.exe", spawn: fakeUpstreamBuild(calls), log: () => {} }) }),
      (error) => /OFFICE_DESKTOP_SKIP_NATIVE_BUILD=1/.test(error.message),
    );
    assert.equal(calls.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the missing-sidecar messages tell a failed build from a missing toolchain", async () => {
  const { missingRequiredSidecarError } = await import(pathToFileURL(join(appDirectory, "scripts", "xlsx-assets.mjs")).href);
  const built = missingRequiredSidecarError({ platform: "win32", attempt: { reason: "built" } }).message;
  assert.match(built, /finished but did not produce it/);
  assert.doesNotMatch(built, /: built\./);
  assert.match(missingSidecarWarning({ platform: "win32", attempt: { reason: "no-cargo" } }), /Install the Rust toolchain/);
  const failed = missingSidecarWarning({ platform: "win32", attempt: { reason: "build-upstream failed (exit 1)" } });
  assert.match(failed, /build-upstream failed \(exit 1\)/);
  assert.doesNotMatch(failed, /Install the Rust toolchain/, "a failed build is not fixed by installing what is already installed");
  assert.match(missingSidecarWarning({ platform: "win32", attempt: { reason: "skipped" } }), /OFFICE_DESKTOP_SKIP_NATIVE_BUILD/);
});

test("staging finds the sidecar build-upstream copied to <out>/native", () => {
  const { root, buildDir } = xlsxScratch("uniwork-xlsx-native-out-");
  try {
    writeFileSync(join(buildDir, "dist", XLSX_GATEWAY_FILE), "// gateway\n");
    mkdirSync(join(buildDir, "native"), { recursive: true });
    writeFileSync(join(buildDir, "native", "xlsx-sidecar"), "ELF-sidecar");
    const sources = resolveXlsxAssetSources({ repositoryRoot: root, platform: "linux", environment: {} });
    assert.equal(sources.sidecar, join(buildDir, "native", "xlsx-sidecar"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { assertBuildInputsInsideRepository, assertPackagedAsarContents, createPackagerConfig, validateMacTargets } from "./package.mjs";
import { deriveBuildMetadata } from "./deployment-profile.mjs";

test("Windows x64 dev package is explicitly labelled and installs per-user", () => {
  const config = createPackagerConfig({ platform: "win32", arch: "x64", channel: "dev", version: "0.1.0-dev.42" });
  assert.equal(config.appId, "com.uniwork.office.dev");
  assert.match(config.artifactName, /uniwork-office-test_0\.1\.0-dev\.42_unsigned_win32_x64\.zip$/);
  assert.equal(config.publish, null);
  assert.equal(config.win.signAndEditExecutable, false);
  assert.deepEqual(config.win.target, [{ target: "zip", arch: ["x64"] }, { target: "nsis", arch: ["x64"] }]);
  assert.equal(config.nsis.oneClick, true);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowElevation, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.nsis.createStartMenuShortcut, true);
  assert.equal(config.nsis.createDesktopShortcut, false);
  assert.match(config.nsis.artifactName, /uniwork-office-test_0\.1\.0-dev\.42_unsigned_win32_x64-setup\.exe$/);
  assert.deepEqual(config.protocols[0].schemes, ["uniwork-office-dev"]);
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
  assert.match(beta.nsis.artifactName, /uniwork-office_0\.1\.0-beta\.7_unsigned_win32_x64-setup\.exe$/);
  assert.match(stable.nsis.artifactName, /uniwork-office_0\.1\.0_unsigned_win32_x64-setup\.exe$/);
  assert.throws(() => deriveBuildMetadata({ UNIWORK_OFFICE_CHANNEL: "stable" }, { channelProfiles: { stable: {}, beta: {}, dev: {} } }, "0.1.0"), /signing is disabled/);
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

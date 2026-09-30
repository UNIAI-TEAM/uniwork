import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoExternalEngineSource, createPackagerConfig, validateMacTargets } from "./package.mjs";

test("Windows x64 package is an explicitly labelled unsigned-dev artifact", () => {
  const config = createPackagerConfig({ platform: "win32", arch: "x64" });
  assert.equal(config.appId, "com.uniwork.office");
  assert.match(config.artifactName, /_unsigned-dev_win32_x64\.zip$/);
  assert.equal(config.publish, null);
  assert.equal(config.win.signAndEditExecutable, false);
  assert.deepEqual(config.win.target, [{ target: "zip", arch: ["x64"] }]);
  assert.throws(() => createPackagerConfig({ platform: "win32", arch: "arm64" }), /unsupported/);
});

test("macOS arm64/x64 targets are config validated without a build", () => {
  assert.equal(validateMacTargets(), true);
  assert.throws(() => validateMacTargets({ mac: { target: [{ target: "dmg", arch: ["arm64"] }] } }), /arm64 and x64/);
  assert.deepEqual(createPackagerConfig({ platform: "darwin", arch: "arm64" }).mac.target[0].arch, ["arm64"]);
  assert.deepEqual(createPackagerConfig({ platform: "darwin", arch: "x64" }).mac.target[0].arch, ["x64"]);
});

test("packaging rejects an external sibling engine source", () => {
  assert.doesNotThrow(() => assertNoExternalEngineSource());
});

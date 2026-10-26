// scripts/mobile-bundle-composition.mjs: which package each module of the
// bundle's source map belongs to, the per-package totals, and what moved
// against the committed baseline; and the one failure it raises, a package the
// bundle holds although autolinking leaves it out of that platform's binary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { autolinkingExclude, compose, deltas, packageOf, report, unlinkedButBundled } from "./mobile-bundle-composition.mjs";

test("attributes a module to its package, the app's folders, or the shared core", () => {
  assert.equal(packageOf("../../node_modules/.pnpm/@sentry+core@10.1.0/node_modules/@sentry/core/build/esm/index.js"), "@sentry/core");
  assert.equal(packageOf("../../node_modules/.pnpm/zod@4.1.0/node_modules/zod/v4/core/schemas.js"), "zod");
  assert.equal(packageOf("node_modules\\react-native\\Libraries\\Text\\Text.js"), "react-native");
  assert.equal(packageOf("../../packages/core/chat/search-fold.ts"), "@uniwork/core");
  assert.equal(packageOf("/home/runner/work/uniwork/apps/chat-mobile/components/chat/message-row.tsx"), "(app) components");
  assert.equal(packageOf("data/logger.ts"), "(app) data");
  assert.equal(packageOf("index.ts"), "(other)");
});

test("totals modules and source bytes per package, largest first", () => {
  const map = {
    sources: ["node_modules/zod/a.js", "node_modules/zod/b.js", "components/x.tsx", "node_modules/clsx/c.js"],
    sourcesContent: ["aaaa", "bb", "cccccccc", null],
  };
  assert.deepEqual(compose(map), [
    { name: "(app) components", modules: 1, bytes: 8 },
    { name: "zod", modules: 2, bytes: 6 },
    { name: "clsx", modules: 1, bytes: 0 },
  ]);
  assert.deepEqual(compose({}), []);
});

test("names what was added, grew, shrank or went since the baseline, largest change first", () => {
  const baseline = [
    { name: "zod", modules: 2, bytes: 100 },
    { name: "clsx", modules: 1, bytes: 10 },
    { name: "same", modules: 1, bytes: 5 },
  ];
  const current = [
    { name: "zod", modules: 3, bytes: 160 },
    { name: "expo-image-manipulator", modules: 4, bytes: 2000 },
    { name: "same", modules: 1, bytes: 5 },
  ];
  assert.deepEqual(deltas(current, baseline), [
    { name: "expo-image-manipulator", bytes: 2000, modules: 4, added: true, removed: false },
    { name: "zod", bytes: 60, modules: 1, added: false, removed: false },
    { name: "clsx", bytes: -10, modules: -1, added: false, removed: true },
  ]);
  const md = report("android", current, deltas(current, baseline), 2);
  assert.match(md, /\| `expo-image-manipulator` \| 4 \| 2\.0 KB \|/);
  assert.match(md, /\| `expo-image-manipulator` \(new\) \| \+4 \| \+2\.0 KB \|/);
  assert.doesNotMatch(md, /clsx/, "only the top rows");
  assert.match(report("android", current, null, 5), /No baseline/);
  assert.match(report("android", current, [], 5), /No change against the baseline/);
  assert.match(report("ios", current, deltas(baseline, current), 5), /\| `expo-image-manipulator` \(gone\) \| -4 \| −2\.0 KB \|/);
});

test("reads autolinking's exclude the way expo-modules-autolinking merges it", () => {
  const pkg = (autolinking) => ({ expo: { autolinking } });
  assert.deepEqual(autolinkingExclude(pkg({ ios: { exclude: ["expo-symbols"] } }), "ios"), ["expo-symbols"]);
  assert.deepEqual(autolinkingExclude(pkg({ ios: { exclude: ["expo-symbols"] } }), "android"), []);
  // A platform's list replaces the top-level one; a platform without one keeps it.
  assert.deepEqual(autolinkingExclude(pkg({ exclude: ["a"], ios: { exclude: ["b"] } }), "ios"), ["b"]);
  assert.deepEqual(autolinkingExclude(pkg({ exclude: ["a"], ios: { buildFromSource: [] } }), "ios"), ["a"]);
  assert.deepEqual(autolinkingExclude(pkg({ exclude: ["a"], ios: { exclude: ["b"] } }), "android"), ["a"]);
  // iOS links as "apple", whose options win over "ios" when both exist.
  assert.deepEqual(autolinkingExclude(pkg({ apple: { exclude: ["c"] }, ios: { exclude: ["b"] } }), "ios"), ["c"]);
  assert.deepEqual(autolinkingExclude(pkg({ ios: { exclude: ["b", 3] } }), "ios"), ["b"]);
  assert.deepEqual(autolinkingExclude({}, "ios"), []);
});

test("names the excluded packages the bundle holds anyway", () => {
  const current = [{ name: "expo-router", modules: 1, bytes: 1 }, { name: "expo-symbols", modules: 1, bytes: 1 }, { name: "@expo/ui", modules: 1, bytes: 1 }];
  assert.deepEqual(unlinkedButBundled(current, ["expo-symbols", "@expo/dom-webview", "@expo/ui"]), ["@expo/ui", "expo-symbols"]);
  assert.deepEqual(unlinkedButBundled(current, []), []);
});

// The CLI against the app's real package.json: the iOS export a PR produces, not the committed baseline.
test("the CLI fails an iOS export that bundles a package the app excludes on iOS, and passes one that does not", () => {
  const appPackage = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../apps/chat-mobile/package.json"), "utf8"));
  const excluded = autolinkingExclude(appPackage, "ios");
  assert.ok(excluded.includes("expo-symbols"), "the app excludes expo-symbols on iOS");
  const run = (sources) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-composition-"));
    fs.writeFileSync(path.join(dir, "metadata.json"), JSON.stringify({ fileMetadata: { ios: { bundle: "_expo/ios.hbc" } } }));
    fs.mkdirSync(path.join(dir, "_expo"));
    fs.writeFileSync(path.join(dir, "_expo/ios.hbc.map"), JSON.stringify({ sources, sourcesContent: sources.map(() => "x") }));
    const env = { ...process.env };
    delete env.GITHUB_STEP_SUMMARY;
    const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "mobile-bundle-composition.mjs"), dir, "--platform", "ios"], { encoding: "utf8", env });
    fs.rmSync(dir, { recursive: true, force: true });
    return result;
  };
  const bad = run(["node_modules/expo-router/build/index.js", "node_modules/expo-symbols/build/SymbolModule.js"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /The ios bundle imports `expo-symbols`/);
  const good = run(["node_modules/expo-router/build/index.js", "components/x.tsx"]);
  assert.equal(good.status, 0, good.stderr);
});

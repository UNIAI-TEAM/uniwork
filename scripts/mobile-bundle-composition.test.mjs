// scripts/mobile-bundle-composition.mjs: which package each module of the
// bundle's source map belongs to, the per-package totals, and what moved
// against the committed baseline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compose, deltas, packageOf, report } from "./mobile-bundle-composition.mjs";

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

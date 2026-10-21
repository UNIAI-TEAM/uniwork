import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeClosure } from "./mobile-core-graph.mjs";
import { nativePaths } from "./mobile-native-scope.mjs";

test("the app's own code, config and assets need the native build; its docs, flows, store copy and tests do not", () => {
  const changed = [
    "apps/chat-mobile/app.config.ts",
    "apps/chat-mobile/package.json",
    "apps/chat-mobile/components/chat/composer.tsx",
    "apps/chat-mobile/assets/icon.png",
    "apps/chat-mobile/maestro/flows/smoke-launch.yaml",
    "apps/chat-mobile/CLAUDE.md",
    "apps/chat-mobile/maestro/flows/call-join.yaml",
    "apps/chat-mobile/store/listing.md",
    "apps/chat-mobile/lib/mentions.test.ts",
    "apps/chat-mobile/components/chat/composer.test.tsx",
    "apps/chat-mobile/test/render.tsx",
    "apps/chat-mobile/eslint.config.mjs",
    "apps/chat-mobile/jest.config.js",
    "apps/chat-mobile/vitest.config.ts",
  ];
  assert.deepEqual(nativePaths(changed, new Set()), changed.slice(0, 5));
});

test("the install graph and the workflow itself need it", () => {
  const changed = ["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", ".github/workflows/mobile-verify.yml", "patches/x.patch"];
  assert.deepEqual(nativePaths(changed, new Set()), changed);
});

test("a core file needs it only when the app reaches it at runtime", () => {
  const closure = runtimeClosure();
  assert.ok(closure.has("packages/core/chat/client-msg-id.ts"), "an allowlisted entry is in its own closure");
  assert.ok(closure.has("packages/core/api/schema.ts"));
  assert.ok(!closure.has("packages/core/api/http.ts"), "the web transport is never in the app");
  assert.deepEqual(
    nativePaths(["packages/core/chat/client-msg-id.ts", "packages/core/api/http.ts", "apps/web/app/page.tsx", "server/main.go", "docs/x.md"], closure),
    ["packages/core/chat/client-msg-id.ts"],
  );
});

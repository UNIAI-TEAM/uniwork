import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeClosure } from "./mobile-core-graph.mjs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { e2ePaths, nativePaths, needsE2e, touchesMobile } from "./mobile-native-scope.mjs";

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
    "apps/chat-mobile/coverage-floor.json",
    "apps/chat-mobile/data/persisted-schema.lock.json",
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

test("the mobile checks run for the app, what it reads and the server contracts it holds, and for nothing else", () => {
  const none = new Set();
  for (const file of [
    "apps/chat-mobile/CLAUDE.md",
    "packages/core/api/http.ts",
    "scripts/mobile-perf.mjs",
    "patches/expo.patch",
    ".gitignore",
    "packages/office-upstream/upstream/packages/pdf2docx/.gitignore",
    ".easignore",
    "knip.json",
    ".github/workflows/chat-mobile-update.yml",
    "docs/events/CATALOGUE.md",
    "docs/runbooks/unichat-mobile-release.md",
    "server/internal/handler/dto/sdo/chat.go",
    // Review P2: a handler-only rename of a wrapper key, and the kill switch catalogue.
    "server/internal/handler/chat_threads.go",
    "server/internal/handler/auth.go",
    // The sign-in SDOs' handlers (ADR 0047).
    "server/internal/handler/native_sign_in.go",
    "server/internal/handler/sign_in_methods.go",
    "server/internal/featureflags/keys.go",
    // A route the app calls dropped from the router (scripts/mobile-route-catalogue.test.mjs).
    "server/internal/handler/router/chat.go",
  ]) {
    assert.equal(touchesMobile([file], none), true, file);
  }
  for (const file of ["apps/web/app/page.tsx", "server/internal/service/chat.go", "server/internal/handler/meeting.go", "docs/adr/README.md", ".github/workflows/ci.yml", "packages/views/chat/x.tsx", "apps/chat-desktop/package.json"]) {
    assert.equal(touchesMobile([file], none), false, file);
  }
  assert.equal(touchesMobile([], none), false);
});

// Review P2: android-e2e ran only for a native change, so a PR that broke a signed-in flow, its subflow or scripts,
// the seed, or the server code those flows go through passed the required gate with the job skipped, and the next
// unrelated native PR turned red.
test("the signed-in flows run for what they read beyond the binary, and whenever the binary is built", () => {
  const none = new Set();
  const own = [
    "apps/chat-mobile/maestro/flows/chat-read-send.yaml",
    "apps/chat-mobile/maestro/flows/offline-send-relaunch.yaml",
    "apps/chat-mobile/maestro/flows/background-resume.yaml",
    "apps/chat-mobile/maestro/subflows/sign-in.yaml",
    "apps/chat-mobile/maestro/scripts/peer-session.js",
    "apps/chat-mobile/maestro/scripts/app-scheme.js",
    "apps/chat-mobile/maestro/scripts/post-as-peer.js",
    "scripts/mobile-e2e-seed.mjs",
    "server/internal/handler/chat.go",
    "server/internal/handler/chat_threads.go",
    "server/internal/service/chat.go",
    "server/internal/service/chat_post.go",
    "server/internal/handler/desktop_auth.go",
    "server/internal/service/desktop_auth.go",
    "server/internal/handler/native_sign_in.go",
    "server/internal/service/native_sign_in.go",
    "server/internal/service/native_sign_in_ticket.go",
    "server/internal/handler/router/chat.go",
    "server/internal/handler/router/auth.go",
    "apps/web/app/(auth)/auth/desktop/authorize/page.tsx",
  ];
  for (const file of own) {
    assert.deepEqual(e2ePaths([file]), [file], file);
    assert.equal(needsE2e([file], none), true, file);
  }
  const not = [
    "apps/chat-mobile/maestro/flows/call-join.yaml",
    "apps/chat-mobile/maestro/flows/upgrade-before.yaml",
    "apps/chat-mobile/CLAUDE.md",
    "server/internal/service/chat_test.go",
    "server/internal/handler/desktop_auth_test.go",
    "server/internal/service/native_sign_in_test.go",
    "server/internal/service/meeting.go",
    "server/internal/handler/router/meetings.go",
    "apps/web/app/page.tsx",
    "scripts/mobile-e2e-seed.test.mjs",
  ];
  for (const file of not) assert.equal(needsE2e([file], none), false, file);
  // A native change always needs them: the binary they drive changed.
  assert.equal(needsE2e(["apps/chat-mobile/components/chat/composer.tsx"], none), true);
  assert.equal(needsE2e([], none), false);
});

test("the CLI prints and writes the e2e output beside mobile and native", () => {
  const script = path.join(import.meta.dirname, "mobile-native-scope.mjs");
  const run = (input) => execFileSync("node", [script, "--stdin"], { input, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "" } });
  assert.match(run("server/internal/service/chat.go\n"), /^mobile=false\nnative=false\ne2e=true$/m);
  assert.match(run("apps/chat-mobile/app.config.ts\n"), /^mobile=true\nnative=true\ne2e=true$/m);
  assert.match(run("apps/web/app/page.tsx\n"), /^mobile=false\nnative=false\ne2e=false$/m);
});

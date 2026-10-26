import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EASIGNORE, rebase, render, trackedGitignores } from "./mobile-easignore.mjs";

// EAS Build packs its upload with .easignore instead of the .gitignore files
// (scripts/mobile-easignore.mjs). A hand-kept copy drifted: it lacked the OTA
// signing keys' patterns, so `eas build` from a laptop holding a key would
// have uploaded it. Generated from the .gitignore files, held here.

test(".easignore is what scripts/mobile-easignore.mjs generates from the tracked .gitignore files", () => {
  assert.equal(fs.readFileSync(EASIGNORE, "utf8"), render(trackedGitignores()), "run node scripts/mobile-easignore.mjs");
});

test("a nested .gitignore's patterns keep git's meaning at the repo root", () => {
  assert.equal(rebase("node_modules/", ""), "node_modules/", "the root's patterns are unchanged");
  assert.equal(rebase("/android/", "apps/chat-mobile"), "apps/chat-mobile/android/", "a leading slash anchors to the file's folder");
  assert.equal(rebase("ocr/vision", "pkg"), "pkg/ocr/vision", "a middle slash anchors too");
  assert.equal(rebase(".expo/", "apps/chat-mobile"), "apps/chat-mobile/**/.expo/", "no slash matches at any depth below the folder");
  assert.equal(rebase("!keep.txt", "a"), "!a/**/keep.txt", "a negation stays one");
  assert.equal(rebase("\\#hash", "a"), "a/**/#hash", "an escaped first character needs no escape once the folder leads");
  assert.equal(rebase("# comment", "a"), "# comment");
  assert.equal(rebase("", "a"), "");
  assert.equal(rebase("trailing   ", "a"), "a/**/trailing", "unescaped trailing spaces go, as git trims them");
});

/** Whether git, with `rules` as the only ignore file of an empty repository, ignores each path. */
function ignoredBy(rules, paths) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "easignore-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    fs.writeFileSync(path.join(dir, ".gitignore"), rules);
    const out = (() => {
      try {
        return execFileSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: dir, input: paths.join("\n"), encoding: "utf8" });
      } catch (error) {
        // Exit 1: none of the paths is ignored.
        if (error.status === 1) return "";
        throw error;
      }
    })();
    const hit = new Set(out.split("\n").filter(Boolean));
    return Object.fromEntries(paths.map((p) => [p, hit.has(p)]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("EAS uploads the app's source and never a key, an env file, the native build output or the CodeGraph socket", () => {
  const rules = fs.readFileSync(EASIGNORE, "utf8");
  const skipped = [
    "apps/chat-mobile/certs/private-key.pem",
    "private-key.pem",
    ".env",
    "apps/chat-mobile/.env",
    "apps/chat-mobile/android/app/build.gradle",
    "apps/chat-mobile/ios/Podfile",
    "apps/chat-mobile/.expo/settings.json",
    "node_modules/expo/package.json",
    ".codegraph/daemon.sock",
    ".codegraph/.gitignore",
  ];
  const uploaded = [
    "apps/chat-mobile/app.config.ts",
    "apps/chat-mobile/certs/eas-update-certificate.pem",
    // The local Expo module's native sources: only the app's own android/ is generated.
    "apps/chat-mobile/modules/unichat-calls/android/build.gradle",
    "apps/chat-mobile/modules/unichat-calls/android/src/main/java/expo/modules/unichatcalls/CallService.kt",
    "pnpm-lock.yaml",
    "packages/core/package.json",
  ];
  const result = ignoredBy(rules, [...skipped, ...uploaded]);
  for (const p of skipped) assert.equal(result[p], true, `${p} must not reach the EAS archive`);
  for (const p of uploaded) assert.equal(result[p], false, `${p} must reach the EAS archive`);
});

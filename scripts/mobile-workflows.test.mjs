import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The release path of UniChat mobile (docs/runbooks/unichat-mobile-release.md,
// ADR 0037): what the three workflows promise, held so an edit cannot quietly
// drop it.
const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, ".github/workflows", f), "utf8");
const EXACT = /^"?\d+\.\d+\.\d+"?$/;
const envPin = (wf, name) => wf.match(new RegExp(`^\\s+${name}:\\s*(\\S+)\\s*$`, "m"))?.[1];

test("the release runs every PR check on the tagged SHA before EAS, Android only, with a pinned eas-cli", () => {
  const wf = read("chat-mobile-release.yml");
  assert.match(wf, /^ {2}verify:\n {4}uses: \.\/\.github\/workflows\/mobile-verify\.yml$/m, "a verify job that calls mobile-verify.yml");
  assert.match(wf, /^ {2}build:\n {4}needs: verify$/m, "build waits for verify");
  assert.match(envPin(wf, "EAS_CLI_VERSION") ?? "", EXACT, "EAS_CLI_VERSION is an exact version");
  assert.match(wf, /eas-version: \$\{\{ env\.EAS_CLI_VERSION \}\}/);
  assert.doesNotMatch(wf, /eas-version: latest/);
  // Android only until the Apple account exists (UNI-1838): then this assertion moves with it.
  assert.match(wf, /eas build --platform android /);
  assert.doesNotMatch(wf, /--platform all/);
});

test("mobile-verify can be called and builds the release only through its jobs", () => {
  const wf = read("mobile-verify.yml");
  assert.match(wf, /^ {2}workflow_call:$/m);
  for (const job of ["scope", "checks", "doctor-bundle", "android-release"]) assert.match(wf, new RegExp(`^ {2}${job}:$`, "m"), `job ${job}`);
  assert.match(envPin(wf, "EXPO_DOCTOR_VERSION") ?? "", EXACT, "EXPO_DOCTOR_VERSION is an exact version");
  assert.match(wf, /node scripts\/mobile-bundle-budget\.mjs/);
  assert.match(wf, /\.\/gradlew :app:assembleRelease/);
  assert.match(wf, /scripts\/mobile-workflows\.test\.mjs/, "the contract step runs this test");
  assert.doesNotMatch(wf, /secrets\./, "the PR checks read no secret");
});

test("the nightly pins Maestro, fails a scheduled run without its settings, and builds the production AAB", () => {
  const wf = read("chat-mobile-verify.yml");
  assert.match(envPin(wf, "MAESTRO_VERSION") ?? "", EXACT, "MAESTRO_VERSION is an exact version");
  assert.doesNotMatch(wf, /get\.maestro\.mobile\.dev"? \| bash/, "no unversioned installer script");
  assert.match(wf, /releases\/download\/cli-\$MAESTRO_VERSION\/maestro\.zip/);
  const gate = wf.split(/^ {2}ios:$/m)[0];
  assert.match(gate, /::error::The Maestro flows cannot run/);
  assert.match(gate, /exit 1/);
  assert.doesNotMatch(gate, /::notice::Maestro skipped/);
  assert.match(wf, /^ {2}android-production:$/m);
  assert.match(wf, /\.\/gradlew :app:bundleRelease/);
});

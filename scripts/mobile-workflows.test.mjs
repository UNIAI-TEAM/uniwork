import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
  // A re-pushed tag has a real `before` SHA: without this the scope job could skip the native build.
  assert.match(wf, /^ {4}uses: \.\/\.github\/workflows\/mobile-verify\.yml\n {4}with:\n {6}force_native: true$/m, "the release forces the native build");
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
  for (const job of ["scope", "checks", "doctor-bundle", "android-release", "android-smoke"]) assert.match(wf, new RegExp(`^ {2}${job}:$`, "m"), `job ${job}`);
  assert.match(envPin(wf, "EXPO_DOCTOR_VERSION") ?? "", EXACT, "EXPO_DOCTOR_VERSION is an exact version");
  assert.match(wf, /node scripts\/mobile-bundle-budget\.mjs/);
  assert.match(wf, /\.\/gradlew :app:assembleRelease/);
  assert.match(wf, /maestro test flows\/smoke-launch\.yaml/, "the cold-start smoke runs the release APK");
  assert.match(envPin(wf, "MAESTRO_VERSION") ?? "", EXACT, "MAESTRO_VERSION is an exact version");
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

// Both triggers must fire when any of the three workflows changes, or an edit to
// the release or the nightly merges without this test having run.
test("mobile-verify runs on an edit to any of the three workflows, on push and on pull_request", () => {
  const wf = read("mobile-verify.yml");
  for (const event of ["push", "pull_request"]) {
    const block = wf.match(new RegExp(`^ {2}${event}:\\n([\\s\\S]*?)(?=^ {2}\\S)`, "m"))?.[1] ?? "";
    for (const file of ["mobile-verify.yml", "chat-mobile-release.yml", "chat-mobile-verify.yml"]) {
      assert.ok(block.includes(`- ".github/workflows/${file}"`), `${event} paths list ${file}`);
    }
  }
});

test("mobile-verify declares the force_native input the release passes", () => {
  const wf = read("mobile-verify.yml");
  assert.match(wf, /^ {2}workflow_call:\n {4}inputs:\n(?: {6}#.*\n)* {6}force_native:\n(?: {8}\S.*\n)*? {8}type: boolean\n/m);
});

// Runs the scope job's decide step as written in the workflow, with `node` stubbed
// to say what the diff would say (native=false), so only the forcing rules decide.
function decide(env) {
  const wf = read("mobile-verify.yml");
  const step = wf.split(/^ {6}- id: decide$/m)[1]?.split(/^ {6}- /m)[0] ?? "";
  const script = step.split(/^ {8}run: \|\n/m)[1]?.split("\n").filter((l) => l === "" || l.startsWith("          ")).map((l) => l.slice(10)).join("\n");
  assert.ok(script, "the decide step has a run block");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-scope-"));
  try {
    fs.writeFileSync(path.join(dir, "node"), "#!/bin/sh\necho native=false\n", { mode: 0o755 });
    const out = path.join(dir, "out");
    fs.writeFileSync(out, "");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    execFileSync("bash", ["-c", script], {
      cwd: root,
      env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: out, GITHUB_SHA: head, PUSH_BEFORE: head, PR_BASE: "", FORCE_NATIVE: "", REF: "refs/heads/main", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return fs.readFileSync(out, "utf8").trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the scope job builds natively when the release calls it, even for a re-pushed tag with a known base", () => {
  // A plain push with a known base defers to the diff.
  assert.equal(decide({ EVENT: "push" }), "");
  assert.equal(decide({ EVENT: "push", FORCE_NATIVE: "true" }), "native=true");
  assert.equal(decide({ EVENT: "push", REF: "refs/tags/chat-mobile-v1.2.3" }), "native=true");
  assert.equal(decide({ EVENT: "push", FORCE_NATIVE: "false" }), "");
  assert.equal(decide({ EVENT: "workflow_dispatch" }), "native=true");
});

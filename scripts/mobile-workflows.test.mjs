import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The release path of UniChat mobile (docs/runbooks/unichat-mobile-release.md,
// ADR 0037): what the four workflows promise, held so an edit cannot quietly
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
  assert.match(wf, /scripts\/mobile-knip\.test\.mjs/, "the contract step runs the knip exception test");
  // Dead code and dependency drift block on every PR, not only in a local make check.
  assert.match(wf, /run: pnpm knip --workspace apps\/chat-mobile$/m, "knip runs over the app");
  assert.match(wf, /EXPO_OFFLINE: "1"\n\s+run: pnpm exec expo install --check$/m, "native module versions are checked against the installed SDK");
  assert.match(wf, /scripts\/mobile-lockfiles\.test\.mjs/, "the contract step rejects a foreign lockfile");
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

// The OTA path (audit R3): from CI, after every PR check on the SHA, staged by
// a rollout share, signed once the certificate exists, its maps in Sentry.
test("an OTA update is verified first, staged, signed when the app carries a certificate, and fails loudly without a token", () => {
  const wf = read("chat-mobile-update.yml");
  assert.match(wf, /^ {2}workflow_dispatch:$/m);
  assert.doesNotMatch(wf, /^ {2}(push|pull_request|schedule):/m, "a person decides when an update ships");
  assert.match(wf, /^ {2}verify:\n {4}uses: \.\/\.github\/workflows\/mobile-verify\.yml$/m, "a verify job that calls mobile-verify.yml");
  assert.match(wf, /^ {2}publish:\n {4}needs: verify$/m, "publish waits for verify");
  assert.match(envPin(wf, "EAS_CLI_VERSION") ?? "", EXACT, "EAS_CLI_VERSION is an exact version");
  assert.equal(envPin(wf, "EAS_CLI_VERSION"), envPin(read("chat-mobile-release.yml"), "EAS_CLI_VERSION"), "the same eas-cli as the store release");
  assert.match(wf, /eas-version: \$\{\{ env\.EAS_CLI_VERSION \}\}/);
  for (const input of ["channel", "rollout_percentage", "message"]) assert.match(wf, new RegExp(`^ {6}${input}:$`, "m"), `input ${input}`);
  // Inputs reach the shell through env, never interpolated into a script.
  assert.doesNotMatch(wf.split(/^jobs:$/m)[1] ?? "", /run: [^\n]*\$\{\{ inputs\./);
  assert.match(wf, /eas update --platform android --channel "\$CHANNEL" --environment "\$EAS_ENVIRONMENT"/);
  assert.match(wf, /--rollout-percentage "\$ROLLOUT"/);
  assert.match(wf, /certs\/eas-update-certificate\.pem/);
  assert.match(wf, /--private-key-path/);
  assert.match(wf, /::error::EXPO_TOKEN is not set[^\n]*\n\s+exit 1/, "a dispatched publish without a token fails");
  assert.match(wf, /sentry-expo-upload-sourcemaps dist/);
});

// Both triggers must fire when any of the four workflows changes, or an edit to
// the release, the nightly or the OTA path merges without this test having run.
test("mobile-verify runs on an edit to any of the four workflows, on push and on pull_request", () => {
  const wf = read("mobile-verify.yml");
  for (const event of ["push", "pull_request"]) {
    const block = wf.match(new RegExp(`^ {2}${event}:\\n([\\s\\S]*?)(?=^ {2}\\S)`, "m"))?.[1] ?? "";
    for (const file of ["mobile-verify.yml", "chat-mobile-release.yml", "chat-mobile-verify.yml", "chat-mobile-update.yml"]) {
      assert.ok(block.includes(`- ".github/workflows/${file}"`), `${event} paths list ${file}`);
    }
    assert.ok(block.includes('- "knip.json"'), `${event} paths list knip.json (scripts/mobile-knip.test.mjs reads it)`);
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

const WORKFLOWS = ["mobile-verify.yml", "chat-mobile-release.yml", "chat-mobile-verify.yml", "chat-mobile-update.yml"];

/** The workflow-level env block and each job's text, by job id. */
function jobsOf(wf) {
  const env = wf.match(/^env:\n([\s\S]*?)(?=^\S)/m)?.[1] ?? "";
  const body = wf.split(/^jobs:$/m)[1] ?? "";
  const jobs = new Map();
  const parts = body.split(/^ {2}([\w-]+):$/m);
  for (let i = 1; i < parts.length; i += 2) jobs.set(parts[i], parts[i + 1]);
  return { env, jobs };
}

// The @sentry/react-native/expo plugin wires sentry-cli into the Gradle release
// build and the Xcode bundle phase; without org, project and token it exits
// non-zero and fails the build. A Release build on a runner (no EAS profile,
// so no SENTRY_ALLOW_FAILURE) must turn the upload off.
test("every job that prebuilds and builds a Release binary on the runner turns the Sentry upload off", () => {
  let checked = 0;
  for (const file of WORKFLOWS) {
    const { env, jobs } = jobsOf(read(file));
    for (const [id, job] of jobs) {
      if (!/expo prebuild/.test(job) || !/assembleRelease|bundleRelease|-configuration Release/.test(job)) continue;
      checked += 1;
      assert.match(`${env}\n${job}`, /^\s+SENTRY_DISABLE_AUTO_UPLOAD: "true"$/m, `${file} › ${id} builds a Release binary with the Sentry upload on`);
    }
  }
  assert.ok(checked >= 4, `found ${checked} native Release jobs, expected the PR, nightly iOS/Android and production ones`);
});

/** Runs one `run: |` step of a workflow as written, with `extraPath` first on PATH. */
function runStep(file, marker, env, extraPath) {
  const wf = read(file);
  const step = wf.split(marker)[1]?.split(/^ {6}- /m)[0] ?? "";
  const script = step.split(/^ {8}run: \|\n/m)[1]?.split("\n").filter((l) => l === "" || l.startsWith("          ")).map((l) => l.slice(10)).join("\n");
  assert.ok(script, `${file}: the step has a run block`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-step-"));
  try {
    const out = path.join(dir, "out");
    fs.writeFileSync(out, "");
    const result = { status: 0, stdout: "", stderr: "" };
    try {
      result.stdout = execFileSync("bash", ["-c", script], {
        cwd: dir,
        env: { PATH: `${extraPath ?? dir}:${process.env.PATH}`, GITHUB_OUTPUT: out, RUNNER_TEMP: dir, ...env },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      Object.assign(result, { status: error.status, stdout: String(error.stdout), stderr: String(error.stderr) });
    }
    return { ...result, outputs: Object.fromEntries(fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("="))) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// eas update does not apply a build profile's env (only --environment), so the
// workflow itself must say which variant it builds: without UNICHAT_ENV the
// update is the dev config (dev package, dev scheme, a fingerprint no store
// binary has) and reaches no phone while the run stays green.
test("an OTA update is built as the variant of the store binaries on its channel", () => {
  const eas = JSON.parse(fs.readFileSync(path.join(root, "apps/chat-mobile/eas.json"), "utf8"));
  const wf = read("chat-mobile-update.yml");
  const channels = wf.match(/options: \[([^\]]+)\]/)?.[1].split(",").map((c) => c.trim()) ?? [];
  assert.deepEqual(channels, ["internal", "preview", "production"]);
  for (const channel of channels) {
    const { status, outputs } = runStep("chat-mobile-update.yml", /^ {6}- id: target$/m, { CHANNEL: channel });
    assert.equal(status, 0, `target step for ${channel}`);
    const profiles = Object.values(eas.build).filter((p) => p.channel === channel);
    assert.ok(profiles.length > 0, `an eas.json build profile publishes channel ${channel}`);
    for (const profile of profiles) {
      assert.equal(outputs.environment, profile.environment, `${channel}: the EAS environment of its build profile`);
      assert.equal(outputs.app_env, profile.env.UNICHAT_ENV, `${channel}: the UNICHAT_ENV of its build profile`);
    }
  }
  assert.notEqual(runStep("chat-mobile-update.yml", /^ {6}- id: target$/m, { CHANNEL: "nightly" }).status, 0, "an unknown channel fails");
  // Every step that evaluates the app config gets the variant.
  for (const step of ["- name: The update is the channel's variant, with its servers", "- id: runtime", "- name: Publish to the channel, staged"]) {
    const block = wf.split(step)[1]?.split(/^ {6}- /m)[0] ?? "";
    assert.match(block, /^ {10}UNICHAT_ENV: \$\{\{ steps\.target\.outputs\.app_env \}\}$/m, `${step} sets UNICHAT_ENV`);
  }
});

test("the OTA config check fails an update built as the wrong variant or without servers", () => {
  const marker = "- name: The update is the channel's variant, with its servers";
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-eas-"));
  try {
    // A stand-in eas-cli: `eas env:exec <env> <cmd>` prints the config in $FAKE_CONFIG.
    fs.writeFileSync(path.join(bin, "eas"), '#!/bin/sh\nprintf "%s" "$FAKE_CONFIG"\n', { mode: 0o755 });
    const check = (extra) => runStep("chat-mobile-update.yml", marker, { EAS_ENVIRONMENT: "preview", UNICHAT_ENV: "staging", FAKE_CONFIG: `Loaded env\n${JSON.stringify({ extra })}` }, bin);
    const servers = { apiUrl: "https://api.test", appUrl: "https://app.test" };
    assert.equal(check({ APP_ENV: "staging", ...servers, sentryDsn: "https://k@sentry.test/1" }).status, 0, "the right variant passes");
    const dev = check({ APP_ENV: "dev", ...servers });
    assert.notEqual(dev.status, 0, "the dev config fails");
    assert.match(dev.stderr + dev.stdout, /::error::.*dev.*staging/);
    assert.notEqual(check({ APP_ENV: "staging", apiUrl: "https://api.test" }).status, 0, "a missing server URL fails");
    assert.match(check({ APP_ENV: "staging", ...servers }).stdout, /::notice::no SENTRY_DSN/);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

// The store release runs from a tag; an OTA is dispatched on main or develop. One
// environment limited to chat-mobile-v* tags would refuse every OTA run.
test("the OTA publishes from its own branch-limited environment, the store release from the tag one", () => {
  assert.match(read("chat-mobile-update.yml"), /^ {4}environment: chat-mobile-update$/m);
  assert.match(read("chat-mobile-release.yml"), /^ {4}environment: chat-mobile-release$/m);
  const runbook = fs.readFileSync(path.join(root, "docs/runbooks/unichat-mobile-release.md"), "utf8");
  assert.match(runbook, /`chat-mobile-update`[^\n]*`main`[^\n]*`develop`/, "the runbook limits chat-mobile-update to main and develop");
});

// Audit P2 Release: a store release reaches a slice of phones first and widens
// only on Sentry's crash-free sessions. While the production app on Play has
// no public release, Play takes drafts only, so the stage is set by hand from
// the runbook; once it is live, the submit profile carries it.
test("a production store release is staged and promoted on crash-free sessions", () => {
  const eas = JSON.parse(fs.readFileSync(path.join(root, "apps/chat-mobile/eas.json"), "utf8"));
  const android = eas.submit?.production?.android ?? {};
  assert.equal(android.track, "production");
  if (android.releaseStatus === "inProgress") {
    assert.ok(android.rollout > 0 && android.rollout <= 0.1, `rollout ${android.rollout} is a first stage of at most 10 %`);
  } else {
    assert.equal(android.releaseStatus, "draft", "a production submit is a draft (staged by hand) or an inProgress rollout");
    assert.equal(android.rollout, undefined, "Play ignores a rollout on a draft");
  }
  const runbook = fs.readFileSync(path.join(root, "docs/runbooks/unichat-mobile-release.md"), "utf8");
  const section = runbook.split("**Phát hành production theo giai đoạn")[1]?.split(/\n\*\*|\n## /)[0] ?? "";
  assert.ok(section, "the runbook has the staged production section");
  assert.match(section, /99\.5 %/, "promotion is gated on crash-free sessions");
  assert.match(section, /Halt rollout/, "the halt procedure");
  assert.match(section, /"releaseStatus": "inProgress", "rollout": 0\.05/, "the switch to a submitted first stage once Play is live");
  assert.match(section, /Phased release/, "the iOS counterpart");
});

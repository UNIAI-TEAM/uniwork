import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { missingContexts, protectionBody, readManifest } from "./branch-protection.mjs";

// The required checks (scripts/branch-protection.json) name jobs that exist and
// always report on a pull request: a context no job reports, or one in a
// workflow a path filter can keep from starting, blocks every PR for ever.
const root = path.resolve(import.meta.dirname, "..");
const manifest = readManifest();
const read = (file) => fs.readFileSync(path.join(root, ".github/workflows", file), "utf8");

/** The pull_request trigger block of a workflow ("" when it has none). */
function pullRequestTrigger(wf) {
  const on = wf.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1] ?? "";
  return on.match(/^ {2}pull_request:\n((?: {4}.*\n|\s*\n)*)/m)?.[1] ?? (/^ {2}pull_request:\s*$/m.test(on) ? "" : null);
}

test("main and develop are the protected branches of this repository", () => {
  assert.deepEqual(manifest.branches, ["main", "develop"]);
  assert.equal(manifest.repository, "UNIAI-TEAM/uniwork");
  assert.ok(manifest.contexts.some((c) => c.workflow === "mobile-verify.yml" && c.job === "gate"), "UniChat mobile's gate is required");
});

test("every required context is the name of a job in a workflow that runs on every pull request into both branches", () => {
  for (const { context, workflow, job } of manifest.contexts) {
    const wf = read(workflow);
    const trigger = pullRequestTrigger(wf);
    assert.notEqual(trigger, null, `${workflow} runs on pull_request`);
    assert.doesNotMatch(trigger, /^\s+paths(-ignore)?:/m, `${workflow}: a path filter would leave "${context}" pending`);
    const branches = trigger.match(/^\s+branches: \[([^\]]+)\]$/m)?.[1].split(",").map((b) => b.trim());
    if (branches) for (const b of manifest.branches) assert.ok(branches.includes(b), `${workflow} runs on PRs into ${b}`);
    const body = wf.split(/^jobs:$/m)[1] ?? "";
    const text = body.split(new RegExp(`^ {2}${job}:$`, "m"))[1]?.split(/^ {2}\S/m)[0];
    assert.ok(text !== undefined, `${workflow} has a job ${job}`);
    const name = text.match(/^ {4}name: (.+)$/m)?.[1];
    assert.equal(name ?? job, context, `${workflow} › ${job} reports as "${context}"`);
    assert.doesNotMatch(text, /strategy:\s*\n\s+matrix:/, `${job}: a matrix job reports one context per leg`);
  }
});

test("the API body requires every context, admins included, and the check names what GitHub lacks", () => {
  const body = protectionBody(manifest);
  assert.deepEqual(body.required_status_checks.checks.map((c) => c.context), manifest.contexts.map((c) => c.context));
  assert.equal(body.enforce_admins, true);
  assert.equal(body.required_status_checks.strict, false);
  assert.deepEqual(missingContexts(manifest, { checks: manifest.contexts.map(({ context }) => ({ context })) }), []);
  assert.deepEqual(missingContexts(manifest, { contexts: ["frontend"] }), manifest.contexts.map((c) => c.context).filter((c) => c !== "frontend"));
  assert.deepEqual(missingContexts(manifest, {}).length, manifest.contexts.length);
});

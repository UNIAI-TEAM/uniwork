import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

test("workflow uses stable release validation and scoped credentials without bypassing checks", () => {
  const workflow = parse(readFileSync(resolve(import.meta.dirname, "../.github/workflows/changelog.yml"), "utf8"));
  assert.deepEqual(workflow.on.push.branches, ["develop"]);
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.jobs.draft.steps.some((step) => step.env?.GH_TOKEN), false);
  const notify = workflow.jobs.draft.steps.find((step) => step.run === "node scripts/changelog-review-notify.mjs");
  assert.equal(notify.env.UNIAI_CHANGELOG_WEBHOOK_URL, "${{ secrets.UNIAI_CHANGELOG_WEBHOOK_URL }}");
  assert.ok(workflow.jobs.draft.steps.indexOf(notify) > workflow.jobs.draft.steps.findIndex((step) => step.uses?.startsWith("actions/upload-artifact@")));
  const steps = workflow.jobs.release.steps;
  const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "develop");
  assert.equal(checkout.with["fetch-depth"], 0);
  assert.equal(checkout.with["persist-credentials"], false);
  const writes = steps.filter((step) => step.env?.GH_TOKEN);
  assert.equal(writes.length, 2);
  for (const step of writes) assert.equal(step.env.GH_TOKEN, "${{ secrets.CHANGELOG_BOT_TOKEN }}");
  const commands = steps.map((step) => step.run ?? "").join("\n").split("\n").filter((line) => !/^\s*#/u.test(line)).join("\n");
  assert.doesNotMatch(commands, /--admin|--force|--no-verify|core\.hooksPath/);
  assert.match(commands, /--auto --squash --match-head-commit/);
  assert.match(commands, /prepare --tag "\$RELEASE_TAG"/);
  assert.equal(workflow.jobs.release.concurrency["cancel-in-progress"], false);
});

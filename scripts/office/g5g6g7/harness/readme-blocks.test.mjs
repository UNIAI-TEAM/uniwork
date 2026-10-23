// G7-06 section 6 (UNI-1378): every ```sh block of the harness README must be
// valid bash. The desktop block carried `cd <checkout>` — a redirection with no
// target, so `bash -n` refused it and whoever pasted it got a syntax error.
// It now names $UNIWORK_CHECKOUT, documented above the block.
//
// lib.test.mjs asserts the same rule; that file is the one the node --test
// lists in scripts/check.sh and .github/workflows/ci.yml already run, and this
// item's path list only allows job.test.mjs to be added to them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bashSyntaxError, shBlocks } from "./readme-sh-blocks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const README = readFileSync(join(HERE, "README.md"), "utf8");

test("shBlocks takes the sh fences only, in file order", () => {
  const markdown = [
    "# t",
    "```sh",
    "echo one",
    "```",
    "```diff",
    "--- a",
    "+++ b",
    "```",
    "```bash",
    "echo two",
    "```",
    "```sh",
    "echo three",
    "```",
    "",
  ].join("\n");
  // `bash` is not `sh`: the README's only other fences are diff/plain blocks,
  // and a language the helper does not know must not be checked as shell.
  assert.deepEqual(shBlocks(markdown), ["echo one", "echo three"]);
  assert.deepEqual(shBlocks("no fences here\n"), []);
});

test("every ```sh block of the harness README passes bash -n", () => {
  const blocks = shBlocks(README);
  assert.ok(blocks.length >= 2, `expected the README's sh blocks, found ${blocks.length}`);
  for (const [index, block] of blocks.entries()) {
    assert.equal(bashSyntaxError(block), null, `README sh block ${index + 1} fails bash -n`);
  }
});

test("the desktop block uses $UNIWORK_CHECKOUT and no angle-bracket placeholder", () => {
  const blocks = shBlocks(README);
  const desktop = blocks.find((block) => block.includes("start.sh --desktop"));
  assert.ok(desktop, "the README has no desktop block");
  assert.match(desktop, /cd "\$UNIWORK_CHECKOUT"/);
  assert.ok(!desktop.includes("<checkout>"), "the placeholder is back");
  // and the variable is documented above the block
  assert.match(README, /`UNIWORK_CHECKOUT` in the block below is the absolute path/);
});

test("the old placeholder would have failed bash -n (red case)", () => {
  // The mutation the fix answers: the block as it was before G7-06.
  const before = ['cd <checkout>', "export OFFICE_FORK_SHA=0d03b18"].join("\n");
  assert.notEqual(bashSyntaxError(before), null);
  // and the fixed form parses
  assert.equal(bashSyntaxError(['export UNIWORK_CHECKOUT="/path/to/uniwork"', 'cd "$UNIWORK_CHECKOUT"'].join("\n")), null);
});

test("the headless keyring section documents keyring-session.sh --exec wrapping start.sh and stop.sh in one session", () => {
  const blocks = shBlocks(README);
  const wrapped = blocks.find((block) => block.includes("keyring-session.sh --exec"));
  assert.ok(wrapped, "the README has no sh block showing keyring-session.sh --exec");
  assert.match(wrapped, /scripts\/office\/g5g6g7\/harness\/start\.sh/);
  assert.match(wrapped, /scripts\/office\/g5g6g7\/harness\/stop\.sh/);
  assert.equal(bashSyntaxError(wrapped), null);
});

test("the README documents the warm-run-dir rule: a previous start's recorded groups are stopped first, the userData is per start, and an app that is gone is a FAIL (ADDENDUM r5 G2)", () => {
  assert.match(README, /exit `1`|FAIL/, "the rule must say what an app that is gone means: a FAIL, not BLOCKED");
  assert.match(README, /pids/, "the README names the run dir's PID file the stop reuses");
  assert.match(README, /userdata\.previous-/, "the README names where the previous start's userdata goes");
  assert.match(README, /single-instance lock/, "the README explains why a second app on one userData is wrong");
  assert.match(README, /HARNESS_APP_SETTLE_SECONDS/, "the settle knob is in the environment table");
});

test("the README documents HARNESS_APP_STEP_TIMEOUT_MS (90000) and HARNESS_LOOP_TIMEOUT_MS (600000) for bounded app CDP steps and the per-loop watchdog (r6 H1)", () => {
  assert.match(README, /HARNESS_APP_STEP_TIMEOUT_MS/, "the per-step CDP timeout knob is in the README");
  assert.match(README, /90000/, "the default 90000 ms is documented");
  assert.match(README, /HARNESS_LOOP_TIMEOUT_MS/, "the per-loop watchdog knob is in the README");
  assert.match(README, /600000/, "the default 600000 ms is documented");
});

test("the README documents the docs tab close-readiness wait and HARNESS_DOCS_CLOSE_SETTLE_MS (2500) before aiOfficeTabs.close (r7 H2, r7b H2-1)", () => {
  assert.match(README, /docs tab not ready to close within/, "the README names the docs tab close-readiness timeout reason");
  assert.match(README, /onCloseCheck|__genofficeControl/, "the README names the docs renderer readiness signal waited on before aiOfficeTabs.close");
  assert.match(README, /HARNESS_DOCS_CLOSE_SETTLE_MS/, "the README documents HARNESS_DOCS_CLOSE_SETTLE_MS");
  assert.match(README, /2500/, "the default 2500 ms settle window is documented");
});
test("the README says the capture server gets a test-only AI_CREDENTIAL_KEY and why (RFE5-201)", () => {
  assert.match(README, /`AI_CREDENTIAL_KEY`/);
  assert.match(README, /test-only/);
  assert.match(README, /office\.ai_byok/);
});

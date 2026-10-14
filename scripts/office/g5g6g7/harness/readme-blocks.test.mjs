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
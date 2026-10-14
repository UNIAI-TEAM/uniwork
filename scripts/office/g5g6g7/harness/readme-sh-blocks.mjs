// The G7-06 section 6 mechanical rule, small enough to live in one helper:
// every ```sh block of scripts/office/g5g6g7/harness/README.md must be valid
// bash. The desktop block used to say `cd <checkout>`, which a reader pastes
// into a terminal and bash answers with a syntax error; it now names
// $UNIWORK_CHECKOUT, and this helper is how the rule is checked.
//
// Two files consume it — readme-blocks.test.mjs (the focused cases) and
// lib.test.mjs (which the node --test lists already run) — so the rule holds
// in CI without touching those lists for a second file.
import { spawnSync } from "node:child_process";

/**
 * Every fenced ```sh block of a markdown document, in file order. A fence with
 * any other language (a diff, a plain block) is not a shell script.
 * @param {string} markdown
 * @returns {string[]}
 */
export function shBlocks(markdown) {
  const blocks = [];
  let language = null;
  let current = [];
  for (const line of String(markdown).split(/\r?\n/)) {
    const fence = /^```(\S*)\s*$/.exec(line);
    if (language === null) {
      if (fence) language = fence[1];
      continue;
    }
    if (/^```\s*$/.test(line)) {
      if (language === "sh") blocks.push(current.join("\n"));
      language = null;
      current = [];
      continue;
    }
    current.push(line);
  }
  return blocks;
}

/**
 * `bash -n` on a script read from stdin: null when it parses, the shell's own
 * complaint when it does not. -n never runs the script, so a block that opens
 * ports or touches a checkout is safe to check here.
 * @param {string} script
 * @returns {string | null}
 */
export function bashSyntaxError(script) {
  const run = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
  if (run.error) return run.error.message;
  if (run.status === 0) return null;
  return (run.stderr ?? "").trim() || `bash -n exited ${run.status}`;
}
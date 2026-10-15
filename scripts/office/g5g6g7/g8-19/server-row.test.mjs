// g8-19/server-row.sh (UNI-1414 T4): the Go/node checks of G8-A03/A05/A06/A08,
// the commands of contract-collab.md section 12, and the two guards (no passing
// test, a -run test that was SKIPped) that keep a row from passing on nothing.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
const SCRIPT = join(HERE, "server-row.sh");
const COLLAB = join(REPO, "docs/office/g5g6g7/contract-collab.md");

const sh = (args, env = {}) => spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 30_000 });
const plan = (row) => sh([row, "--dry-run"]).stdout.split("\n").filter((l) => l.startsWith("PLAN"));
const normalize = (text) => text.replace(/PLAN (\(cd server\) )?/, "").replace(/ -count=1 -v/, "").replace(/'/g, "").replace(/\\\|/g, "|").trim();

/** the `go test` / `node --test` commands of one AC row of contract-collab.md section 12 */
function documentedCommands(row) {
  const line = readFileSync(COLLAB, "utf8").split("\n").find((l) => l.startsWith(`| ${row} |`));
  assert.ok(line, `${row} is a row of contract-collab.md section 12`);
  const out = [];
  for (const m of line.matchAll(/`((?:go test|node --test) [^`]+)`/g)) out.push(m[1].replace(/\\\|/g, "|").replace(/'/g, "").trim());
  return out;
}

test("the planned commands are the ones contract-collab.md section 12 lists for each row (go and node only)", () => {
  for (const row of ["G8-A03", "G8-A05", "G8-A06", "G8-A08"]) {
    const planned = plan(row).map(normalize);
    assert.ok(planned.length > 0, `${row} plans something`);
    const wanted = documentedCommands(row);
    for (const cmd of planned) assert.ok(wanted.includes(cmd), `${row}: planned "${cmd}" is not documented; documented: ${wanted.join(" || ")}`);
    for (const cmd of wanted) assert.ok(planned.includes(cmd), `${row}: documented "${cmd}" is not planned; planned: ${planned.join(" || ")}`);
  }
});

test("--dry-run runs nothing and --then is only echoed; an unknown row or argument exits 2", () => {
  const out = sh(["G8-A05", "--dry-run", "--then", "node", "x.mjs"]);
  assert.equal(out.status, 0);
  assert.match(out.stdout, /PLAN then node x\.mjs/);
  assert.equal(sh(["G8-A99", "--dry-run"]).status, 2);
  assert.equal(sh([]).status, 2);
  assert.equal(sh(["G8-A03", "--bogus"]).status, 2);
});

// ---- the guards, with a stub `go` on PATH ---------------------------------------

let bin;
beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), "g819-server-row-"));
  const go = join(bin, "go");
  writeFileSync(
    go,
    `#!/usr/bin/env bash
case "\${STUB_GO:-pass}" in
  pass) echo "=== RUN TestA"; echo "--- PASS: TestA (0.00s)"; echo "PASS"; echo "ok  stub/pkg 0.01s"; exit 0 ;;
  nothing) echo "ok  stub/pkg 0.01s [no tests to run]"; exit 0 ;;
  skip) echo "--- SKIP: TestDocumentCommentKind (0.00s)"; echo "--- PASS: TestOther (0.00s)"; echo "ok  stub/pkg 0.01s"; exit 0 ;;
  fail) echo "--- FAIL: TestA (0.00s)"; echo "FAIL"; exit 1 ;;
esac
`,
  );
  chmodSync(go, 0o755);
});
afterEach(() => rmSync(bin, { recursive: true, force: true }));
const withStub = (mode) => ({ PATH: `${bin}:${process.env.PATH}`, STUB_GO: mode });

test("a passing go run passes the row; the filtered output is kept", () => {
  const out = sh(["G8-A06"], withStub("pass"));
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /ok  stub\/pkg/);
  assert.match(out.stdout, /G8-A06 server checks passed/);
});

test("a go run that matched no test is FAIL even though go exited 0", () => {
  const out = sh(["G8-A06"], withStub("nothing"));
  assert.equal(out.status, 1);
  assert.match(out.stdout, /no test passed/);
});

test("a test named by -run that was SKIPped is FAIL; the same skip without -run (./migrations) is only listed", () => {
  const strict = sh(["G8-A06"], withStub("skip"));
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /was not run/);
  assert.match(strict.stdout, /--- SKIP: TestDocumentCommentKind/);
  // G8-A03 runs the -run group first (fails on the skip) and ./migrations after it; both report
  assert.equal(sh(["G8-A03"], withStub("skip")).status, 1);
});

test("a failing go run is FAIL (1) and the --then command is not run", () => {
  const marker = join(bin, "then-ran");
  const out = sh(["G8-A06", "--then", "touch", marker], withStub("fail"));
  assert.equal(out.status, 1);
  assert.match(out.stdout, /FAILED/);
  assert.throws(() => readFileSync(marker), /ENOENT/);
});

test("--then runs after success and its exit code is the row's (77 stays 77, 0 stays 0, 1 stays 1)", () => {
  assert.equal(sh(["G8-A05", "--then", "bash", "-c", "exit 77"], withStub("pass")).status, 77);
  assert.equal(sh(["G8-A05", "--then", "true"], withStub("pass")).status, 0);
  assert.equal(sh(["G8-A05", "--then", "bash", "-c", "exit 1"], withStub("pass")).status, 1);
});

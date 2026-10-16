// FIX-9 (BE review r3, UNI-1380 G7-03a): R3-3a FQ-20 names why a crash killed nothing, runAppCases turns a
// server dead before seeding into BLOCKED rows.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-r3a.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { QUEUE_DRIVERS } from "./app-case-drivers.mjs";
import { runAppCases } from "./app-cases.mjs";
import { BLOCKED_EXIT_CODE, selectAppCases } from "./app-cases-lib.mjs";
import { caseExpect } from "./case-expect.mjs";
import { loadFaultCases } from "./server-cases-lib.mjs";

const doc = loadFaultCases();
const row = (id) => doc.cases.find((r) => r.id === id);

/** Why the `ps -eo pid=,ppid=,pgid=` table this test reads is unavailable on this host (Windows has none), or null. */
const PS_SKIP = (() => {
  const ps = spawnSync("ps", ["-eo", "pid=,ppid=,pgid="], { encoding: "utf8" });
  if (ps.error) return `ps is unavailable on this host: ${ps.error.message}`;
  return String(ps.stdout ?? "").trim() ? null : "ps gave no process table on this host";
})();

// ---- R3-3a: FQ-20 `app_process_tree_killed` -------------------------------------------

test("R3-3a: FQ-20's app_process_tree_killed says '0 pids: <cause>' and is not ok when the crash killed nothing", { skip: PS_SKIP ?? false }, async () => {
  const fq20 = row("FQ-20");
  const page = {
    url: () => "app://docs/editor",
    evaluate: async () => true,
    locator: () => ({ first: () => ({ click: async () => {} }) }),
    keyboard: { type: async () => {}, press: async () => {} },
  };
  // a pid no process has: crash() signals nothing and records why
  const session = {
    pid: 2_000_000_000, dead: false,
    app: { windows: () => [page], close: async () => {} },
    shell: { evaluate: async () => ({ path: "/tmp/fq20.docx", documentId: "doc-1", access: "edit" }) },
  };
  let launches = 0;
  const ctx = {
    row: fq20, kind: "docx", marker: "G703AFQ20X1", expect: caseExpect(fq20, null),
    now: () => new Date().toISOString(),
    sleep: async () => {},
    sha256File: () => "snapshot-n",
    newDocument: async () => ({ id: "doc-1" }),
    launch: async () => (launches++ === 0 ? session : {}),
    caseRules: () => [],
    setRules: async () => {},
    clearRules: async () => {},
    waitState: async (_id, states) => (states === "paused_offline" ? { to: "paused_offline" } : { to: "queued" }),
    waitSignedIn: async () => {},
    trace: () => [],
    proxyLog: async () => [],
    newestVersion: async () => null,
    versionDelta: async () => 0,
  };
  const outcome = await QUEUE_DRIVERS["FQ-20"](ctx);
  const killed = outcome.assertions.find((a) => a.name === "app_process_tree_killed");
  assert.ok(killed, "the assertion exists");
  assert.equal(killed.ok, false, "0 pids killed is not ok");
  assert.equal(killed.expected, ">= 1 pid");
  assert.match(session.crashCause, /pid 2000000000 is not in ps/);
  assert.equal(killed.actual, `0 pids: ${session.crashCause}`);
  assert.equal(outcome.assertions.find((a) => a.name === "paused_offline_before_crash").ok, true, "the rest of the run is read as usual");
});

// ---- R3-3a: runAppCases, a server dead before seeding ---------------------------------

test("R3-3a: runAppCases with the server dead before seeding returns BLOCKED rows, the HARNESS_DOWN line and 77", async () => {
  const DOWN = "harness server down (killed at unknown?): /healthz: fetch failed";
  const runDir = mkdtempSync(join(tmpdir(), "app-cases-r3-"));
  writeFileSync(join(runDir, "ports.env"), "API_ORIGIN=http://127.0.0.1:9\n");
  const written = [];
  const realWrite = process.stdout.write;
  const evidenceId = process.env.OFFICE_EVIDENCE_ID;
  process.env.OFFICE_EVIDENCE_ID = "r3-test"; // the evidence ledger belongs to the evidence runner, not this test
  process.stdout.write = (chunk, ...rest) => {
    written.push(String(chunk));
    return typeof rest.at(-1) === "function" ? rest.at(-1)() : true;
  };
  let probes = 0;
  let seeded = 0;
  let out;
  try {
    out = await runAppCases({
      runDir,
      deps: {
        loadPlaywright: () => ({}),
        preconditions: async () => null,
        harnessDown: async () => { probes += 1; return DOWN; },
        seedAppTenant: async () => { seeded += 1; return {}; },
      },
    });
  } finally {
    process.stdout.write = realWrite;
    if (evidenceId === undefined) delete process.env.OFFICE_EVIDENCE_ID;
    else process.env.OFFICE_EVIDENCE_ID = evidenceId;
    rmSync(runDir, { recursive: true, force: true });
  }
  const { runnable } = selectAppCases(doc);
  assert.ok(runnable.length >= 10);
  assert.deepEqual(out.results.map((r) => r.case), runnable.map((r) => r.id), "one BLOCKED result per ready row");
  for (const result of out.results) {
    assert.equal(result.result, "BLOCKED", result.case);
    assert.ok(result.blocker.includes(DOWN), `${result.case}: ${result.blocker}`);
  }
  assert.equal(out.exitCode, BLOCKED_EXIT_CODE);
  assert.equal(out.exitCode, 77);
  assert.equal(seeded, 0, "the seed never ran");
  assert.equal(probes, 1, "one probe before seeding, none from the row loop");
  assert.ok(written.includes(`HARNESS_DOWN before seeding: ${DOWN}; no app row runs\n`), written.join(""));
});

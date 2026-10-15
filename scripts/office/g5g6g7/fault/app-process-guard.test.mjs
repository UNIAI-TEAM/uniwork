// FIX-6 guards of the G7-03a app-layer fault runner (UNI-1380, WI-4): a crash
// never signals a pid outside the tree this runner launched, and a dead harness
// server makes the case BLOCKED instead of a column of ECONNREFUSED FAILs.
// Run: node --test scripts/office/g5g6g7/fault/app-process-guard.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { blockedCase, caseResult, runResult } from "./app-cases-lib.mjs";
import {
  crashTargets, guardCaseResult, harnessDownReason, harnessPidsFromFile, ownGroupTarget, parsePsTable, seedBehindGuard, serverShutdownOf,
} from "./app-process-guard.mjs";

// pid ppid pgid. 500 = the runner (group 400, under dbus-run-session 400).
// 600 = the Electron Playwright spawned (detached: own group 600) with its
// zygote/renderers; 700 = harness server, 710 = harness web (+ next 711),
// 720 = harness app group (xvfb-run + Xvfb 721 + Electron 722), all setsid and
// reparented to 1; 730 = some other user's process.
const PS = [
  "    1     0     1",
  "  400     1   400",
  "  500   400   400",
  "  600   500   600",
  "  601   600   600",
  "  602   601   600",
  "  603   600   600",
  "  700     1   700",
  "  710     1   710",
  "  711   710   710",
  "  720     1   720",
  "  721   720   720",
  "  722   720   720",
  "  730     1   730",
].join("\n");
const HARNESS = [700, 710, 720];

test("parsePsTable reads pid, ppid and pgid, and tolerates a two-column ps", () => {
  const table = parsePsTable(PS);
  assert.deepEqual(table.get(602), { pid: 602, ppid: 601, pgid: 600 });
  assert.deepEqual(parsePsTable("  10  1\n junk\n").get(10), { pid: 10, ppid: 1, pgid: null });
});

test("harnessPidsFromFile reads stop.sh's `<name> <pid> <port>` lines", () => {
  assert.deepEqual(harnessPidsFromFile("server 700 40947\nweb 710 33289\napp 720 0\nhandoff 740 0\n\nbad x 1\n"), [700, 710, 720, 740]);
  assert.deepEqual(harnessPidsFromFile(""), []);
});

test("crashTargets is the launched Electron's tree, deepest first, the root last", () => {
  const pids = crashTargets(PS, { root: 600, runnerPid: 500, protectedPids: HARNESS });
  assert.equal(pids.at(-1), 600);
  assert.deepEqual([...pids].sort((a, b) => a - b), [600, 601, 602, 603]);
  assert.ok(pids.indexOf(602) < pids.indexOf(601), "a grandchild goes before its parent");
});

test("crashTargets never includes a pid outside the launched tree", () => {
  const outside = [1, 400, 500, 700, 710, 711, 720, 721, 722, 730];
  for (const root of [600, 601, 700, 720, 500, 400, 1, 0, -1, undefined, null, Number.NaN]) {
    const pids = crashTargets(PS, { root, runnerPid: 500, protectedPids: HARNESS });
    for (const pid of outside) assert.ok(!pids.includes(pid), `root ${root} must not reach ${pid}`);
  }
});

test("crashTargets refuses a root that is not the runner's own child (gone or reused pid)", () => {
  // the harness's pids are never roots: they are children of 1, not of the runner
  assert.deepEqual(crashTargets(PS, { root: 700, runnerPid: 500, protectedPids: [] }), []);
  assert.deepEqual(crashTargets(PS, { root: 720, runnerPid: 500, protectedPids: [] }), []);
  // the launched Electron is gone and its pid now belongs to someone else's process
  const reused = PS.replace("  600   500   600", "  600     1   600");
  assert.deepEqual(crashTargets(reused, { root: 600, runnerPid: 500, protectedPids: HARNESS }), []);
  // gone entirely; and the runner itself is never a root
  assert.deepEqual(crashTargets(PS, { root: 999, runnerPid: 500 }), []);
  assert.deepEqual(crashTargets(PS, { root: 500, runnerPid: 500 }), []);
  assert.deepEqual(crashTargets(PS, { root: 600, runnerPid: undefined }), []);
});

test("crashTargets drops a descendant in a harness group or in the runner's own group", () => {
  // a child of the launched Electron that joined the harness server's group, one
  // that is itself a recorded harness pid, and one in the runner's group
  const tangled = `${PS}\n  650   600   700\n  651   600   651\n  652   600   400\n  653   650   700\n`;
  const pids = crashTargets(tangled, { root: 600, runnerPid: 500, protectedPids: [...HARNESS, 651] });
  for (const pid of [650, 651, 652, 653]) assert.ok(!pids.includes(pid), `${pid} is fenced`);
  assert.ok(pids.includes(603));
  // a root that sits in a fenced group is refused as a whole
  const rootInHarnessGroup = PS.replace("  600   500   600", "  600   500   700");
  assert.deepEqual(crashTargets(rootInHarnessGroup, { root: 600, runnerPid: 500, protectedPids: HARNESS }), []);
});

test("ownGroupTarget signals only the group of a real spawned pid", () => {
  assert.equal(ownGroupTarget(4242), -4242);
  for (const bad of [undefined, null, 0, 1, -5, 3.5, Number.NaN]) assert.equal(ownGroupTarget(bad), null, String(bad));
});

const SERVER_LOG = [
  "08:09:07.949 INF http request method=GET path=/api/v1/documents/x status=200",
  "08:09:32.263 INF shutting down component=server signal=terminated",
  "08:09:32.263 INF stopped component=server",
].join("\n");

test("serverShutdownOf finds the last shutdown line and its signal", () => {
  assert.deepEqual(serverShutdownOf(SERVER_LOG), { ts: "08:09:32.263", signal: "terminated" });
  assert.equal(serverShutdownOf("08:00:00.000 INF http request\n"), null);
  assert.equal(serverShutdownOf(undefined), null);
});

test("harnessDownReason: null while /healthz is ok, else the BLOCKED reason with the kill time", () => {
  assert.equal(harnessDownReason({ ok: true, serverLogText: SERVER_LOG, pidFilePresent: false }), null);
  const killed = harnessDownReason({ ok: false, error: "fetch failed; cause ECONNREFUSED", serverLogText: SERVER_LOG, pidFilePresent: false });
  assert.match(killed, /^harness server down \(killed at 08:09:32\.263\?\)/);
  assert.match(killed, /ECONNREFUSED/);
  assert.match(killed, /signal=terminated/);
  assert.match(killed, /pids file is gone \(harness stop\.sh ran\)/);
  const unknown = harnessDownReason({ ok: false, status: 503, serverLogText: "", pidFilePresent: true });
  assert.match(unknown, /^harness server down \(killed at unknown\?\): \/healthz answered 503$/);
});

const ROW = { id: "FQ-22", ac: ["G5-A06"], fixture: "f", notes: "predicted FAIL OQ-F11" };
const failed = caseResult(ROW, [runResult({ assertions: [{ name: "run_execution", expected: "x", actual: "ECONNREFUSED", ok: false }], predicted: "OQ-F11" })]);
const passed = caseResult(ROW, [runResult({ assertions: [{ name: "a", expected: 1, actual: 1, ok: true }] })]);

test("guardCaseResult leaves every result alone while the server is up", () => {
  assert.equal(guardCaseResult(failed, null), failed);
  assert.equal(guardCaseResult(passed, null, { complete: false }), passed);
});

test("guardCaseResult turns a FAIL against a dead server into BLOCKED with the reason, dropping the predicted tag", () => {
  const reason = "harness server down (killed at 08:09:32.263?): /healthz: fetch failed";
  const guarded = guardCaseResult(failed, reason);
  assert.equal(failed.result, "FAIL");
  assert.equal(guarded.result, "BLOCKED");
  assert.equal(guarded.blocker, reason);
  assert.equal(guarded.resultBeforeBlock, "FAIL");
  assert.equal("predicted" in guarded, false);
  assert.deepEqual(guarded.assertions, failed.assertions, "the failing assertions stay as evidence");
});

test("guardCaseResult keeps a complete PASS, blocks a PASS cut short, and keeps a BLOCKED row", () => {
  const reason = "harness server down (killed at unknown?): /healthz answered 503";
  assert.equal(guardCaseResult(passed, reason), passed);
  assert.equal(guardCaseResult(passed, reason, { complete: false }).result, "BLOCKED");
  const pending = blockedCase(ROW, "pending G5-10");
  assert.equal(guardCaseResult(pending, reason), pending);
});

test("FIX-6-2: a BLOCKED downgrade leaves no predicted tag at the case level or on any exit; a kept result keeps its tags", () => {
  const fq40 = caseResult({ ...ROW, id: "FQ-40" }, [
    runResult({ label: "reconciling -> committed", assertions: [{ name: "version_delta", expected: 1, actual: 0, ok: false }], predicted: "OQ-F11" }),
    runResult({ label: "reconciling -> queued", assertions: [{ name: "a", expected: 1, actual: 1, ok: true }] }),
  ]);
  assert.equal(fq40.predicted, "OQ-F11");
  assert.equal(fq40.exits[0].predicted, "OQ-F11");
  const guarded = guardCaseResult(fq40, "harness server down (killed at unknown?): /healthz: fetch failed");
  assert.equal(guarded.result, "BLOCKED");
  assert.equal("predicted" in guarded, false);
  for (const exit of guarded.exits) assert.equal("predicted" in exit, false, `exit ${exit.label}`);
  assert.deepEqual(guarded.exits.map((e) => e.result), ["FAIL", "PASS"], "the exits' own results stay as evidence");
  assert.equal(fq40.exits[0].predicted, "OQ-F11", "the input is not mutated");
  // a complete PASS and a FAIL that is not downgraded (server up) keep everything
  const complete = caseResult(ROW, [runResult({ assertions: [{ name: "a", expected: 1, actual: 1, ok: true }], predicted: "OQ-F11" })]);
  assert.equal(guardCaseResult(complete, "down"), complete);
  assert.equal(guardCaseResult(fq40, null).exits[0].predicted, "OQ-F11");
  assert.equal(guardCaseResult(fq40, null).predicted, "OQ-F11");
});

const DOWN = "harness server down (killed at unknown?): /healthz: fetch failed";

test("FIX-6-4: a server already dead before seeding gives the guard's reason and never calls seed", async () => {
  let seeded = 0;
  const out = await seedBehindGuard({ probe: async () => DOWN, seed: async () => { seeded += 1; return {}; } });
  assert.deepEqual(out, { downReason: DOWN });
  assert.equal(seeded, 0);
  // and that reason turns every ready row into a BLOCKED case with it
  const blocked = blockedCase(ROW, out.downReason);
  assert.equal(blocked.result, "BLOCKED");
  assert.equal(blocked.blocker.includes("harness server down"), true);
});

test("FIX-6-4: a failing seed against a server that died meanwhile is BLOCKED; with the server up it is rethrown", async () => {
  const dies = [null, DOWN];
  const died = await seedBehindGuard({ probe: async () => dies.shift(), seed: async () => { throw new Error("fetch failed"); } });
  assert.deepEqual(died, { downReason: DOWN });
  await assert.rejects(seedBehindGuard({ probe: async () => null, seed: async () => { throw new Error("signup refused"); } }), /signup refused/);
  const tenant = { owner: "o" };
  assert.deepEqual(await seedBehindGuard({ probe: async () => null, seed: async () => tenant }), { tenant });
});

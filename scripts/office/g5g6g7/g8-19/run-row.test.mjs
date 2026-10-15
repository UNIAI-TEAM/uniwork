// g8-19/run-row.mjs (UNI-1414): the gate, ports.env, the exit mapping
// 0 PASS / 1 FAIL / 77 BLOCKED-with-a-blocker, the artifact per row and
// fixture, the watchdog, and the ctx a row module gets.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { createFakeWorld } from "./fake-world.mjs";
import { decideFromSteps, runRowModule, rowArtifactPath } from "./run-row.mjs";

let runDir;
beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "g819-row-"));
  writeFileSync(join(runDir, "ports.env"), "API_ORIGIN=http://127.0.0.1:9\nWEB_ORIGIN=http://127.0.0.1:8\nOFFICE_FORK_SHA=7d665a54\n");
  writeFileSync(join(runDir, "start-status.json"), JSON.stringify({ state: "up" }));
});
afterEach(() => rmSync(runDir, { recursive: true, force: true }));

const opts = (extra = {}) => ({ row: "G8-A01", fixture: "fx-docx-report-vi", runDir, module: "comments", timeoutMs: 2_000, ...extra });
const artifact = (row = "G8-A01", fixture = "fx-docx-report-vi") => JSON.parse(readFileSync(rowArtifactPath(runDir, row, fixture), "utf8"));

test("PASS -> 0, with the artifact at reports/g7-qa/g8-a01/<fixture>.json", async () => {
  const exit = await runRowModule(opts(), async (ctx) => {
    await ctx.step("create", async () => ({ status: "PASS", details: { rows: 1 } }));
    return {};
  });
  assert.equal(exit, 0);
  const a = artifact();
  assert.deepEqual([a.row, a.fixture, a.module, a.status, a.exitCode, a.forkSha], ["G8-A01", "fx-docx-report-vi", "comments", "PASS", 0, "7d665a54"]);
  assert.equal(a.steps.create.status, "PASS");
  assert.deepEqual(a.steps.create.details, { rows: 1 });
  assert.equal(typeof a.steps.create.elapsedMs, "number");
  assert.ok(a.startedAt && a.finishedAt);
});

test("a step that returns nothing is PASS; a throwing step is FAIL with a redacted reason; FAIL -> 1", async () => {
  const exit = await runRowModule(opts(), async (ctx) => {
    await ctx.step("ok", async () => undefined);
    await ctx.step("boom", async () => {
      throw new Error("PUT failed with Bearer abc.def.ghi at uniwork-office-dev://open?ticket=T1");
    });
    return {};
  });
  assert.equal(exit, 1);
  const a = artifact();
  assert.equal(a.steps.ok.status, "PASS");
  assert.equal(a.steps.boom.status, "FAIL");
  assert.ok(!/abc\.def\.ghi|T1/.test(a.steps.boom.reason), a.steps.boom.reason);
  assert.equal(a.status, "FAIL");
});

test("BLOCKED with a named blocker -> 77; BLOCKED without one is rewritten to FAIL -> 1", async () => {
  const blocked = await runRowModule(opts({ row: "G8-A02", fixture: "fx-xlsx-revenue-xyz" }), async (ctx) => {
    await ctx.step("desktop", async () => ({ status: "PASS" }));
    await ctx.step("web->desktop", async () => ctx.block("web frame pin 05fd209 lacks G8-12..15 (R1)", "lead-f"));
    return {};
  });
  assert.equal(blocked, 77);
  const a = artifact("G8-A02", "fx-xlsx-revenue-xyz");
  assert.equal(a.status, "BLOCKED");
  assert.equal(a.blocker, "web frame pin 05fd209 lacks G8-12..15 (R1)");
  assert.equal(a.owner, "lead-f");
  const unnamed = await runRowModule(opts(), async () => ({ status: "BLOCKED", reason: "x" }));
  assert.equal(unnamed, 1);
  assert.equal(artifact().status, "FAIL");
  assert.match(artifact().reason, /BLOCKED without a named blocker/);
});

test("an explicit record status wins over the steps; a throw from the module is FAIL -> 1", async () => {
  assert.equal(await runRowModule(opts(), async (ctx) => {
    await ctx.step("a", async () => ({ status: "PASS" }));
    return { status: "FAIL", reason: "decideG8A01 said two rows" };
  }), 1);
  assert.equal(artifact().reason, "decideG8A01 said two rows");
  assert.equal(await runRowModule(opts(), async () => {
    throw new Error("module crashed");
  }), 1);
  assert.match(artifact().reason, /module crashed/);
});

test("no steps and no status is FAIL", async () => {
  assert.equal(await runRowModule(opts(), async () => ({})), 1);
  assert.equal(artifact().reason, "no steps ran");
});

test("watchdog: the running step and the row FAIL with 'row watchdog', and the artifact is written", async () => {
  const exit = await runRowModule(opts({ timeoutMs: 50 }), async (ctx) => {
    await ctx.step("done", async () => ({ status: "PASS" }));
    await ctx.step("hangs", () => new Promise(() => {}));
    return {};
  });
  assert.equal(exit, 1);
  const a = artifact();
  assert.equal(a.status, "FAIL");
  assert.equal(a.reason, "row watchdog");
  assert.equal(a.steps.hangs.status, "FAIL");
  assert.equal(a.steps.hangs.reason, "row watchdog");
  assert.equal(a.steps.done.status, "PASS");
});

test("start gate: blocked -> 77 with the start blocker, failed -> 1, and the module never runs", async () => {
  let ran = false;
  writeFileSync(join(runDir, "start-status.json"), JSON.stringify({ state: "blocked", reason: "no keyring" }));
  assert.equal(await runRowModule(opts(), async () => {
    ran = true;
    return {};
  }), 77);
  assert.equal(artifact().blocker, "start.sh reported BLOCKED: no keyring");
  writeFileSync(join(runDir, "start-status.json"), JSON.stringify({ state: "failed", reason: "server" }));
  assert.equal(await runRowModule(opts(), async () => {
    ran = true;
    return {};
  }), 1);
  assert.equal(ran, false);
});

test("ports.env missing or without API_ORIGIN -> FAIL 1", async () => {
  rmSync(join(runDir, "ports.env"));
  assert.equal(await runRowModule(opts(), async () => ({ status: "PASS" })), 1);
  assert.match(artifact().reason, /no ports\.env/);
  writeFileSync(join(runDir, "ports.env"), "WEB_ORIGIN=http://x\n");
  assert.equal(await runRowModule(opts(), async () => ({ status: "PASS" })), 1);
  assert.match(artifact().reason, /API_ORIGIN/);
});

test("the artifact is truncated at the start of a run: a stale one never survives", async () => {
  const path = rowArtifactPath(runDir, "G8-A01", "fx-docx-report-vi");
  mkdirSync(join(runDir, "reports", "g7-qa", "g8-a01"), { recursive: true });
  writeFileSync(path, '{"status":"PASS","stale":true}');
  await runRowModule(opts({ timeoutMs: 20 }), () => new Promise(() => {}));
  assert.equal(artifact().stale, undefined);
  assert.ok(existsSync(path));
});

test("ctx: ports, origins, a memoised world from the injected factory, api sessions and a redacted log", async () => {
  const fake = createFakeWorld();
  let seeded = 0;
  await runRowModule(opts({ worldFactory: async () => ((seeded += 1), fake.world) }), async (ctx) => {
    assert.equal(ctx.apiOrigin, "http://127.0.0.1:9");
    assert.equal(ctx.webOrigin, "http://127.0.0.1:8");
    assert.equal(ctx.portsEnv.OFFICE_FORK_SHA, "7d665a54");
    assert.equal(ctx.row, "G8-A01");
    assert.equal(ctx.fixture, "fx-docx-report-vi");
    assert.equal(await ctx.getWorld(), fake.world);
    assert.equal(await ctx.getWorld(), fake.world);
    assert.equal(typeof ctx.api.session, "function");
    ctx.log("seeded with token=abc123 for the row");
    await ctx.step("a", async () => ({ status: "PASS" }));
    return { details: { note: "x" } };
  });
  assert.equal(seeded, 1);
  const a = artifact();
  assert.deepEqual(a.details.note, "x");
  assert.equal(a.details.multiOrg.status, "SEEDED", "the world's multiOrg marker is copied into the artifact");
  assert.ok(a.log.some((l) => /seeded with token=<redacted>/.test(l)), JSON.stringify(a.log));
});

test("rowMain: parses the CLI args, prints one status line and returns the exit code; G819_WRITE_EVIDENCE=1 appends the ledger line", async () => {
  const { rowMain } = await import("./run-row.mjs");
  const printed = [];
  const orig = console.log;
  console.log = (...a) => printed.push(a.join(" "));
  try {
    const argv = ["--row", "G8-A09", "--fixture", "fx-docx-report-vi", "--run-dir", runDir];
    const exit = await rowMain("account", async (ctx) => {
      await ctx.step("a", async () => ctx.block("G819_ALLOW_SQL_MEMBERSHIP is not 1", "g7-qa"));
      return {};
    }, { argv, env: { G819_WRITE_EVIDENCE: "1" } });
    assert.equal(exit, 77);
    assert.match(printed.join("\n"), /^G8-A09 fx-docx-report-vi BLOCKED: a: G819_ALLOW_SQL_MEMBERSHIP is not 1/);
    const lines = readFileSync(join(runDir, "evidence.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].requirementId ?? lines[0].requirement_id ?? lines[0].req, "G8-A09");
    assert.equal(JSON.stringify(lines[0]).includes("G819_ALLOW_SQL_MEMBERSHIP is not 1"), true);
  } finally {
    console.log = orig;
  }
});

test("decideFromSteps: a NOT_JUDGED check that cascades from a failing check adds no FAIL reason, and never makes a PASS", () => {
  const cascade = { status: "NOT_JUDGED", reason: "not judged: check:a failed first", cascadeFrom: "check:a" };
  const failed = decideFromSteps({ "check:a": { status: "FAIL", reason: "boom" }, "check:b": cascade, "check:c": { status: "PASS" } });
  assert.deepEqual(failed, { status: "FAIL", reason: "check:a: boom" });
  // the named source passed (or does not exist): nothing explains it, so it is a FAIL of its own
  const orphan = decideFromSteps({ "check:a": { status: "PASS" }, "check:b": cascade });
  assert.equal(orphan.status, "FAIL");
  assert.equal(orphan.reason, "check:b: not judged: check:a failed first");
  assert.equal(decideFromSteps({ "check:b": { ...cascade, cascadeFrom: "check:zz" } }).status, "FAIL");
  // a NOT_JUDGED beside a BLOCKED (no FAIL) is still a FAIL, never BLOCKED or PASS
  assert.equal(decideFromSteps({ "check:a": { status: "BLOCKED", blocker: "x" }, "check:b": { ...cascade, cascadeFrom: "check:a" } }).status, "FAIL");
});

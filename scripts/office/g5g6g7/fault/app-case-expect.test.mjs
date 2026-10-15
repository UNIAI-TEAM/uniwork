// R1-2 for the app rows: cases.json `expect` is the single source of truth, so an app driver reads its
// numbers from `ctx.expect` (case-expect.mjs) and never from a literal. The drivers drive Electron, so
// these tests hold them with stub contexts and a scan of their source.
// Run: node --test scripts/office/g5g6g7/fault/app-case-expect.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { countAssertion, deltaAssertion, oneIntent, pathAssertion, sameKey } from "./app-case-drivers.mjs";
import { EXTRA_EXITS } from "./app-case-drivers-blocked.mjs";
import { expandExits, selectAppCases } from "./app-cases-lib.mjs";
import { PROXY_LOG_KEYS, caseExpect, validateExpect } from "./case-expect.mjs";
import { loadFaultCases } from "./server-cases-lib.mjs";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const DRIVER_SOURCE = ["app-case-drivers.mjs", "app-case-drivers-blocked.mjs"].map((f) => readFileSync(here(f), "utf8")).join("\n");
const selected = selectAppCases(loadFaultCases());
const rows = selected.runnable;
// every app row, ready or pending: a pending row's expectation must be readable the day it becomes runnable (review r2 R2-2)
const everyAppRow = [...selected.runnable, ...selected.blocked.map((b) => b.row)];
// the runs app-cases.mjs makes: one per exit, plus FQ-43's real-condition extras
const runsOf = (row) => [...expandExits(row), ...(EXTRA_EXITS[row.id] ?? []).map((exit, i) => ({ index: (row.exits?.length ?? 0) + i + 1, label: exit.exit, exit }))];

test("every ready app row's expect is sound and resolves a version delta for every run", () => {
  assert.ok(rows.length >= 10);
  for (const row of rows) {
    assert.deepEqual(validateExpect(row), [], row.id);
    for (const run of runsOf(row)) {
      const delta = caseExpect(row, run.exit).versionDelta();
      assert.ok(Number.isInteger(delta) && delta >= 0, `${row.id} / ${run.label}: versionDelta ${delta}`);
    }
  }
});

test("every app row, ready and pending, resolves an integer versionDelta for every run and exit", () => {
  assert.ok(everyAppRow.length > rows.length, "the pending rows are included");
  const ids = new Set(everyAppRow.map((r) => r.id));
  for (const id of ["FQ-26", "FQ-27"]) assert.ok(ids.has(id), `${id} is an app row`);
  for (const row of everyAppRow) {
    assert.deepEqual(validateExpect(row), [], row.id);
    for (const run of runsOf(row)) {
      const delta = caseExpect(row, run.exit).versionDelta();
      assert.ok(Number.isInteger(delta) && delta >= 0, `${row.id} / ${run.label}: versionDelta ${JSON.stringify(delta)}`);
    }
  }
  // the numbers FQ-26 / FQ-27 published per run are the ones their exits resolve
  const delta = (id, label) => {
    const row = everyAppRow.find((r) => r.id === id);
    return caseExpect(row, row.exits.find((e) => e.exit === label)).versionDelta();
  };
  assert.deepEqual(["Ghi đè", "Tải lại", "Lưu thành bản sao"].map((l) => delta("FQ-26", l)), [1, 0, 0]);
  assert.deepEqual(["lần 1: Lưu sau AI", "lần 2: thiết bị B commit trước khi Lưu"].map((l) => delta("FQ-27", l)), [1, 0]);
});

test("a {run: count} map is not a versionDelta", () => {
  const row = structuredClone(everyAppRow.find((r) => r.id === "FQ-26"));
  row.expect.server.versionDelta = { overwrite: 1, reload: 0 };
  assert.match(validateExpect(row).join(" "), /versionDelta is not a count/);
  assert.throws(() => caseExpect(row, null).versionDelta(), /not a count/);
});

test("deltaAssertion expects the run's expect.server.versionDelta and fails when the measured delta differs", async () => {
  for (const row of rows) {
    for (const run of runsOf(row)) {
      const expect = caseExpect(row, run.exit);
      const wanted = expect.versionDelta();
      const same = await deltaAssertion({ expect, versionDelta: async () => wanted }, "doc");
      assert.deepEqual([same.name, same.expected, same.actual, same.ok], ["version_delta", wanted, wanted, true], `${row.id} / ${run.label}`);
      const other = await deltaAssertion({ expect, versionDelta: async () => wanted + 1 }, "doc");
      assert.equal(other.ok, false, `${row.id} / ${run.label}: a delta that differs from the row must fail`);
      assert.equal(other.expected, wanted);
    }
  }
});

test("a row whose expect.server.versionDelta changes changes what the driver expects", async () => {
  const row = structuredClone(rows.find((r) => r.id === "FQ-22"));
  row.expect.server.versionDelta = 7;
  const result = await deltaAssertion({ expect: caseExpect(row, null), versionDelta: async () => 1 }, "doc");
  assert.deepEqual([result.expected, result.ok], [7, false]);
});

test("the shared assertions take their numbers from ctx.expect", () => {
  const row = rows.find((r) => r.id === "FQ-22");
  const ctx = { expect: caseExpect(row, null) };
  assert.deepEqual(countAssertion(ctx, "exactly_one_commit_post", "commitPosts", 1).ok, true);
  assert.equal(countAssertion(ctx, "exactly_one_commit_post", "commitPosts", 2).ok, false);
  assert.deepEqual(countAssertion(ctx, "lookup_after_lost_answer", "commitLookupsMin", 1).expected, ">= 1");
  assert.equal(countAssertion(ctx, "lookup_after_lost_answer", "commitLookupsMin", 0).ok, false);
  assert.equal(oneIntent(ctx, [{ intentId: "i1" }]).ok, true);
  assert.equal(oneIntent(ctx, [{ intentId: "i1" }, { intentId: "i2" }]).ok, false);
  assert.equal(pathAssertion(ctx, [{ ts: "a", intentId: "i1", from: null, to: "queued" }]).ok, false);
  assert.equal(sameKey(ctx, [], "doc").ok, false, "no request carries no key: 0 keyTags is not the expected one");
  assert.throws(() => countAssertion(ctx, "x", "commitPostsWhilePaused", 0), /proxyLog\.commitPostsWhilePaused is missing/);
});

test("no app driver compares a number of its own", () => {
  assert.doesNotMatch(DRIVER_SOURCE, /deltaAssertion\([^)]*,\s*\d+\s*\)/, "deltaAssertion takes no literal");
  assert.doesNotMatch(DRIVER_SOURCE, /oneIntent\((?!ctx)/, "oneIntent takes the ctx");
  assert.doesNotMatch(DRIVER_SOURCE, /sameKey\((?!ctx)/, "sameKey takes the ctx");
  const stateChecks = [...DRIVER_SOURCE.matchAll(/assertStatePath\(/g)].length;
  assert.equal(stateChecks, 1, "the only assertStatePath call is pathAssertion, which reads expect.clientPath");
});

test("every machine-readable expectation an app row carries is read by an app driver", () => {
  for (const row of rows) {
    const { server = {}, proxyLog = {} } = row.expect;
    const exitExpects = (row.exits ?? []).map((e) => e.expect ?? {});
    const proxyKeys = new Set([...Object.keys(proxyLog), ...exitExpects.flatMap((e) => Object.keys(e.proxyLog ?? {}))]);
    for (const key of proxyKeys) {
      assert.ok(PROXY_LOG_KEYS[key], `${row.id}: ${key} is a known proxyLog key`);
      assert.ok(DRIVER_SOURCE.includes(`"${key}"`), `${row.id}: no app driver reads expect.proxyLog.${key}`);
    }
    for (const step of Object.keys(server.statuses ?? {})) assert.ok(DRIVER_SOURCE.includes(`status("${step}")`), `${row.id}: no app driver reads expect.server.statuses.${step}`);
    const lookups = [server.lookup, ...exitExpects.map((e) => e.server?.lookup)].filter(Boolean);
    for (const lookup of lookups) {
      assert.ok(DRIVER_SOURCE.includes("expect.lookup()"), `${row.id}: no app driver reads expect.server.lookup`);
      if (lookup.errorCode) assert.ok(DRIVER_SOURCE.includes("expect.lookup().errorCode"), `${row.id}: lookup.errorCode is not read`);
    }
    const exitDeltas = exitExpects.filter((e) => e.server && "versionDelta" in e.server).length;
    assert.ok(exitDeltas === 0 || DRIVER_SOURCE.includes("deltaAssertion(ctx"), row.id);
    if (row.expect.clientPath || exitExpects.some((e) => e.clientPath)) assert.ok(DRIVER_SOURCE.includes("pathAssertion(ctx"), `${row.id}: clientPath is not read`);
    if ("clientIntents" in row.expect) assert.ok(DRIVER_SOURCE.includes("oneIntent(ctx"), `${row.id}: clientIntents is not read`);
    if ("clientIntentsWhileFull" in row.expect) assert.ok(DRIVER_SOURCE.includes("clientIntentsWhileFull()"), `${row.id}: clientIntentsWhileFull is not read`);
  }
});

// FIX-16 (UNI-1380 G7-03a, round 13): the app rows that the G5-11 fork changed
// under the cases - FQ-53's store budget, FQ-51's confirmed sign-out, the
// deactivate/reactivate request shape - and the review r6 items.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fix16.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { caseResult, expandExits, runResult, SYNC_STORE_BUDGET_BYTES, syncStoreScopeDir, assertion } from "./app-cases-lib.mjs";
import { parseExitRange, partialCaseResult, selectExitRange } from "./app-cases-exits.mjs";
import { signOut, signedOutFacts } from "./app-session.mjs";
import { deactivateApp, reactivateApp } from "./app-tenant.mjs";

const FAULT_DIR = fileURLToPath(new URL(".", import.meta.url));
const driver = readFileSync(join(FAULT_DIR, "app-case-drivers-blocked.mjs"), "utf8");

/** A session whose renderer is the shell page (window + window.aiOffice). */
function fakeSession(inWindow, calls) {
  return {
    app: { evaluate: async (_fn, answers) => { calls.push({ call: "native-dialog", answers }); return undefined; } },
    shell: {
      evaluate: async (fn) => {
        globalThis.window = inWindow;
        try {
          return await fn();
        } finally {
          delete globalThis.window;
        }
      },
    },
  };
}

/** A tenant as seedAppTenant builds it; the owner carries a fresh-enough token. */
const tenant = {
  apiOrigin: "http://127.0.0.1:35067",
  orgId: "01M50G47ZHGRS146170PRB634F",
  orgSlug: "o-fault-mv9xbh0u-f9a8",
  owner: { userId: "01M50G47V2666HBBG8H8B5149M", token: "owner-token", tokenAt: Date.now() },
  app: { userId: "01M50G47X6W8YWZ75V2G4A72H3" },
};

/** Runs `call` with a stubbed global fetch, returning every request it made. */
async function captureRequests(call) {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {} });
    return { status: 200, text: async () => JSON.stringify({ member: {} }) };
  };
  try {
    await call();
  } finally {
    globalThis.fetch = real;
  }
  return seen;
}

test("the member deactivate/reactivate calls carry the organization SLUG, not its id", async () => {
  // handler/organization_members.go:31-38 resolves {org} with GetBySlug; the ULID
  // the runner holds 404d in r13 (FQ-43 exit 8, FQ-50 exit 5).
  const sent = await captureRequests(async () => {
    await deactivateApp(tenant);
    await reactivateApp(tenant);
  });
  const expected = [
    `${tenant.apiOrigin}/api/v1/orgs/${tenant.orgSlug}/members/${tenant.app.userId}/deactivate`,
    `${tenant.apiOrigin}/api/v1/orgs/${tenant.orgSlug}/members/${tenant.app.userId}/reactivate`,
  ];
  assert.deepEqual(sent.map((request) => request.url), expected);
  for (const request of sent) {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer owner-token");
  }
  assert.ok(!sent.some((request) => request.url.includes(tenant.orgId)), "the org id is never in the path");
});

test("signOut answers the G5-11 S3 prompt the way the product's UI does", async () => {
  const calls = [];
  const session = fakeSession({ aiOffice: { accountLogout: (options) => { calls.push({ call: "logout", options }); } } }, calls);
  await signOut(session);
  // unconfirmed, an explicit sign-out with a pending intent waits on a prompt the
  // runner never answers: r13's FQ-51 exits 2-3 hung to the 420 s cap on it.
  assert.deepEqual(calls, [
    { call: "native-dialog", answers: [0] },
    { call: "logout", options: { confirmed: true } },
  ]);
});

test("a sliced row's exits keep their row ordinal, a whole row and a one-exit row unchanged (review r6 R6-1)", () => {
  const row = { id: "FQ-50", ac: ["G5-A08"], fixture: "fx", exits: [1, 2, 3, 4, 5].map((n) => ({ exit: `exit ${n}` })) };
  const runs = expandExits(row);
  const range = parseExitRange("2-4");
  const { ran, skipped } = selectExitRange(runs, range, row.id);
  const results = ran.map((run) => runResult({ ordinal: run.index, label: run.label, assertions: [assertion("x", 1, 1, true)] }));

  const sliced = partialCaseResult(caseResult(row, results), { range, total: runs.length, skipped });
  // FQ-50 --exits 2-4 prints [2/5] [3/5] [4/5]: result.json says the same
  assert.deepEqual(sliced.exits.map((e) => e.n), [2, 3, 4]);
  assert.ok(sliced.exits.every((e) => !("ordinal" in e)), "the ordinal is an input, never an output");
  assert.ok(sliced.assertions.every((a) => a.exit), "a sliced row still labels each assertion with its exit");
  assert.deepEqual(sliced.exitRange, { from: 2, to: 4, of: 5, skipped: [1, 5] });

  const whole = caseResult(row, runs.map((run) => runResult({ ordinal: run.index, label: run.label, assertions: [assertion("x", 1, 1, true)] })));
  assert.deepEqual(whole.exits.map((e) => e.n), [1, 2, 3, 4, 5]);
  const one = caseResult({ id: "FQ-22", ac: [], scenario: "one run" }, [runResult({ assertions: [assertion("x", 1, 1, true)] })]);
  assert.equal(one.exits[0].n, 0);
  assert.equal(one.assertions[0].exit, undefined);
});

test("the signed-out facts probe reports a missing sync center instead of throwing", async () => {
  const facts = await signedOutFacts(fakeSession({}, []));
  assert.equal(facts.status, null);
  assert.equal(facts.lockedCount, null);
  assert.match(String(facts.error), /getSnapshot/);
});

test("FQ-51's signed-out exits assert the surfaces that carry the signed_out reason", () => {
  // the queue trace has no `signed_out` code (BLOCKED_REASONS, machine.ts:125-137);
  // the reason lives in the session lock and the sync center summary
  assert.match(driver, /signed_out_row_locked/);
  assert.match(driver, /no_dispatch_while_signed_out/);
  assert.doesNotMatch(driver, /blocked_signed_out/);
});

test("FQ-53's fill reaches the G5-11 store budget (1 GiB), not the G5-04 one (256 MiB)", () => {
  // fork 53ea00672 (G5-11) raised apps/shell/src/main/uniwork-docs/wiring.ts
  // SYNC_STORE_BUDGET_BYTES from 256 MiB to 1024 * 1024 * 1024; layer.ts:353
  // refuses a write once the scope's own bytes would pass it. r13 PASS->FAIL
  // came from the fill staying at the old 256 MiB.
  assert.equal(SYNC_STORE_BUDGET_BYTES, 1024 * 1024 * 1024);
  assert.equal(syncStoreScopeDir("/u", "default", "01JUSER"), join("/u", "uniwork-sync", "store", "default", "01JUSER"));
  assert.match(driver, /ftruncateSync\(fd, SYNC_STORE_BUDGET_BYTES\)/, "the filler is as large as the budget");
  assert.doesNotMatch(driver, /256 \* 1024 \* 1024/, "no stale G5-04 budget literal in the driver");
});

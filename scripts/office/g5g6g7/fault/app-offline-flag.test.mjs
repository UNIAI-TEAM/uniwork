// G7-03b (UNI-1382) review r1 R1-9: the lifecycle of the office_offline_library
// override - ownership, read-back after the lift, fail-stop, leftover cleanup.
// Run: node --test scripts/office/g5g6g7/fault/app-offline-flag.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createOfflineFlagGuard, liftBlocker } from "./app-offline-flag.mjs";

/** A tenant whose override the test controls: calls are recorded, the server state is `held`. */
function fakeTenant({ leftover = false, clearThrows = false, clearIsNoop = false, readError = null, setThrows = false } = {}) {
  const calls = [];
  let held = leftover ? { enabled: true } : null;
  return {
    calls,
    held: () => held,
    guard: createOfflineFlagGuard({
      set: async () => {
        calls.push("set");
        held = { enabled: true };
        if (setThrows) throw new Error("PUT answered 500");
      },
      clear: async () => {
        calls.push("clear");
        if (clearThrows) throw new Error("DELETE answered 500");
        if (!clearIsNoop) held = null;
      },
      read: async () => {
        calls.push("read");
        return readError ? { error: readError } : { override: held };
      },
    }),
  };
}

test("a run that never enabled the capability lifts nothing: no DELETE on an FQ row", async () => {
  const tenant = fakeTenant();
  const run = tenant.guard.forRun();
  assert.equal(await run.lift(), null);
  assert.deepEqual(tenant.calls, [], "no request at all for a run that never enabled it");
  assert.equal(tenant.guard.failure(), null);
});

test("enable then lift: switched on, lifted, read back, and the tenant is clean", async () => {
  const tenant = fakeTenant();
  const run = tenant.guard.forRun();
  await run.enable();
  assert.equal(run.owned(), true);
  assert.deepEqual(tenant.held(), { enabled: true });
  assert.equal(await run.lift(), null);
  assert.equal(tenant.held(), null);
  assert.deepEqual(tenant.calls, ["read", "set", "clear", "read"]);
  assert.equal(run.owned(), false);
});

test("a run that threw after enabling still lifts it (enable-then-throw)", async () => {
  const tenant = fakeTenant();
  const run = tenant.guard.forRun();
  await run.enable();
  // the driver throws here (harness death, AppBlocked or a product error): the runner's finally still lifts
  assert.equal(await run.lift(), null);
  assert.equal(tenant.held(), null);
});

test("a PUT that threw may still have created the override, so the run owns it and lifts it", async () => {
  const tenant = fakeTenant({ setThrows: true });
  const run = tenant.guard.forRun();
  await assert.rejects(() => run.enable(), /PUT answered 500/);
  assert.equal(run.owned(), true);
  assert.deepEqual(tenant.held(), { enabled: true }, "the failed PUT did take effect");
  assert.equal(await run.lift(), null);
  assert.equal(tenant.held(), null);
});

test("a DELETE that answers but changes nothing is a lift failure: the read-back catches it and later rows are BLOCKED", async () => {
  const tenant = fakeTenant({ clearIsNoop: true });
  const run = tenant.guard.forRun();
  await run.enable();
  const reason = await run.lift();
  assert.match(reason, /still present after the lift/);
  assert.equal(tenant.guard.failure(), reason, "the failure is kept for every later row");
  assert.match(liftBlocker(reason), /not run: the office_offline_library override of this tenant could not be lifted/);
  assert.match(liftBlocker(reason), /still present after the lift/);
});

test("a rejected DELETE is a lift failure, named, even when the read-back then shows the override gone", async () => {
  const tenant = fakeTenant({ clearThrows: true });
  const run = tenant.guard.forRun();
  await run.enable();
  const reason = await run.lift();
  assert.match(reason, /the DELETE of the office_offline_library override failed: DELETE answered 500/);
  assert.match(reason, /still present after the lift/);
  assert.equal(tenant.guard.failure(), reason);
});

test("a lift whose read-back cannot be read is a failure, not a silent success", async () => {
  const tenant = fakeTenant({ readError: "GET /api/v1/admin/flags/{key}/overrides -> 503" });
  const run = tenant.guard.forRun();
  // the enable-time read fails first: the run refuses to switch the capability on blind
  await assert.rejects(() => run.enable(), /leftover office_offline_library override could not be read/);
  const reason = await run.lift();
  assert.match(reason, /could not be read back: GET .* 503/);
  assert.equal(tenant.guard.failure(), reason);
});

test("an FL run clears a leftover override at start, then enables its own", async () => {
  const tenant = fakeTenant({ leftover: true });
  const run = tenant.guard.forRun();
  await run.enable();
  assert.deepEqual(tenant.calls, ["read", "clear", "set"], "the leftover is deleted before the run's own PUT");
  assert.equal(await run.lift(), null);
  assert.equal(tenant.held(), null);
});

test("the failure of one lift is visible to the guard shared by every run of the process", async () => {
  const tenant = fakeTenant({ clearIsNoop: true });
  const first = tenant.guard.forRun();
  await first.enable();
  await first.lift();
  const second = tenant.guard.forRun();
  assert.ok(tenant.guard.failure(), "the second run sees the first run's failure before it starts");
  assert.equal(second.owned(), false);
});

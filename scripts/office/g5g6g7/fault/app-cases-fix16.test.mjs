// FIX-16 (UNI-1380 G7-03a, round 13): the app rows that the G5-11 fork changed
// under the cases - FQ-53's store budget, FQ-51's confirmed sign-out, the
// deactivate/reactivate request shape - and the review r6 items.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fix16.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SYNC_STORE_BUDGET_BYTES, syncStoreScopeDir } from "./app-cases-lib.mjs";
import { deactivateApp, reactivateApp } from "./app-tenant.mjs";

const FAULT_DIR = fileURLToPath(new URL(".", import.meta.url));
const driver = readFileSync(join(FAULT_DIR, "app-case-drivers-blocked.mjs"), "utf8");

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

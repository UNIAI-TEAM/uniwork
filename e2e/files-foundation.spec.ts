import { expect, test } from "@playwright/test";

/**
 * FileService foundation smoke (plan section 6.1, row "Nền FileService"): the
 * server this suite talks to booted through the storage preflight, and
 * readiness reports the storage adapter beside the database while liveness
 * stays independent of it.
 *
 * The red half needs the object store stopped under a running server, which a
 * spec cannot arrange on a shared host. Run it by hand after stopping the
 * lane's own MinIO:
 *
 *   FILES_SMOKE_STORAGE_DOWN=1 pnpm --filter @uniwork/e2e exec playwright test e2e/files-foundation.spec.ts
 */
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const storageDown = process.env.FILES_SMOKE_STORAGE_DOWN === "1";

type Readiness = { ready: boolean; checks: { name: string; ok: boolean }[] };

function check(report: Readiness, name: string) {
  return report.checks.find((c) => c.name === name);
}

test("@files-smoke readiness reports the storage adapter, liveness stays up", async ({ request }) => {
  const live = await request.get(`${api}/healthz`);
  expect(live.status()).toBe(200);

  const ready = await request.get(`${api}/readyz`);
  const report = (await ready.json()) as Readiness;
  const storage = check(report, "storage");
  expect(storage, "readiness must include the storage probe").toBeTruthy();

  if (storageDown) {
    expect(ready.status()).toBe(503);
    expect(report.ready).toBe(false);
    expect(storage?.ok).toBe(false);
    // The database is still answering: only storage turned readiness red.
    expect(check(report, "db")?.ok).toBe(true);
  } else {
    expect(ready.status()).toBe(200);
    expect(report.ready).toBe(true);
    expect(storage?.ok).toBe(true);
  }
});

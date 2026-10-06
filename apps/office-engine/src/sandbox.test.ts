// Per-job uid sandbox (G2-05, slice 05s). Each job worker runs under its own
// uid from a fixed slot pool and its 0700 temp dir is owned by that uid, so a
// compromised worker cannot read or write another job's files. The OS enforces
// this only where the service can drop uids - the Linux image as uid 0 - so the
// suite skips everywhere else; the Dockerfile `test` stage runs it.

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isAlive } from "./process-tree.ts";
import type { ServiceGrant } from "./grants.ts";
import { call, jobDirs, makeJob, startHarness, submit, waitTerminal, type Harness } from "../test/harness.ts";

const CAN_SANDBOX =
  process.platform === "linux" && typeof process.geteuid === "function" && process.geteuid() === 0;

async function snapshotDirs(h: Harness): Promise<Set<string>> {
  return new Set(await jobDirs(h.tempRoot));
}

// The job dir a submit created: the one that was not there before. Leftover
// dirs from an earlier test's cleanup can lag a beat, so "the only dir" is
// not a safe identity.
async function newJobDir(h: Harness, before: Set<string>, timeoutMs = 10_000): Promise<string> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const fresh = (await jobDirs(h.tempRoot)).filter((d) => !before.has(d));
    if (fresh.length === 1) return join(h.tempRoot, fresh[0]!);
    if (fresh.length > 1) throw new Error("more than one new job dir: " + JSON.stringify(fresh));
    if (Date.now() > end) throw new Error("no new job dir appeared");
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function readIdentity(dir: string): Promise<{ uid: number; gid: number; pid: number } | null> {
  return readFile(join(dir, "identity.json"), "utf8")
    .then((t) => JSON.parse(t) as { uid: number; gid: number; pid: number })
    .catch(() => null);
}

async function uploadBody(h: Harness, jobId: string): Promise<string> {
  const upload = h.target.uploads.find((u) => u.path.includes(jobId));
  expect(upload, "job " + jobId + " wrote an output").toBeDefined();
  return upload!.body.toString("utf8");
}

async function cancel(h: Harness, job: { grant: ServiceGrant; token: string }) {
  const res = await call(h, "POST", "/v1/jobs/" + job.grant.job_id + "/cancel", { grant: job.token });
  expect([200, 404]).toContain(res.status);
  await waitTerminal(h, job);
}

describe.skipIf(!CAN_SANDBOX)("per-job uid sandbox", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ maxWorkers: 2, maxQueue: 4 });
  });
  afterAll(async () => {
    await h.close();
  });

  it("runs each concurrent worker under its own slot uid", async () => {
    const base = h.config.sandbox.uidBase;
    const before = await snapshotDirs(h);
    const a = makeJob(h.target, { text: "uniwork-fault:identity 30000\n" });
    const b = makeJob(h.target, { text: "uniwork-fault:identity 30000\n" });
    await submit(h, a);
    await submit(h, b);
    try {
      const uids = new Set<number>();
      const end = Date.now() + 10_000;
      while (uids.size < 2 && Date.now() < end) {
        for (const dir of await jobDirs(h.tempRoot)) {
          if (before.has(dir)) continue;
          const id = await readIdentity(join(h.tempRoot, dir));
          if (id) uids.add(id.uid);
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      // Two live workers, two distinct slot uids, never the service's uid 0.
      expect([...uids].sort((x, y) => x - y)).toEqual([base, base + 1]);
    } finally {
      await cancel(h, a);
      await cancel(h, b);
    }
  });

  it("gives each job a 0700 temp dir owned by its slot uid", async () => {
    const before = await snapshotDirs(h);
    const job = makeJob(h.target, { text: "uniwork-fault:identity 30000\n" });
    await submit(h, job);
    try {
      const dir = await newJobDir(h, before);
      const end = Date.now() + 10_000;
      let identity: { uid: number; gid: number; pid: number } | null = null;
      while (!identity && Date.now() < end) {
        identity = await readIdentity(dir);
        await new Promise((r) => setTimeout(r, 25));
      }
      const st = await stat(dir);
      expect(st.mode & 0o777).toBe(0o700);
      // A real uid from the pool, not the service's uid 0 the dir starts as.
      expect(identity!.uid).toBeGreaterThanOrEqual(h.config.sandbox.uidBase);
      expect(identity!.uid).toBeLessThan(h.config.sandbox.uidBase + h.config.maxWorkers);
      expect(st.uid).toBe(identity!.uid);
      expect(st.gid).toBe(identity!.gid);
    } finally {
      await cancel(h, job);
    }
  });

  it("denies a worker any access to a concurrent job's temp dir", async () => {
    const before = await snapshotDirs(h);
    const a = makeJob(h.target, { text: "uniwork-fault:identity 30000\n" });
    await submit(h, a);
    try {
      const dirA = await newJobDir(h, before);
      // A's worker is up once its identity marker exists - input.bin is
      // already inside (the supervisor writes it before the spawn).
      const end = Date.now() + 10_000;
      while (!(await readIdentity(dirA)) && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      expect(await readIdentity(dirA), "job A is running under its slot uid").not.toBeNull();
      // B tries to read A's input; C tries to plant a file inside A's dir.
      const b = makeJob(h.target, { text: `uniwork-fault:probe-read ${join(dirA, "input.bin")}\n` });
      const c = makeJob(h.target, { text: `uniwork-fault:probe-write ${join(dirA, "owned.marker")}\n` });
      await submit(h, b);
      await submit(h, c);
      expect((await waitTerminal(h, b)).body.state).toBe("completed");
      expect((await waitTerminal(h, c)).body.state).toBe("completed");
      expect(await uploadBody(h, b.grant.job_id)).toMatch(/^denied:(EACCES|EPERM)$/);
      expect(await uploadBody(h, c.grant.job_id)).toMatch(/^denied:(EACCES|EPERM)$/);
      await expect(stat(join(dirA, "owned.marker"))).rejects.toThrow();
    } finally {
      await cancel(h, a);
    }
  });

  it("denies a worker reads and writes outside the job temp root", async () => {
    const escape = join(h.tempRoot, "escape.marker");
    const job = makeJob(h.target, { text: `uniwork-fault:probe-write ${escape}\n` });
    await submit(h, job);
    expect((await waitTerminal(h, job)).body.state).toBe("completed");
    expect(await uploadBody(h, job.grant.job_id)).toMatch(/^denied:(EACCES|EPERM)$/);
    await expect(stat(escape)).rejects.toThrow();

    // A slot uid cannot read another process's environment - not even init's.
    const proc = makeJob(h.target, { text: "uniwork-fault:probe-read /proc/1/environ\n" });
    await submit(h, proc);
    expect((await waitTerminal(h, proc)).body.state).toBe("completed");
    expect(await uploadBody(h, proc.grant.job_id)).toMatch(/^denied:(EACCES|EPERM)$/);
  });

  it("keeps the controls honest: own dir and world-readable files stay reachable", async () => {
    const self = makeJob(h.target, { text: "uniwork-fault:probe-write self\n" });
    await submit(h, self);
    expect((await waitTerminal(h, self)).body.state).toBe("completed");
    expect(await uploadBody(h, self.grant.job_id)).toBe("wrote");

    const read = makeJob(h.target, { text: "uniwork-fault:probe-read /etc/hostname\n" });
    await submit(h, read);
    expect((await waitTerminal(h, read)).body.state).toBe("completed");
    expect(await uploadBody(h, read.grant.job_id)).toMatch(/^read:\d+$/);

    // The worker's own environment is readable to itself - and carries no
    // service config (the supervisor passes only the scrubbed allow-list).
    const env = makeJob(h.target, { text: "uniwork-fault:probe-read /proc/self/environ\n" });
    await submit(h, env);
    await waitTerminal(h, env);
    const body = await uploadBody(h, env.grant.job_id);
    expect(body).toMatch(/^read:\d+$/);
    expect(body).not.toContain("OFFICE_ENGINE_SERVICE_TOKEN");
  });

  it("refuses an output the worker repointed: symlink and hard link both fail typed", async () => {
    // A worker owns its 0700 dir and can plant output.bin -> anything. The
    // supervisor opens O_NOFOLLOW and fstats the fd: a symlink is ELOOP at
    // open, a hard link to input.bin trips nlink !== 1. Neither reaches the
    // grant target.
    const link = makeJob(h.target, { text: "uniwork-fault:plant-output /etc/hostname\n" });
    await submit(h, link);
    const linkDone = await waitTerminal(h, link);
    expect(linkDone.body.state).toBe("failed");
    expect(linkDone.body.error).toMatchObject({ code: "engine_result_invalid" });
    expect(h.target.uploads.find((u) => u.path.includes(link.grant.job_id))).toBeUndefined();

    const hard = makeJob(h.target, { text: "uniwork-fault:plant-output hard\n" });
    await submit(h, hard);
    const hardDone = await waitTerminal(h, hard);
    expect(hardDone.body.state).toBe("failed");
    expect(hardDone.body.error).toMatchObject({ code: "engine_result_invalid" });
    expect(h.target.uploads.find((u) => u.path.includes(hard.grant.job_id))).toBeUndefined();
  });

  it("kills the whole tree under the dropped uid", async () => {
    const job = makeJob(h.target, { text: "uniwork-fault:grandchild 30000\n" });
    await submit(h, job);
    let pid = 0;
    const end = Date.now() + 10_000;
    while (pid === 0 && Date.now() < end) {
      for (const dir of await jobDirs(h.tempRoot)) {
        pid = Number(await readFile(join(h.tempRoot, dir, "grandchild.pid"), "utf8").catch(() => "0"));
        if (pid) break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(pid).toBeGreaterThan(0);
    expect(isAlive(pid)).toBe(true);
    await cancel(h, job);
    const gone = Date.now() + 5_000;
    while (isAlive(pid) && Date.now() < gone) await new Promise((r) => setTimeout(r, 50));
    expect(isAlive(pid)).toBe(false);
  });
});

// F3 (UNI-926 FIX-ENGINE-POOL): a FAILED job must release its worker slot, so
// N > MAX_WORKERS consecutive failures cannot exhaust the pool or crash the
// service. A failure reaches the pool through two paths - a worker that
// reports a typed failure, and a job that dies before/while the worker runs -
// so both are exercised, and the pool must still serve a later job.
describe("failed jobs release their worker slot (F3)", () => {
  it("serves a later job after N > maxWorkers consecutive failing jobs", async () => {
    const h = await startHarness({ maxWorkers: 2, maxQueue: 8 });
    try {
      // 4 consecutive failures over a 2-slot pool: the old leak quarantined a
      // slot per failure and the 3rd acquire threw "worker slot pool
      // exhausted", an unhandled rejection that killed the process.
      for (let i = 0; i < 4; i++) {
        const job = makeJob(h.target, { text: "uniwork-fault:code engine_result_invalid\n" });
        expect((await submit(h, job)).status).toBe(202);
        const done = await waitTerminal(h, job);
        expect(done.body.state).toBe("failed");
        expect((done.body.error as { code?: string }).code).toBe("engine_result_invalid");
      }
      // A failure that dies mid-flight (here: the worker reports crashed) must
      // release its slot on the same finally path.
      for (let i = 0; i < 4; i++) {
        const job = makeJob(h.target, { text: "uniwork-fault:crash\n" });
        expect((await submit(h, job)).status).toBe(202);
        const done = await waitTerminal(h, job);
        expect(done.body.state).toBe("crashed");
      }
      // The pool still has every slot: a normal job runs and completes.
      const ok = makeJob(h.target, { text: "after-failures" });
      expect((await submit(h, ok)).status).toBe(202);
      expect((await waitTerminal(h, ok)).body.state).toBe("completed");
      // No slot was permanently withheld by a corpse holding the uid.
      expect(h.service.jobs.sandboxQuarantined).toBe(0);
      // A job settles its state before its finally releases the slot and
      // decrements the running count, so wait for the release, not the state.
      await vi.waitFor(() => expect(h.service.jobs.runningCount).toBe(0), { timeout: 5_000 });
    } finally {
      await h.close();
    }
  });
});

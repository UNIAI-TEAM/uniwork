// Bounded pool and queue, cancel of a queued job, metrics, and shutdown that
// kills every live tree and leaves no temp dir behind.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAlive } from "./process-tree.ts";
import { call, errorCode, jobDirs, makeJob, startHarness, submit, waitTerminal } from "../test/harness.ts";

describe("bounded pool and queue", () => {
  it("answers engine_overloaded (503) when every worker is busy and the queue is full", async () => {
    const h = await startHarness({ maxWorkers: 1, maxQueue: 1 });
    try {
      const running = makeJob(h.target, { text: "uniwork-fault:sleep 30000\n" });
      const queued = makeJob(h.target, { text: "queued" });
      const refused = makeJob(h.target, { text: "refused" });
      expect((await submit(h, running)).status).toBe(202);
      expect((await submit(h, queued)).status).toBe(202);
      const res = await submit(h, refused);
      expect(res.status).toBe(503);
      expect(errorCode(res)).toBe("engine_overloaded");
      expect(h.service.jobs.get(refused.grant.job_id)).toBeUndefined();
      expect(h.service.jobs.queueDepth).toBe(1);

      // Cancel of a queued job removes it from the queue without a worker.
      const cancelled = await call(h, "POST", "/v1/jobs/" + queued.grant.job_id + "/cancel", { grant: queued.token });
      expect(cancelled.body).toMatchObject({ previous_state: "accepted", state: "cancelled" });
      expect(h.service.jobs.queueDepth).toBe(0);

      const metrics = await call(h, "GET", "/metrics");
      const text = String(metrics.body.text);
      expect(text).toContain("office_engine_queue_depth 0");
      expect(text).toContain("office_engine_running_jobs 1");
      expect(text).toContain('office_engine_rejections_total{code="engine_overloaded"} 1');
      expect(text).toContain('office_engine_jobs_total{operation="serialize",outcome="cancelled"} 1');

      await call(h, "POST", "/v1/jobs/" + running.grant.job_id + "/cancel", { grant: running.token });
      const done = await waitTerminal(h, running);
      expect(done.body.state).toBe("cancelled");
      const after = String((await call(h, "GET", "/metrics")).body.text);
      expect(after).toContain('office_engine_job_duration_seconds_count{operation="serialize"}');
    } finally {
      await h.close();
    }
  });

  it("runs queued work once a worker frees up", async () => {
    const h = await startHarness({ maxWorkers: 1, maxQueue: 2 });
    try {
      const jobs = [makeJob(h.target, { text: "one" }), makeJob(h.target, { text: "two" }), makeJob(h.target, { text: "three" })];
      for (const job of jobs) expect((await submit(h, job)).status).toBe(202);
      for (const job of jobs) expect((await waitTerminal(h, job)).body.state).toBe("completed");
    } finally {
      await h.close();
    }
  });
});

describe("shutdown", () => {
  it("settles live jobs as crashed(shutdown), kills every tree and removes temp dirs", async () => {
    const h = await startHarness({ maxWorkers: 1, maxQueue: 2 });
    const running = makeJob(h.target, { text: "uniwork-fault:grandchild 60000\n", deadlineMs: 60_000 });
    const queued = makeJob(h.target, { text: "never runs" });
    await submit(h, running);
    await submit(h, queued);
    let pid = 0;
    const end = Date.now() + 10_000;
    while (pid === 0 && Date.now() < end) {
      for (const dir of await jobDirs(h.tempRoot)) {
        pid = Number(await readFile(join(h.tempRoot, dir, "grandchild.pid"), "utf8").catch(() => "0"));
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(pid).toBeGreaterThan(0);
    const runningJob = h.service.jobs.get(running.grant.job_id)!;
    const queuedJob = h.service.jobs.get(queued.grant.job_id)!;
    await h.service.close();
    expect(runningJob.state).toBe("crashed");
    expect(runningJob.error).toMatchObject({ code: "engine_crashed", reason: "shutdown" });
    expect(queuedJob.state).toBe("crashed");
    const gone = Date.now() + 5_000;
    while (isAlive(pid) && Date.now() < gone) await new Promise((r) => setTimeout(r, 50));
    expect(isAlive(pid)).toBe(false);
    expect(await jobDirs(h.tempRoot)).toEqual([]);
    await h.target.close();
    await (await import("node:fs/promises")).rm(h.tempRoot, { recursive: true, force: true });
  });

  it("sweeps job dirs a crashed predecessor left behind on start", async () => {
    const { mkdir, mkdtemp, readdir, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(join(tmpdir(), "uw-office-sweep-"));
    await mkdir(join(root, "uw-office-job-stale1"));
    await mkdir(join(root, "keep-me"));
    const h = await startHarness({ tempRoot: root });
    try {
      expect(await readdir(root)).toEqual(["keep-me"]);
    } finally {
      await h.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

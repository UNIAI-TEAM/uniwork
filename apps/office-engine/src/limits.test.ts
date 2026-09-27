// Each limit, driven on a real worker with a low configured value, must stop
// the job with its own named outcome; the tree must be gone and the job's temp
// dir removed afterwards.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAlive } from "./process-tree.ts";
import { call, errorCode, jobDirs, makeJob, startHarness, submit, waitTerminal, type Harness } from "../test/harness.ts";

const MiB = 1024 * 1024;
let h: Harness;

beforeAll(async () => {
  h = await startHarness({
    maxWorkers: 4,
    maxQueue: 8,
    limits: {
      maxJobMs: 20_000,
      cpuMs: 2_500,
      memoryBytes: 192 * MiB,
      tempBytes: 8 * MiB,
      maxInputBytes: 1 * MiB,
      maxOutputBytes: 2 * MiB,
    },
  });
});
afterAll(async () => {
  await h.close();
});

async function runFault(fault: string, deadlineMs = 15_000) {
  const job = makeJob(h.target, { text: "uniwork-fault:" + fault + "\n", deadlineMs });
  const res = await submit(h, job);
  expect(res.status).toBe(202);
  return { job, done: await waitTerminal(h, job) };
}

describe("per-job limits", () => {
  it("deadline: a job past its deadline is timed_out", async () => {
    const { done } = await runFault("sleep 30000", 1_500);
    expect(done.body.state).toBe("timed_out");
    expect(done.body.error).toMatchObject({ code: "engine_timeout", reason: "deadline" });
  });

  it("deadline: the grant's deadline caps a longer envelope deadline", async () => {
    const job = makeJob(h.target, { text: "uniwork-fault:sleep 30000\n", deadlineMs: 15_000, grant: { deadline_at: Date.now() + 1_500 } });
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("timed_out");
    expect((done.body.finished_at as number) - (done.body.accepted_at as number)).toBeLessThan(8_000);
  });

  it("cpu: a CPU-bound handler is stopped by the CPU budget before its deadline", async () => {
    const { done } = await runFault("spin 60000", 18_000);
    expect(done.body.state).toBe("timed_out");
    expect(done.body.error).toMatchObject({ code: "engine_timeout", reason: "cpu_limit" });
  });

  it("memory: off-heap growth past the RSS cap fails with memory_limit", async () => {
    const { done } = await runFault("rss 400");
    expect(done.body.state).toBe("failed");
    expect(done.body.error).toMatchObject({ code: "engine_crashed", reason: "memory_limit" });
  });

  it("memory: JS heap growth dies at the V8 cap as memory_limit", async () => {
    const { done } = await runFault("heap");
    expect(done.body.error).toMatchObject({ code: "engine_crashed", reason: "memory_limit" });
  });

  it("temp: filling the job temp dir past its budget fails with temp_limit", async () => {
    const { done } = await runFault("temp 64");
    expect(done.body.state).toBe("failed");
    expect(done.body.error).toMatchObject({ code: "engine_crashed", reason: "temp_limit" });
  });

  it("output: an output over the byte bound is refused and never uploaded", async () => {
    const { job, done } = await runFault("output 3");
    expect(done.body.state).toBe("failed");
    expect(done.body.error).toMatchObject({ code: "upload_bounds", reason: "output_limit" });
    expect(h.target.uploads.some((u) => u.path.includes(job.grant.job_id))).toBe(false);
  });

  it("output: the grant's max_bytes is tighter than the service bound", async () => {
    const job = makeJob(h.target, { text: "uniwork-fault:output 1\n" });
    job.grant.output!.max_bytes = 1024;
    const { signGrant } = await import("./grants.ts");
    const { GRANT_KEY } = await import("../test/harness.ts");
    const token = signGrant(job.grant, GRANT_KEY);
    await submit(h, { token, envelope: job.envelope });
    const done = await waitTerminal(h, { grant: job.grant, token });
    expect(done.body.error).toMatchObject({ code: "upload_bounds" });
  });

  it("input: bytes over the service input bound are refused before a job exists", async () => {
    const job = makeJob(h.target, { text: "a".repeat(2 * MiB) });
    const res = await submit(h, job);
    expect(res.status).toBe(413);
    expect(errorCode(res)).toBe("upload_bounds");
    expect(h.service.jobs.get(job.grant.job_id)).toBeUndefined();
  });

  it("a worker cannot claim a code outside the handler allow-list", async () => {
    const { done } = await runFault("code grant_expired");
    expect(done.body.state).toBe("failed");
    expect(done.body.error).toMatchObject({ code: "engine_result_invalid", reason: "fault" });
  });

  it("crash: a worker that dies is reported crashed, not completed", async () => {
    const { done } = await runFault("crash");
    expect(done.body.state).toBe("crashed");
    expect(done.body.error).toMatchObject({ code: "engine_crashed" });
  });
});

describe("process tree and temp ownership", () => {
  it("kills the whole tree on timeout: the grandchild does not survive", async () => {
    const job = makeJob(h.target, { text: "uniwork-fault:grandchild 30000\n", deadlineMs: 3_000 });
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
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("timed_out");
    const gone = Date.now() + 5_000;
    while (isAlive(pid) && Date.now() < gone) await new Promise((r) => setTimeout(r, 50));
    expect(isAlive(pid)).toBe(false);
  });

  // Linux (the container) only: a descendant that left the process group and
  // outlived the worker is found by the job tag in its environment. Windows
  // has no equivalent; there it is a documented dev-host gap (runbook).
  it.runIf(process.platform === "linux")("kills a detached (setsid) descendant that outlived the worker", async () => {
    const { done } = await runFault("orphan");
    expect(done.body.state).toBe("completed");
    const marker = (await readdir(h.tempRoot)).find((n) => n.startsWith("orphan-"));
    expect(marker).toBeDefined();
    const pid = Number(await readFile(join(h.tempRoot, marker as string), "utf8"));
    const gone = Date.now() + 5_000;
    while (isAlive(pid) && Date.now() < gone) await new Promise((r) => setTimeout(r, 50));
    expect(isAlive(pid)).toBe(false);
  });

  it("removes the job temp dir after every outcome", async () => {
    await runFault("sleep 10");
    await runFault("crash");
    const end = Date.now() + 5_000;
    while ((await jobDirs(h.tempRoot)).length > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    expect(await jobDirs(h.tempRoot)).toEqual([]);
  });

  it("cancel of a running job kills its tree and settles cancelled", async () => {
    const job = makeJob(h.target, { text: "uniwork-fault:sleep 30000\n" });
    await submit(h, job);
    const end = Date.now() + 5_000;
    while (h.service.jobs.get(job.grant.job_id)?.state !== "running" && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    const res = await call(h, "POST", "/v1/jobs/" + job.grant.job_id + "/cancel", { grant: job.token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ previous_state: "running", state: "cancelled" });
    // A second cancel answers the settled outcome, it does not re-cancel.
    const again = await call(h, "POST", "/v1/jobs/" + job.grant.job_id + "/cancel", { grant: job.token });
    expect(again.body).toMatchObject({ previous_state: "cancelled", state: "cancelled" });
  });

  it("cancel after completion answers completed, never a pretend cancel", async () => {
    const job = makeJob(h.target, { text: "done first" });
    await submit(h, job);
    await waitTerminal(h, job);
    const res = await call(h, "POST", "/v1/jobs/" + job.grant.job_id + "/cancel", { grant: job.token });
    expect(res.body).toMatchObject({ previous_state: "completed", state: "completed" });
  });
});

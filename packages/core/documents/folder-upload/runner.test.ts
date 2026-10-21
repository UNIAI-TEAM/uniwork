import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeFolderUploadTransport,
  folderUploadApiError,
  type FakeFolderUploadCall,
  type FakeFolderUploadOptions,
} from "./fake-transport";
import { planFileUpload, planFolderUpload } from "./plan";
import { runFolderUpload } from "./runner";
import type { FolderUploadProgress, RunFolderUploadOptions } from "./runner-types";
import { FolderUploadRefusedError } from "./transport";
import type { FolderUploadEntry } from "./types";

const LIMITS = { maxFiles: 500, maxTotalBytes: 2 ** 31, maxDepth: 20, perFileMaxBytes: 2 ** 28 };

function setup(
  entries: FolderUploadEntry[],
  fake: FakeFolderUploadOptions = {},
  over: Partial<RunFolderUploadOptions> = {},
) {
  const plan = planFolderUpload(entries, { limits: LIMITS, parentLevel: 1, siblingNames: [] });
  const transport = createFakeFolderUploadTransport(fake);
  const progress: FolderUploadProgress[] = [];
  const invalidations: number[] = [];
  const handle = runFolderUpload({
    transport,
    plan,
    file: (index) => new Blob(["x".repeat(entries[index]?.size ?? 0)]),
    parentId: "parent-1",
    shareWithWorkspace: false,
    limits: { parallel: 2, completeBatch: 50 },
    onProgress: (p) => progress.push(p),
    onInvalidate: () => invalidations.push(Date.now()),
    ...over,
  });
  return { plan, transport, handle, progress, invalidations };
}

const files = (n: number, size = 1): FolderUploadEntry[] =>
  Array.from({ length: n }, (_, i) => ({ path: `R/f${String(i).padStart(3, "0")}.pdf`, size }));

const settle = async <T>(p: Promise<T>): Promise<T> => {
  await vi.runAllTimersAsync();
  return p;
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("runFolderUpload plan", () => {
  it("sends the tree under the root, the share flag and a stable key, once", async () => {
    const { transport, handle } = setup(
      [{ path: "R/a.pdf", size: 1 }, { path: "R/sub/b.pdf", size: 2 }, { path: "R/sub/deep/c.pdf", size: 3 }],
      {},
      { shareWithWorkspace: true, idempotencyKey: "key-1" },
    );
    await settle(handle.done);
    const plans = transport.calls.filter((c) => c.method === "plan");
    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual({
      method: "plan",
      idempotencyKey: "key-1",
      body: {
        parent_id: "parent-1",
        root_name: "R",
        share_with_workspace: true,
        folders: ["sub", "sub/deep"],
        files: [
          { file_key: "f-0001", path: "", filename: "a.pdf", size_bytes: 1 },
          { file_key: "f-0002", path: "sub", filename: "b.pdf", size_bytes: 2 },
          { file_key: "f-0003", path: "sub/deep", filename: "c.pdf", size_bytes: 3 },
        ],
      },
    });
  });

  it("builds probes only for files above the chunked threshold, before the plan", async () => {
    const buildProbe = vi.fn(() =>
      Promise.resolve({ head_b64: "h", central_dir_b64: "c", cd_offset: 1, cd_size: 2 }),
    );
    const { transport, handle } = setup(
      [{ path: "R/small.docx", size: 5 }, { path: "R/big.docx", size: 11 }],
      {},
      { limits: { parallel: 2, completeBatch: 50, chunkedThresholdBytes: 10 }, buildProbe },
    );
    await settle(handle.done);
    expect(buildProbe).toHaveBeenCalledTimes(1);
    const plan = transport.calls.find((c) => c.method === "plan");
    expect(plan?.method === "plan" && plan.body.files.map((f) => f.probe)).toEqual([
      undefined,
      { head_b64: "h", central_dir_b64: "c", cd_offset: 1, cd_size: 2 },
    ]);
  });

  it("rejects with a typed refusal when the server refuses the plan, sending nothing else", async () => {
    const { transport, handle, progress } = setup(files(2), {
      errors: { plan: [folderUploadApiError(422, "folder_upload_too_many_files", { max: 500, count: 612 })] },
    });
    const err = await settle(handle.done.catch((e: unknown) => e));
    expect(err).toBeInstanceOf(FolderUploadRefusedError);
    expect(err).toMatchObject({ code: "folder_upload_too_many_files", fields: { max: 500, count: 612 } });
    expect(transport.calls.map((c) => c.method)).toEqual(["plan"]);
    expect(progress.at(-1)?.phase).toBe("refused");
  });

  it("waits Retry-After once on folder_uploads_busy, then plans with the same key", async () => {
    const busy = folderUploadApiError(429, "folder_uploads_busy", { retry_after: 30 }, 30);
    const { transport, handle, progress } = setup(files(1), { errors: { plan: [busy] } });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(progress.at(-1)?.phase).toBe("waiting");
    expect(transport.calls.filter((c) => c.method === "plan")).toHaveLength(1);
    const report = await settle(handle.done);
    const keys = transport.calls.flatMap((c) => (c.method === "plan" ? [c.idempotencyKey] : []));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(report.done).toBe(1);
  });

  it("refuses after a second busy answer", async () => {
    const busy = () => folderUploadApiError(429, "folder_uploads_busy", {}, 5);
    const { handle } = setup(files(1), { errors: { plan: [busy(), busy()] } });
    const err = await settle(handle.done.catch((e: unknown) => e));
    expect(err).toMatchObject({ name: "FolderUploadRefusedError", code: "folder_uploads_busy" });
  });

  it("cancels while waiting out busy without a batch", async () => {
    const { transport, handle } = setup(files(1), {
      errors: { plan: [folderUploadApiError(429, "folder_uploads_busy", {}, 30)] },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    handle.cancel();
    const report = await settle(handle.done);
    expect(report).toMatchObject({ batchId: null, canceled: true, canRetry: false, root: { id: null, title: "R" } });
    expect(transport.calls.map((c) => c.method)).toEqual(["plan"]);
  });

  it("R2-4: cancel while the plan is in flight lets the answer land, then cancels that batch and sends no PUT", async () => {
    const { transport, handle } = setup(files(2), { latencyMs: 500 });
    await vi.advanceTimersByTimeAsync(100);
    handle.cancel();
    const report = await settle(handle.done);
    expect(transport.calls.map((c) => c.method)).toEqual(["plan", "cancel"]);
    expect(transport.calls.filter((c) => c.method === "cancel")).toEqual([{ method: "cancel", batchId: "batch-1" }]);
    expect(transport.batch?.status).toBe("canceled");
    expect(report).toMatchObject({
      batchId: "batch-1",
      canceled: true,
      canRetry: false,
      done: 0,
      root: { id: "folder-root", title: "R" },
    });
  });

  it("R2-4: cancel while the plan is in flight, plan refused -> nothing to cancel", async () => {
    const { transport, handle } = setup(files(1), {
      latencyMs: 500,
      errors: { plan: [folderUploadApiError(422, "folder_upload_too_many_files", { max: 500, count: 612 })] },
    });
    await vi.advanceTimersByTimeAsync(100);
    handle.cancel();
    const report = await settle(handle.done);
    expect(transport.calls.map((c) => c.method)).toEqual(["plan"]);
    expect(report).toMatchObject({ batchId: null, canceled: true, done: 0 });
  });

  it("R2-4: a failing cancel after a late plan answer is ignored", async () => {
    const { transport, handle } = setup(files(1), { latencyMs: 500, errors: { cancel: [new TypeError("offline")] } });
    await vi.advanceTimersByTimeAsync(100);
    handle.cancel();
    await expect(settle(handle.done)).resolves.toMatchObject({ batchId: "batch-1", canceled: true });
    expect(transport.calls.filter((c) => c.method === "put")).toHaveLength(0);
  });
});

describe("runFolderUpload upload", () => {
  it("uploads everything with at most `parallel` PUTs and reports the server's root", async () => {
    const { transport, handle, progress } = setup(files(7, 3), { latencyMs: 100, rootTitle: "R (1)" }, {
      limits: { parallel: 3, completeBatch: 50 },
    });
    const report = await settle(handle.done);
    expect(transport.peakPuts).toBe(3);
    expect(report).toEqual({
      batchId: "batch-1",
      root: { id: "folder-root", title: "R (1)" },
      done: 7,
      failed: [],
      total: 7,
      canceled: false,
      expired: false,
      canRetry: false,
    });
    expect(progress.at(-1)).toEqual({ done: 7, failed: 0, stored: 0, total: 7, sentBytes: 21, totalBytes: 21, phase: "finished" });
  });

  it("completes in batches of at most completeBatch", async () => {
    const { transport, handle } = setup(files(7), {}, { limits: { parallel: 6, completeBatch: 3 } });
    await settle(handle.done);
    const sizes = transport.calls.flatMap((c) => (c.method === "complete" ? [c.items.length] : []));
    expect(sizes.every((n) => n <= 3)).toBe(true);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(7);
  });

  it("flushes a partial batch after 1.5 s without a new file, and retries a PUT at 1 s then 3 s", async () => {
    const { transport, handle } = setup(
      [{ path: "R/a.pdf", size: 1 }, { path: "R/b.pdf", size: 1 }],
      { putFailures: { "b.pdf": ["network", "5xx"] } },
    );
    await vi.advanceTimersByTimeAsync(1_499);
    expect(transport.calls.filter((c) => c.method === "complete")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const completes = () => transport.calls.flatMap((c) => (c.method === "complete" ? [c.items.map((i) => i.file_key)] : []));
    expect(completes()).toEqual([["f-0001"]]);
    expect(transport.calls.filter((c) => c.method === "put" && c.fileKey === "f-0002")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(transport.calls.filter((c) => c.method === "put" && c.fileKey === "f-0002")).toHaveLength(3);
    const report = await settle(handle.done);
    expect(completes()).toEqual([["f-0001"], ["f-0002"]]);
    expect(report.done).toBe(2);
  });

  it("fails a file after two retries, and retryFailed re-runs only that file", async () => {
    const { transport, handle } = setup(files(3), { putFailures: { "f001.pdf": ["network", "network", "network"] } });
    const report = await settle(handle.done);
    expect(report.done).toBe(2);
    expect(report.failed).toEqual([{ path: "R/f001.pdf", filename: "f001.pdf", code: "network", retryable: true }]);
    expect(report.canRetry).toBe(true);

    const before = transport.calls.length;
    const retried = await settle(handle.retryFailed());
    const after = transport.calls.slice(before);
    expect(after.map((c) => c.method)).toEqual(["status", "put", "complete"]);
    expect(after[1]).toMatchObject({ fileKey: "f-0002" });
    expect(retried).toMatchObject({ done: 3, failed: [], canRetry: false });
  });

  it("does not retry a 4xx storage refusal other than an expired target", async () => {
    const { transport, handle } = setup(files(1), { putFailures: { "f000.pdf": ["403", "403"] } });
    const report = await settle(handle.done);
    // A 403 reads as an expired signature: one fresh target, then the file fails.
    expect(transport.calls.map((c) => c.method)).toEqual(["plan", "put", "status", "put"]);
    expect(report.failed[0]?.code).toBe("http_403");
  });

  it("asks status() for a fresh target when the target has expired", async () => {
    const { transport, handle } = setup(files(2), { expiredTargets: ["f000.pdf"] });
    const report = await settle(handle.done);
    expect(transport.calls.filter((c) => c.method === "status")).toHaveLength(1);
    // The expired target is noticed before sending: no PUT is wasted on it.
    expect(transport.calls.filter((c) => c.method === "put")).toHaveLength(2);
    expect(report.done).toBe(2);
  });

  it("reports per-file complete failures with code and reason", async () => {
    const { handle } = setup(files(3), {
      fileErrors: { "f002.pdf": { code: "unsupported_media", message: "m", reason: "zip_bomb" } },
    });
    const report = await settle(handle.done);
    expect(report.done).toBe(2);
    expect(report.failed).toEqual([
      { path: "R/f002.pdf", filename: "f002.pdf", code: "unsupported_media", reason: "zip_bomb", retryable: false },
    ]);
  });

  it("sends a multipart file part by part and completes it with its parts", async () => {
    const { transport, handle } = setup([{ path: "R/big.pdf", size: 10 }], { multipartAboveBytes: 5, partSize: 4 });
    await settle(handle.done);
    const complete = transport.calls.find((c) => c.method === "complete");
    expect(complete?.method === "complete" && complete.items).toEqual([
      {
        file_key: "f-0001",
        parts: [1, 2, 3].map((n) => ({ part_number: n, etag: `"etag-f-0001-${n}"` })),
      },
    ]);
  });
});

describe("runFolderUpload cancel and batch end", () => {
  it("cancel aborts PUTs, stops completes and cancels the batch; landed files stay", async () => {
    const { transport, handle } = setup(files(4), { latencyMs: 100 }, { limits: { parallel: 1, completeBatch: 1 } });
    // plan 0-100, put 1 100-200, complete 1 200-300 beside put 2, complete 2 from 300.
    await vi.advanceTimersByTimeAsync(350);
    handle.cancel();
    const report = await settle(handle.done);
    // File 2 is in storage, its complete cut off: cancel completes it again before the DELETE.
    expect(report).toMatchObject({ canceled: true, canRetry: false, done: 2 });
    const methods = transport.calls.map((c) => c.method);
    expect(methods.at(-1)).toBe("cancel");
    expect(methods.filter((m) => m === "put")).toHaveLength(3);
    expect(transport.batch?.status).toBe("canceled");
    expect(transport.batch?.files.map((f) => f.status)).toEqual(["done", "done", "pending", "pending"]);
    await expect(settle(handle.retryFailed())).resolves.toMatchObject({ canceled: true });
    expect(transport.calls.map((c) => c.method)).toEqual(methods);
  });

  it("ends the run on 410 folder_upload_expired; retry is unavailable", async () => {
    const { transport, handle, progress } = setup(files(2), {
      errors: { complete: [folderUploadApiError(410, "folder_upload_expired")] },
    });
    const report = await settle(handle.done);
    expect(report).toMatchObject({ expired: true, canRetry: false });
    expect(progress.at(-1)?.phase).toBe("expired");
    const calls = transport.calls.length;
    await settle(handle.retryFailed());
    expect(transport.calls.length).toBe(calls);
  });

  it("ends as canceled on 409 folder_upload_canceled (canceled elsewhere)", async () => {
    const { transport, handle } = setup(files(2), {
      errors: { complete: [folderUploadApiError(409, "folder_upload_canceled")] },
    });
    const report = await settle(handle.done);
    expect(report).toMatchObject({ canceled: true, canRetry: false });
    expect(transport.calls.some((c) => c.method === "cancel")).toBe(false);
  });
});

describe("runFolderUpload content PUT refusals (contract AMENDMENT 4)", () => {
  const refusal = (status: number, code: string, settle?: "done" | { code: string; message: string }) => ({
    status,
    code,
    ...(settle ? { settle } : {}),
  });
  const puts = (calls: FakeFolderUploadCall[]) => calls.filter((c) => c.method === "put");

  it("415 unsupported_media: fails the file for good, no PUT retry, no complete for it, not re-run by retryFailed", async () => {
    const { transport, handle } = setup(files(3), {
      sessionTargets: true,
      putFailures: { "f001.pdf": [refusal(415, "unsupported_media"), "network", "network"], "f002.pdf": ["network", "network", "network"] },
    });
    const report = await settle(handle.done);
    expect(report.done).toBe(1);
    expect(report.failed).toContainEqual({ path: "R/f001.pdf", filename: "f001.pdf", code: "unsupported_media", retryable: false });
    expect(puts(transport.calls).filter((c) => c.method === "put" && c.fileKey === "f-0002")).toHaveLength(1);
    const completed = transport.calls.flatMap((c) => (c.method === "complete" ? c.items.map((i) => i.file_key) : []));
    expect(completed).not.toContain("f-0002");

    // f002 is a retryable network failure, so a retry runs; f001 must stay out of it.
    const before = transport.calls.length;
    const retried = await settle(handle.retryFailed());
    const rerun = transport.calls.slice(before).flatMap((c) => (c.method === "put" ? [c.fileKey] : []));
    expect(rerun).toEqual(["f-0003"]);
    expect(retried.failed).toEqual([{ path: "R/f001.pdf", filename: "f001.pdf", code: "unsupported_media", retryable: false }]);
    expect(retried.canRetry).toBe(false);
  });

  it("409 folder_upload_file_settled (done at the server): takes the server's answer, no failure, no complete", async () => {
    const { transport, handle } = setup(files(2), {
      sessionTargets: true,
      putFailures: { "f000.pdf": [refusal(409, "folder_upload_file_settled", "done")] },
    });
    const report = await settle(handle.done);
    expect(report).toMatchObject({ done: 2, failed: [], canRetry: false });
    expect(transport.calls.filter((c) => c.method === "status")).toHaveLength(1);
    const completed = transport.calls.flatMap((c) => (c.method === "complete" ? c.items.map((i) => i.file_key) : []));
    expect(completed).toEqual(["f-0002"]);
  });

  it("409 folder_upload_file_settled (failed at the server): reports the server's code, not retryable", async () => {
    const { handle } = setup(files(1), {
      sessionTargets: true,
      putFailures: { "f000.pdf": [refusal(409, "folder_upload_file_settled", { code: "unsupported_media", message: "m" })] },
    });
    const report = await settle(handle.done);
    expect(report.done).toBe(0);
    expect(report.failed).toEqual([{ path: "R/f000.pdf", filename: "f000.pdf", code: "unsupported_media", retryable: false }]);
    expect(report.canRetry).toBe(false);
  });

  it("409 folder_upload_target_signed: one status() for a fresh target, then PUTs again and finishes", async () => {
    const { transport, handle } = setup(files(1), {
      sessionTargets: true,
      putFailures: { "f000.pdf": [refusal(409, "folder_upload_target_signed")] },
    });
    const report = await settle(handle.done);
    expect(transport.calls.map((c) => c.method)).toEqual(["plan", "put", "status", "put", "complete"]);
    expect(report).toMatchObject({ done: 1, failed: [] });
  });

  it("409 folder_upload_target_signed twice: fails the file as retryable", async () => {
    const { transport, handle } = setup(files(1), {
      sessionTargets: true,
      putFailures: { "f000.pdf": [refusal(409, "folder_upload_target_signed"), refusal(409, "folder_upload_target_signed")] },
    });
    const report = await settle(handle.done);
    expect(transport.calls.map((c) => c.method)).toEqual(["plan", "put", "status", "put"]);
    expect(report.failed).toEqual([
      { path: "R/f000.pdf", filename: "f000.pdf", code: "folder_upload_target_signed", retryable: true },
    ]);
    expect(report.canRetry).toBe(true);
  });

  it("409 folder_upload_canceled at the PUT ends the run as canceled, without a cancel call", async () => {
    const { transport, handle, progress } = setup(files(2), {
      sessionTargets: true,
      putFailures: { "f000.pdf": [refusal(409, "folder_upload_canceled")] },
    });
    const report = await settle(handle.done);
    expect(report).toMatchObject({ canceled: true, canRetry: false });
    expect(progress.at(-1)?.phase).toBe("canceled");
    expect(transport.calls.some((c) => c.method === "cancel")).toBe(false);
  });

  it("410 folder_upload_expired at the PUT ends the run as expired", async () => {
    const { handle, progress } = setup(files(2), {
      sessionTargets: true,
      putFailures: { "f000.pdf": [refusal(410, "folder_upload_expired")] },
    });
    const report = await settle(handle.done);
    expect(report).toMatchObject({ expired: true, canRetry: false });
    expect(progress.at(-1)?.phase).toBe("expired");
  });
});

describe("runFolderUpload invalidation", () => {
  it("invalidates at most once per 2 s during the run and once at the end", async () => {
    const { handle, invalidations } = setup(files(12), { latencyMs: 300 }, { limits: { parallel: 1, completeBatch: 1 } });
    await settle(handle.done);
    expect(invalidations.length).toBeGreaterThanOrEqual(3);
    const during = invalidations.slice(0, -1);
    for (let i = 1; i < during.length; i++) {
      expect((during[i] as number) - (during[i - 1] as number)).toBeGreaterThanOrEqual(2_000);
    }
    // 12 files x 600 ms is about 7 s: nowhere near one refresh per file.
    expect(invalidations.length).toBeLessThanOrEqual(6);
  });
});

describe("runFolderUpload files mode (CONTRACT section 10)", () => {
  it("A2/A4: sends no root_name or folders, paths at the destination, and reports no root", async () => {
    const entries = [{ path: "a.pdf", size: 1 }, { path: "a.pdf", size: 2 }];
    const plan = planFileUpload(entries, { limits: LIMITS });
    const transport = createFakeFolderUploadTransport();
    const handle = runFolderUpload({
      transport,
      plan,
      file: (index) => new Blob(["x".repeat(entries[index]?.size ?? 0)]),
      parentId: "parent-1",
      shareWithWorkspace: true,
      limits: { parallel: 2, completeBatch: 50 },
      idempotencyKey: "k",
    });
    const report = await settle(handle.done);
    const call = transport.calls.find((c) => c.method === "plan");
    expect(call?.method === "plan" && call.body).toStrictEqual({
      parent_id: "parent-1",
      share_with_workspace: true,
      files: [
        { file_key: "f-0001", path: "", filename: "a.pdf", size_bytes: 1 },
        { file_key: "f-0002", path: "", filename: "a.pdf", size_bytes: 2 },
      ],
    });
    expect(report).toMatchObject({ root: null, done: 2, failed: [], canRetry: false });
  });
});

describe("runFolderUpload review-fe-r1 fixes", () => {
  const completes = (calls: FakeFolderUploadCall[]) =>
    calls.flatMap((c) => (c.method === "complete" ? [c.items.map((i) => i.file_key)] : []));

  it("RF3: completes within 1.5 s of the first stored file in a steady stream", async () => {
    // plan 0-500, then one file stored every 500 ms from t=1000; never a 1.5 s gap.
    const { transport, handle } = setup(files(40), { latencyMs: 500 }, { limits: { parallel: 1, completeBatch: 50 } });
    await vi.advanceTimersByTimeAsync(2_500);
    const first = completes(transport.calls)[0];
    expect(first?.[0]).toBe("f-0001");
    await settle(handle.done);
  });

  it("RF3: cancel completes the buffered files, then cancels; in-flight PUTs are aborted", async () => {
    // plan 0-100, f1+f2 stored at 200, f3+f4 at 300, f5+f6 in flight at 350.
    const { transport, handle } = setup(files(6), { latencyMs: 100 }, { limits: { parallel: 2, completeBatch: 50 } });
    await vi.advanceTimersByTimeAsync(350);
    handle.cancel();
    const report = await settle(handle.done);
    const tail = transport.calls.slice(transport.calls.findIndex((c) => c.method === "complete"));
    expect(tail.map((c) => c.method)).toEqual(["complete", "cancel"]);
    expect(completes(tail)).toEqual([["f-0001", "f-0002", "f-0003", "f-0004"]]);
    expect(report).toMatchObject({ canceled: true, done: 4, canRetry: false });
    expect(transport.batch?.files.filter((f) => f.status === "done")).toHaveLength(4);
  });

  it("RF3: cancel still cancels when the buffered complete fails", async () => {
    const { transport, handle } = setup(files(2), { latencyMs: 100 });
    await vi.advanceTimersByTimeAsync(250);
    transport.failNext("complete", folderUploadApiError(400, "invalid_request"));
    handle.cancel();
    const report = await settle(handle.done);
    expect(transport.calls.map((c) => c.method).slice(-2)).toEqual(["complete", "cancel"]);
    expect(report).toMatchObject({ canceled: true, done: 0 });
  });

  it("RF4: marks each failed file retryable or not, and server-final failures do not offer retry", async () => {
    const { transport, handle } = setup(files(2), {
      fileErrors: { "f000.pdf": { code: "storage_quota_exceeded", message: "m" } },
    });
    const report = await settle(handle.done);
    expect(report.failed).toEqual([{ path: "R/f000.pdf", filename: "f000.pdf", code: "storage_quota_exceeded", retryable: false }]);
    expect(report.canRetry).toBe(false);
    const before = transport.calls.length;
    const retried = await settle(handle.retryFailed());
    expect(transport.calls.length).toBe(before);
    expect(retried.canRetry).toBe(false);
  });

  it("RF4: a network failure is retryable, and a retry runs as phase retrying", async () => {
    const { handle, progress } = setup(files(2), { putFailures: { "f001.pdf": ["network", "network", "network"] } });
    const report = await settle(handle.done);
    expect(report.failed).toEqual([{ path: "R/f001.pdf", filename: "f001.pdf", code: "network", retryable: true }]);
    const seen = progress.length;
    await settle(handle.retryFailed());
    const phases = progress.slice(seen).map((p) => p.phase);
    expect(phases).not.toContain("uploading");
    expect(phases[0]).toBe("retrying");
    expect(phases.at(-1)).toBe("finished");
  });

  it("RF4: a retry with nothing the server still holds pending never emits uploading", async () => {
    const { transport, handle, progress } = setup(files(1), { putFailures: { "f000.pdf": ["network", "network", "network"] } });
    await settle(handle.done);
    const file = transport.batch?.files[0];
    if (file) {
      file.status = "failed";
      file.error = { code: "upload_missing", message: "" };
    }
    const seen = progress.length;
    const retried = await settle(handle.retryFailed());
    expect(progress.slice(seen).map((p) => p.phase)).toEqual(["retrying", "finished"]);
    expect(retried.failed).toEqual([{ path: "R/f000.pdf", filename: "f000.pdf", code: "upload_missing", retryable: false }]);
    expect(retried.canRetry).toBe(false);
  });

  it("Q11: a failure the server keeps pending is retryable; the retry sends the bytes again", async () => {
    const { transport, handle } = setup(files(2), { fileErrors: { "f001.pdf": { code: "size_mismatch", message: "m" } } });
    const report = await settle(handle.done);
    expect(report.failed).toEqual([{ path: "R/f001.pdf", filename: "f001.pdf", code: "size_mismatch", retryable: true }]);
    expect(report.canRetry).toBe(true);
    const before = transport.calls.length;
    const retried = await settle(handle.retryFailed());
    expect(transport.calls.slice(before).map((c) => c.method)).toEqual(["status", "put", "complete"]);
    expect(retried).toMatchObject({ done: 2, failed: [], canRetry: false });
  });

  it("RF5: after one refresh, PUTs a target the client clock still reads as expired", async () => {
    const { transport, handle } = setup(files(2), { clientClockAheadMs: 2 * 3_600_000 });
    const report = await settle(handle.done);
    expect(transport.calls.map((c) => c.method)).toEqual(["plan", "status", "put", "put", "complete"]);
    expect(report.done).toBe(2);
  });

  it("RF6: retries a complete that failed on the network, without a second PUT", async () => {
    const { transport, handle } = setup(files(2));
    transport.failNext("complete", new TypeError("Failed to fetch"));
    const report = await settle(handle.done);
    expect(completes(transport.calls)).toEqual([["f-0001", "f-0002"], ["f-0001", "f-0002"]]);
    expect(transport.calls.filter((c) => c.method === "put")).toHaveLength(2);
    expect(report.done).toBe(2);
  });

  it("RF6: honours Retry-After once on a 429 complete", async () => {
    const { transport, handle } = setup(files(1));
    transport.failNext("complete", folderUploadApiError(429, "rate_limited", {}, 7));
    // The queue ends at once, so the complete goes at t=0 and its retry at 7 s.
    await vi.advanceTimersByTimeAsync(6_900);
    expect(completes(transport.calls)).toHaveLength(1);
    const report = await settle(handle.done);
    expect(completes(transport.calls)).toHaveLength(2);
    expect(report.done).toBe(1);
  });

  it("RF6: resends only the items a complete answer left without a result", async () => {
    const { transport, handle } = setup(files(3), { dropResults: ["f001.pdf"] });
    const report = await settle(handle.done);
    expect(completes(transport.calls)).toEqual([["f-0001", "f-0002", "f-0003"], ["f-0002"]]);
    expect(report.done).toBe(3);
  });

  it("RF6: a complete that keeps failing leaves the bytes; the retry completes without a PUT", async () => {
    const { transport, handle } = setup(files(1));
    for (let i = 0; i < 3; i++) transport.failNext("complete", folderUploadApiError(503, "internal"));
    const report = await settle(handle.done);
    expect(report.failed).toEqual([{ path: "R/f000.pdf", filename: "f000.pdf", code: "http_503", retryable: true }]);
    const before = transport.calls.length;
    const retried = await settle(handle.retryFailed());
    expect(transport.calls.slice(before).map((c) => c.method)).toEqual(["status", "complete"]);
    expect(retried).toMatchObject({ done: 1, failed: [], canRetry: false });
  });

  it("RF6: one failed status during a refresh is retried, not fatal to the queue", async () => {
    const { transport, handle } = setup(files(3), { expiredTargets: ["f000.pdf", "f001.pdf"] });
    transport.failNext("status", new TypeError("Failed to fetch"));
    const report = await settle(handle.done);
    expect(transport.calls.filter((c) => c.method === "status")).toHaveLength(2);
    expect(report).toMatchObject({ done: 3, failed: [] });
  });

  it("RF10: an in-memory retry keeps the stored parts; a refreshed target drops the ones it lists", async () => {
    const big = [{ path: "R/big.pdf", size: 10 }];
    const seen = (t: ReturnType<typeof setup>["transport"]) =>
      t.calls.flatMap((c) => (c.method === "put" ? [c.storedParts] : []));
    const net = setup(big, { multipartAboveBytes: 5, partSize: 4, putFailures: { "big.pdf": ["partial-network"] } });
    expect(await settle(net.handle.done)).toMatchObject({ done: 1 });
    expect(seen(net.transport)).toEqual([[], [1]]);
    const refused = setup(big, { multipartAboveBytes: 5, partSize: 4, putFailures: { "big.pdf": ["partial-403"] } });
    expect(await settle(refused.handle.done)).toMatchObject({ done: 1 });
    // The fresh target lists every part again, so the server wants them all.
    expect(seen(refused.transport)).toEqual([[], []]);
  });
});

describe("runFolderUpload retry classification by status (review r2, R2B-2)", () => {
  const puts = (calls: FakeFolderUploadCall[]) => calls.filter((c) => c.method === "put");
  const unavailable = { status: 503, code: "storage_unavailable" };

  it("a 503 with a server code at the content PUT ends retryable, and retryFailed completes it", async () => {
    const { transport, handle } = setup(files(1), { putFailures: { "f000.pdf": [unavailable, unavailable, unavailable] } });
    const report = await settle(handle.done);
    expect(report.failed).toEqual([{ path: "R/f000.pdf", filename: "f000.pdf", code: "storage_unavailable", retryable: true }]);
    expect(report.canRetry).toBe(true);
    const retried = await settle(handle.retryFailed());
    expect(retried).toMatchObject({ done: 1, failed: [], canRetry: false });
    expect(puts(transport.calls)).toHaveLength(4);
  });

  it("a 503 with a server code on complete ends retryable, and retryFailed completes without a PUT", async () => {
    const { transport, handle } = setup(files(1));
    for (let i = 0; i < 3; i++) transport.failNext("complete", folderUploadApiError(503, "storage_unavailable"));
    const report = await settle(handle.done);
    expect(report.failed).toEqual([{ path: "R/f000.pdf", filename: "f000.pdf", code: "storage_unavailable", retryable: true }]);
    const before = transport.calls.length;
    const retried = await settle(handle.retryFailed());
    expect(transport.calls.slice(before).map((c) => c.method)).toEqual(["status", "complete"]);
    expect(retried).toMatchObject({ done: 1, failed: [] });
  });

  it("a 429 at the content PUT waits Retry-After once, then succeeds", async () => {
    const { transport, handle } = setup(files(1), {
      putFailures: { "f000.pdf": [{ status: 429, code: "rate_limited", retryAfter: 7 }] },
    });
    await vi.advanceTimersByTimeAsync(6_900);
    expect(puts(transport.calls)).toHaveLength(1);
    const report = await settle(handle.done);
    expect(puts(transport.calls)).toHaveLength(2);
    expect(report).toMatchObject({ done: 1, failed: [] });
  });

  it("a second 429 at the content PUT ends retryable", async () => {
    const limited = { status: 429, code: "rate_limited", retryAfter: 1 };
    const { handle } = setup(files(1), { putFailures: { "f000.pdf": [limited, limited] } });
    const report = await settle(handle.done);
    expect(report.failed).toEqual([{ path: "R/f000.pdf", filename: "f000.pdf", code: "rate_limited", retryable: true }]);
  });

  it("a 429 that persists on complete ends retryable", async () => {
    const { transport, handle } = setup(files(1));
    for (let i = 0; i < 2; i++) transport.failNext("complete", folderUploadApiError(429, "rate_limited", {}, 1));
    const report = await settle(handle.done);
    expect(report.failed).toEqual([{ path: "R/f000.pdf", filename: "f000.pdf", code: "rate_limited", retryable: true }]);
  });
});

describe("runFolderUpload server AMENDMENT 6", () => {
  const completes = (calls: FakeFolderUploadCall[]) => calls.filter((c) => c.method === "complete");
  const puts = (calls: FakeFolderUploadCall[]) => calls.filter((c) => c.method === "put");

  it("6a: upload_session_busy on complete is re-sent by the runner, with no second PUT", async () => {
    const { transport, handle } = setup(files(2), { busyComplete: { "f000.pdf": 1 } });
    const report = await settle(handle.done);
    expect(completes(transport.calls).map((c) => (c.method === "complete" ? c.items.map((i) => i.file_key) : []))).toEqual([
      ["f-0001", "f-0002"],
      ["f-0001"],
    ]);
    expect(puts(transport.calls)).toHaveLength(2);
    expect(report).toMatchObject({ done: 2, failed: [], canRetry: false });
  });

  it("6a: a busy file that stays busy is reported upload_session_busy and retryable, and retryFailed completes it", async () => {
    const { transport, handle } = setup(files(1), { busyComplete: { "f000.pdf": 3 } });
    const report = await settle(handle.done);
    // First attempt plus at most two more (1 s and 3 s apart).
    expect(completes(transport.calls)).toHaveLength(3);
    expect(report.failed).toEqual([{ path: "R/f000.pdf", filename: "f000.pdf", code: "upload_session_busy", retryable: true }]);
    expect(report.canRetry).toBe(true);
    const before = transport.calls.length;
    const retried = await settle(handle.retryFailed());
    expect(transport.calls.slice(before).map((c) => c.method)).toEqual(["status", "complete"]);
    expect(retried).toMatchObject({ done: 1, failed: [] });
  });

  it("6b: a plan refusal that names a file_key gains the file's path and filename", async () => {
    const { handle } = setup(files(3), {
      errors: { plan: [folderUploadApiError(422, "invalid_request", { file_key: "f-0002", reason: "name" })] },
    });
    const err = await settle(handle.done.catch((e: unknown) => e));
    expect(err).toBeInstanceOf(FolderUploadRefusedError);
    expect(err).toMatchObject({
      code: "invalid_request",
      fields: { file_key: "f-0002", reason: "name", path: "R/f001.pdf", filename: "f001.pdf" },
    });
  });

  it("6b: an unknown file_key leaves the refusal fields as they are", async () => {
    const fields = { file_key: "f-0099", reason: "name" };
    const { handle } = setup(files(2), { errors: { plan: [folderUploadApiError(422, "invalid_request", fields)] } });
    const err = await settle(handle.done.catch((e: unknown) => e));
    expect((err as FolderUploadRefusedError).fields).toEqual(fields);
  });

  it("6c: an NFD filename matches the NFC path the server answers, by file_key", async () => {
    const nfd = "Ba\u0301o ca\u0301o.pdf";
    const nfc = "Báo cáo.pdf";
    const { transport, handle } = setup([{ path: `R/${nfd}`, size: 1 }, { path: "R/b.pdf", size: 1 }], {
      fileErrors: { [nfc]: { code: "unsupported_media", message: "" } },
    });
    const report = await settle(handle.done);
    expect(transport.batch?.files[0]).toMatchObject({ path: "", filename: nfc });
    expect(report.done).toBe(1);
    expect(report.failed).toEqual([{ path: `R/${nfc}`, filename: nfc, code: "unsupported_media", retryable: false }]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeFolderUploadTransport, folderUploadApiError, type FakeFolderUploadOptions } from "./fake-transport";
import { planFolderUpload } from "./plan";
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
    expect(progress.at(-1)).toEqual({ done: 7, failed: 0, total: 7, sentBytes: 21, totalBytes: 21, phase: "finished" });
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
    expect(report.failed).toEqual([{ path: "R/f001.pdf", filename: "f001.pdf", code: "network" }]);
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
      { path: "R/f002.pdf", filename: "f002.pdf", code: "unsupported_media", reason: "zip_bomb" },
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
    expect(report).toMatchObject({ canceled: true, canRetry: false, done: 1 });
    const methods = transport.calls.map((c) => c.method);
    expect(methods.at(-1)).toBe("cancel");
    expect(methods.filter((m) => m === "put")).toHaveLength(3);
    expect(transport.batch?.status).toBe("canceled");
    expect(transport.batch?.files[0]?.status).toBe("done");
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backgroundAccepted,
  batchCompleted,
  batchFailed,
  batchRunning,
  dryRunMerge,
  dryRunReplace,
  errorAccessRejected,
  errorBatchRunning,
  errorNotAFolder,
  syncResult,
} from "../../documents/folder-contents-access.fixtures";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import { parseDocumentAccessRejected } from "./documents-sharing";
import {
  getFolderContentsAccessBatch,
  isNotAFolderError,
  parseFolderAccessBatchRunning,
  updateFolderContentsAccess,
  type FolderContentsAccessInput,
} from "./documents-folder-contents-access";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const input: FolderContentsAccessInput = {
  mode: "merge",
  items: [{ principal_type: "user", principal_id: "u1", level: "edit" }],
};

const catching = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to reject");
};

beforeEach(() => {
  setAccessToken("tok");
  vi.stubGlobal("fetch", vi.fn());
  configureRuntime({ apiUrl: "http://api.test" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfig();
  setAccessToken(null);
});

describe("updateFolderContentsAccess", () => {
  it("PUTs the encoded folder path with mode, items and dry_run", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(dryRunMerge));
    await updateFolderContentsAccess("f/1 x", input, { dryRun: true });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/api/v1/documents/f%2F1%20x/contents-access");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ ...input, dry_run: true });
  });

  it("sends dry_run false for the real write and an empty list for replace", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(syncResult));
    await updateFolderContentsAccess("f1", { mode: "replace", items: [] }, { dryRun: false });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual({ mode: "replace", items: [], dry_run: false });
  });

  it("reads a body with a preview as a dry run, warnings kept", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(dryRunReplace));
    const out = await updateFolderContentsAccess("f1", { mode: "replace", items: [] }, { dryRun: true });
    expect(out).toEqual({ kind: "dry_run", total: 42, preview: dryRunReplace.preview });
  });

  it("reads mode sync as the written counts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(syncResult));
    const out = await updateFolderContentsAccess("f1", input, { dryRun: false });
    expect(out).toEqual({
      kind: "sync",
      batch_id: syncResult.batch_id,
      total: 42,
      changed: 37,
      unchanged: 0,
      skipped_not_manageable: 5,
      skipped_locked: 0,
    });
  });

  it("reads mode background (a 202) as a queued batch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(backgroundAccepted, 202));
    const out = await updateFolderContentsAccess("f1", input, { dryRun: false });
    expect(out).toEqual({ kind: "background", batch_id: backgroundAccepted.batch_id, total: 1800 });
  });

  it("treats a body with a batch_id and no mode as sync", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ batch_id: "b1", total: 3, changed: 3 }));
    const out = await updateFolderContentsAccess("f1", input, { dryRun: false });
    expect(out).toMatchObject({ kind: "sync", batch_id: "b1", total: 3, changed: 3, unchanged: 0 });
  });

  const emptyDryRun = {
    kind: "dry_run",
    total: 0,
    preview: { changed: 0, unchanged: 0, skipped_not_manageable: 0, skipped_locked: 0, losing_users: 0, downgraded_users: 0, warnings: [] },
  };

  it.each([
    ["garbage text", "oops"],
    ["null", null],
    ["an array", []],
    ["an empty object", {}],
    ["wrong types everywhere", { batch_id: 7, total: "many", preview: "x", mode: 3 }],
  ])("degrades %s to a dry run with zero counts and never throws", async (_name, body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(updateFolderContentsAccess("f1", input, { dryRun: true })).resolves.toEqual(emptyDryRun);
  });

  it("zeroes a count that is missing or mistyped and keeps the rest of the preview", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ total: 9, preview: { changed: 4, unchanged: "none", skipped_locked: -1, losing_users: 2.5, warnings: ["to_private"] } }),
    );
    const out = await updateFolderContentsAccess("f1", input, { dryRun: true });
    expect(out).toEqual({
      kind: "dry_run",
      total: 9,
      preview: {
        changed: 4,
        unchanged: 0,
        skipped_not_manageable: 0,
        skipped_locked: 0,
        losing_users: 0,
        downgraded_users: 0,
        warnings: ["to_private"],
      },
    });
  });

  it("drops an unknown warning and keeps the known ones", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ total: 1, preview: { ...dryRunMerge.preview, warnings: ["wide_scope", "brand_new", 5, "downgrade"] } }),
    );
    const out = await updateFolderContentsAccess("f1", input, { dryRun: true });
    expect(out.kind === "dry_run" && out.preview.warnings).toEqual(["wide_scope", "downgrade"]);
  });

  it("reads warnings that are not a list as none", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ total: 1, preview: { ...dryRunMerge.preview, warnings: "wide_scope" } }));
    const out = await updateFolderContentsAccess("f1", input, { dryRun: true });
    expect(out.kind === "dry_run" && out.preview.warnings).toEqual([]);
  });

  it("rejects with the ApiError of a refusal", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(errorNotAFolder, 422));
    const err = await catching(() => updateFolderContentsAccess("d1", input, { dryRun: true }));
    expect(err).toBeInstanceOf(ApiError);
    expect(isNotAFolderError(err)).toBe(true);
  });
});

describe("getFolderContentsAccessBatch", () => {
  it("GETs the encoded folder and batch path", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(batchRunning));
    await getFolderContentsAccessBatch("f/1", "b 2");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/api/v1/documents/f%2F1/contents-access/b%202");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it.each([
    ["running", batchRunning],
    ["completed", batchCompleted],
    ["failed", batchFailed],
  ])("reads a %s batch as sent", async (_name, body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getFolderContentsAccessBatch("f1", body.batch_id)).resolves.toEqual(body);
  });

  it("reads queued as queued", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...batchRunning, status: "queued", processed: 0 }));
    const out = await getFolderContentsAccessBatch("f1", batchRunning.batch_id);
    expect(out.status).toBe("queued");
  });

  it("reads an unknown or missing status as running, so the client asks again", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...batchRunning, status: "paused" }));
    expect((await getFolderContentsAccessBatch("f1", "b1")).status).toBe("running");
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...batchRunning, status: undefined }));
    expect((await getFolderContentsAccessBatch("f1", "b1")).status).toBe("running");
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...batchRunning, status: 4 }));
    expect((await getFolderContentsAccessBatch("f1", "b1")).status).toBe("running");
  });

  it("zeroes counts that are missing or mistyped and keeps the status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ batch_id: "b1", status: "completed", total: "lots", processed: null, changed: 5 }));
    await expect(getFolderContentsAccessBatch("f1", "b1")).resolves.toEqual({
      batch_id: "b1",
      status: "completed",
      total: 0,
      processed: 0,
      changed: 5,
      unchanged: 0,
      skipped_not_manageable: 0,
      skipped_locked: 0,
      finished_at: null,
    });
  });

  it("falls back to the asked batch id when the body has none", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "running", total: 3 }));
    const out = await getFolderContentsAccessBatch("f1", "asked");
    expect(out).toMatchObject({ batch_id: "asked", status: "running", total: 3 });
  });

  it.each([
    ["garbage text", "oops"],
    ["null", null],
    ["an array", []],
  ])("degrades %s to a running batch with zero counts and never throws", async (_name, body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getFolderContentsAccessBatch("f1", "b9")).resolves.toEqual({
      batch_id: "b9",
      status: "running",
      total: 0,
      processed: 0,
      changed: 0,
      unchanged: 0,
      skipped_not_manageable: 0,
      skipped_locked: 0,
      finished_at: null,
    });
  });

  it("rejects 404 for a batch that is not the caller's", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "not_found", message: "no" } }, 404));
    const err = await catching(() => getFolderContentsAccessBatch("f1", "b1"));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });
});

describe("error helpers", () => {
  it("parseFolderAccessBatchRunning reads the batch id of the 409", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(errorBatchRunning, 409));
    const err = await catching(() => updateFolderContentsAccess("f1", input, { dryRun: false }));
    expect((err as ApiError).status).toBe(409);
    expect(parseFolderAccessBatchRunning(err)).toEqual({ batch_id: errorBatchRunning.error.fields.batch_id });
    expect(isNotAFolderError(err)).toBe(false);
  });

  it("parseFolderAccessBatchRunning is null for another code, a missing or mistyped id, and a non-ApiError", () => {
    expect(parseFolderAccessBatchRunning(new ApiError("x", "forbidden", 403, undefined, { batch_id: "b1" }))).toBeNull();
    expect(parseFolderAccessBatchRunning(new ApiError("x", "folder_access_batch_running", 409))).toBeNull();
    expect(parseFolderAccessBatchRunning(new ApiError("x", "folder_access_batch_running", 409, undefined, { batch_id: 5 }))).toBeNull();
    expect(parseFolderAccessBatchRunning(new ApiError("x", "folder_access_batch_running", 409, undefined, { batch_id: "" }))).toBeNull();
    expect(parseFolderAccessBatchRunning(new Error("folder_access_batch_running"))).toBeNull();
    expect(parseFolderAccessBatchRunning(undefined)).toBeNull();
  });

  it("isNotAFolderError is true only for the not_a_folder ApiError", () => {
    expect(isNotAFolderError(new ApiError("x", "not_a_folder", 422))).toBe(true);
    expect(isNotAFolderError(new ApiError("x", "not_found", 404))).toBe(false);
    expect(isNotAFolderError({ code: "not_a_folder" })).toBe(false);
  });

  it("the 422 document_access_rejected of this route parses with the existing helper", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(errorAccessRejected, 422));
    const err = await catching(() => updateFolderContentsAccess("f1", input, { dryRun: true }));
    expect(parseDocumentAccessRejected(err)?.rejected).toEqual([
      { index: 1, principal_type: "user", principal_id: "u9", code: "principal_not_in_organization" },
    ]);
  });
});

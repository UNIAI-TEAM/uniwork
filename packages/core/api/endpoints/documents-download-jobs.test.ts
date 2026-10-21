import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import { createDownloadJob, getDownloadJob, isDownloadTooLargeError } from "./documents-download-jobs";

// UNI-2045 W9, contract-first against SV-9 (the server half is not merged):
// POST /workspaces/{ws}/documents/download-jobs answers 202 with a job, GET
// .../download-jobs/{jobID} answers its state. A fake transport only.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const job = (over: Record<string, unknown> = {}) => ({
  id: "job1",
  status: "queued",
  created_at: "2026-10-21T01:00:00Z",
  expires_at: null,
  download_url: null,
  file_count: null,
  skipped: [],
  error: null,
  ...over,
});

describe("documents download-jobs endpoints", () => {
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

  it("createDownloadJob posts the ids and reads the 202 job", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(job(), 202));
    const out = await createDownloadJob("w/1", ["d1", "d2"]);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w%2F1/documents/download-jobs");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ document_ids: ["d1", "d2"] });
    expect(out).toEqual({
      id: "job1",
      status: "queued",
      created_at: "2026-10-21T01:00:00Z",
      expires_at: null,
      download_url: null,
      file_count: null,
      skipped: [],
      error: null,
    });
  });

  it("getDownloadJob reads a ready job with its link and skipped list", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        job({
          status: "ready",
          expires_at: "2026-10-21T02:00:00Z",
          download_url: "https://files.test/zip/job1?sig=x",
          file_count: 2,
          skipped: [
            { document_id: "d3", reason: "not_a_file" },
            { document_id: "d4", reason: "too_large" },
          ],
        }),
      ),
    );
    const out = await getDownloadJob("w1", "job/1");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/workspaces/w1/documents/download-jobs/job%2F1");
    expect(out?.status).toBe("ready");
    expect(out?.download_url).toBe("https://files.test/zip/job1?sig=x");
    expect(out?.file_count).toBe(2);
    expect(out?.skipped).toEqual([
      { document_id: "d3", reason: "not_a_file" },
      { document_id: "d4", reason: "too_large" },
    ]);
  });

  it("keeps an unknown status and reason as strings, and drops what does not parse", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        job({
          status: "archiving",
          download_url: 7,
          file_count: "two",
          expires_at: false,
          error: { nope: true },
          skipped: [{ document_id: "d1", reason: "virus" }, { document_id: 3 }, "x"],
        }),
      ),
    );
    const out = await getDownloadJob("w1", "job1");
    expect(out).toEqual({
      id: "job1",
      status: "archiving",
      created_at: "2026-10-21T01:00:00Z",
      expires_at: null,
      download_url: null,
      file_count: null,
      skipped: [{ document_id: "d1", reason: "virus" }],
      error: null,
    });
  });

  // ---- malformed responses: one per endpoint -----------------------------
  // A job without an id cannot be polled or downloaded: both endpoints
  // resolve null and the hook turns that into "result not verifiable".
  const malformed = [{ nope: true }, { id: "" }, { id: 1, status: "ready" }, null, [], "str"];

  it.each(malformed)("createDownloadJob resolves null on a malformed answer %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body, 202));
    await expect(createDownloadJob("w1", ["d1", "d2"])).resolves.toBeNull();
  });

  it.each(malformed)("getDownloadJob resolves null on a malformed answer %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDownloadJob("w1", "job1")).resolves.toBeNull();
  });

  it("a 422 download_too_large is its own error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "download_too_large", message: "too big" } }, 422));
    const failure = await createDownloadJob("w1", ["d1", "d2"]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(isDownloadTooLargeError(failure)).toBe(true);
    expect(isDownloadTooLargeError(new ApiError("x", "forbidden", 403))).toBe(false);
  });
});

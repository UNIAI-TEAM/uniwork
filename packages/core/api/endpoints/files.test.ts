import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { noopLogger } from "../../logger";
import { setSchemaLogger } from "../schema";
import { setAccessToken } from "../session";
import { resolveWorkspaceFiles } from "./files";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const view = (id: string) => ({
  id,
  filename: "bao-cao.pdf",
  content_type: "application/pdf",
  size_bytes: 245760,
  status: "ready",
  ready_at: "2026-09-26T10:00:00Z",
});

const unavailable = (fileId: string) => ({
  fileId,
  file: null,
  access: null,
  url: null,
  urlExpiresAt: null,
  error: { code: "file_unavailable", message: "" },
});

describe("files endpoints", () => {
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

  it("posts the ids in order and maps presign, proxy and refused entries", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        items: [
          {
            file_id: "f1",
            file: view("f1"),
            access: "presign",
            url: "https://s3.test/o?sig=1",
            url_expires_at: "2026-09-26T22:00:00Z",
            error: null,
          },
          {
            file_id: "f2",
            file: view("f2"),
            access: "proxy",
            url: "/api/v1/files/f2/content?ticket=t",
            url_expires_at: "2026-09-26T21:00:00Z",
            error: null,
          },
          {
            file_id: "f3",
            file: null,
            url_expires_at: null,
            error: { code: "file_deleting", message: "file is being deleted" },
          },
        ],
      }),
    );
    const out = await resolveWorkspaceFiles("ws1", ["f1", "f2", "f3"], "attachment");

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/ws1/files/resolve");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      file_ids: ["f1", "f2", "f3"],
      disposition: "attachment",
    });

    expect(out[0]).toMatchObject({
      fileId: "f1",
      access: "presign",
      url: "https://s3.test/o?sig=1",
      error: null,
    });
    // A presigned URL is used exactly as signed; a proxy URL gets the API origin.
    expect(out[1]).toMatchObject({
      fileId: "f2",
      access: "proxy",
      url: "http://api.test/api/v1/files/f2/content?ticket=t",
      urlExpiresAt: "2026-09-26T21:00:00Z",
    });
    expect(out[2]).toEqual({
      fileId: "f3",
      file: null,
      access: null,
      url: null,
      urlExpiresAt: null,
      error: { code: "file_deleting", message: "file is being deleted" },
    });
  });

  it("never keeps a URL next to an error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        items: [
          {
            file_id: "f1",
            file: view("f1"),
            access: "presign",
            url: "https://stale",
            error: { code: "file_not_found" },
          },
        ],
      }),
    );
    const [item] = await resolveWorkspaceFiles("ws1", ["f1"]);
    expect(item).toMatchObject({ url: null, file: null, error: { code: "file_not_found", message: "" } });
  });

  it("degrades a malformed envelope to file_unavailable for every id", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ nope: true }))
      .mockResolvedValueOnce(json({ items: "x" }))
      .mockResolvedValueOnce(json(null));
    for (let i = 0; i < 3; i++) {
      await expect(resolveWorkspaceFiles("ws1", ["f1", "f2"])).resolves.toEqual([
        unavailable("f1"),
        unavailable("f2"),
      ]);
    }
  });

  it("degrades only the malformed entry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        items: [
          { file_id: 1 },
          {
            file_id: "f2",
            file: view("f2"),
            access: "presign",
            url: "https://ok",
            url_expires_at: "2026-09-26T22:00:00Z",
          },
          { file_id: "other", file: view("other"), access: "presign", url: "https://wrong" },
          { file_id: "f4", file: view("f4"), access: "presign", url: "  " },
          { file_id: "f5", file: { id: "f5" }, access: "presign", url: "https://bad-view" },
        ],
      }),
    );
    const out = await resolveWorkspaceFiles("ws1", ["f1", "f2", "f3", "f4", "f5", "f6"]);
    expect(out.map((r) => r.error?.code ?? "ok")).toEqual([
      "file_unavailable", // wrong type
      "ok",
      "file_unavailable", // an entry for another id is never shown for this one
      "file_unavailable", // success without a URL
      "file_unavailable", // malformed file view
      "file_unavailable", // missing entry
    ]);
    expect(out[1]?.url).toBe("https://ok");
  });

  it("never hands a URL or ticket to the schema logger", async () => {
    const warn = vi.fn();
    setSchemaLogger({ ...noopLogger, warn });
    try {
      vi.mocked(fetch).mockResolvedValueOnce(
        json({
          items: [
            { file_id: "f1", file: { id: "f1" }, access: "proxy", url: "/api/v1/files/f1/content?ticket=SECRET" },
            { file_id: "f2", file: view("f2"), access: "presign", url: "https://s3.test/o?X-Amz-Signature=SECRET" },
          ],
        }),
      );
      const out = await resolveWorkspaceFiles("ws1", ["f1", "f2"]);
      expect(out[0]?.error?.code).toBe("file_unavailable");
      expect(out[1]?.url).toBe("https://s3.test/o?X-Amz-Signature=SECRET");
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET");
    } finally {
      setSchemaLogger(noopLogger);
    }
  });

  it("keeps the URL but narrows an unknown access mode to null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ items: [{ file_id: "f1", file: view("f1"), access: "cdn", url: "/relative" }] }),
    );
    const [item] = await resolveWorkspaceFiles("ws1", ["f1"]);
    expect(item).toMatchObject({ access: null, url: "/relative", urlExpiresAt: null, error: null });
  });

  it("does not call the API for an empty batch", async () => {
    await expect(resolveWorkspaceFiles("ws1", [])).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

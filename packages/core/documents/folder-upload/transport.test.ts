import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/http";
import { FolderUploadError, putToStorage, type FileTarget } from "./transport";

const FUTURE = "2999-01-01T00:00:00Z";

function okWithEtag(etag: string | null): Response {
  return new Response(null, { status: 200, headers: etag === null ? {} : { ETag: etag } });
}

describe("putToStorage", () => {
  it("PUTs a whole file to a presigned URL and returns its ETag", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okWithEtag('"abc"'));
    const target: FileTarget = {
      kind: "put",
      url: "https://storage.test/obj",
      headers: { "Content-Type": "text/plain", Authorization: "Bearer leak" },
      expires_at: FUTURE,
    };
    const blob = new Blob(["hello"]);
    await expect(putToStorage(target, blob, undefined, { fetch: fetchMock })).resolves.toEqual({ etag: '"abc"' });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://storage.test/obj");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(blob);
    expect(init?.credentials).toBe("omit");
    // Storage is presigned: the session token never leaves for another origin.
    expect(init?.headers).toEqual({ "Content-Type": "text/plain" });
  });

  it("fails with missing_etag when storage answers without an ETag", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okWithEtag(null));
    const target: FileTarget = { kind: "put", url: "https://storage.test/obj", headers: {}, expires_at: FUTURE };
    const err = await putToStorage(target, new Blob(["x"]), undefined, { fetch: fetchMock }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FolderUploadError);
    expect((err as FolderUploadError).code).toBe("missing_etag");
  });

  it("surfaces a storage refusal as an ApiError carrying the status", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("denied", { status: 403 }));
    const target: FileTarget = { kind: "put", url: "https://storage.test/obj", headers: {}, expires_at: FUTURE };
    const err = await putToStorage(target, new Blob(["x"]), undefined, { fetch: fetchMock }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
  });

  it("passes the abort signal through, so cancel stops an in-flight PUT", async () => {
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const controller = new AbortController();
    const target: FileTarget = { kind: "put", url: "https://storage.test/obj", headers: {}, expires_at: FUTURE };
    const pending = putToStorage(target, new Blob(["x"]), controller.signal, { fetch: fetchMock });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sends a session target part by part and returns every part ETag", async () => {
    const fetchMock = vi.fn<typeof fetch>((url) => Promise.resolve(okWithEtag(`"${String(url).slice(-1)}"`)));
    const target: FileTarget = {
      kind: "session",
      session_id: "s1",
      part_size: 4,
      expires_at: FUTURE,
      parts: [1, 2, 3].map((n) => ({
        part_number: n,
        method: "PUT",
        url: `https://storage.test/part${n}`,
        headers: {},
        expires_at: FUTURE,
      })),
    };
    const result = await putToStorage(target, new Blob(["0123456789"]), undefined, { fetch: fetchMock });
    expect(result).toEqual({
      parts: [
        { part_number: 1, etag: '"1"' },
        { part_number: 2, etag: '"2"' },
        { part_number: 3, etag: '"3"' },
      ],
    });
    const sizes = fetchMock.mock.calls.map(([, init]) => (init?.body as Blob).size);
    expect(sizes).toEqual([4, 4, 2]);
  });

  it("fails a session target that lacks the URL of a part", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okWithEtag('"e"'));
    const target: FileTarget = {
      kind: "session",
      session_id: "s1",
      part_size: 4,
      expires_at: FUTURE,
      parts: [{ part_number: 1, method: "PUT", url: "https://storage.test/part1", headers: {}, expires_at: FUTURE }],
    };
    const err = await putToStorage(target, new Blob(["0123456789"]), undefined, { fetch: fetchMock }).catch(
      (e: unknown) => e,
    );
    expect((err as FolderUploadError).code).toBe("missing_part_url");
  });
});

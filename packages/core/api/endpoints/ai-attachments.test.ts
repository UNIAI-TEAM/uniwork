import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError, CORRELATION_HEADER, errorCode } from "../http";
import { setAccessToken } from "../session";
import { deleteAskAttachment, downloadAskAttachment, uploadAskAttachment } from "./ai-attachments";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Listener = (event?: { loaded: number; total: number; lengthComputable: boolean }) => void;

/** Minimal XMLHttpRequest fake: records the request, lets a test drive the events. */
class FakeXhr {
  static all: FakeXhr[] = [];
  static get last(): FakeXhr {
    return FakeXhr.all[FakeXhr.all.length - 1]!;
  }
  status = 0;
  statusText = "";
  responseText = "";
  rawHeaders = "";
  withCredentials = false;
  method = "";
  url = "";
  body: unknown = null;
  aborted = false;
  setHeaders: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  uploadListeners: Record<string, Listener[]> = {};
  upload = {
    addEventListener: (name: string, fn: Listener) => {
      (this.uploadListeners[name] ??= []).push(fn);
    },
  };
  constructor() {
    FakeXhr.all.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.setHeaders[k] = v;
  }
  addEventListener(name: string, fn: Listener) {
    (this.listeners[name] ??= []).push(fn);
  }
  getAllResponseHeaders() {
    return this.rawHeaders;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.fire("abort");
  }
  fire(name: string) {
    for (const fn of this.listeners[name] ?? []) fn();
  }
  progress(loaded: number, total: number) {
    for (const fn of this.uploadListeners["progress"] ?? []) fn({ loaded, total, lengthComputable: true });
  }
  answer(status: number, body: unknown, headers = "Content-Type: application/json") {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.rawHeaders = headers;
    this.fire("load");
  }
}

const file = () => new File(["%PDF-1.7"], "q3.pdf", { type: "application/pdf" });
const uploaded = { file_id: "f1", name: "q3.pdf", mime: "application/pdf", size: 8, kind: "pdf" };

describe("ai attachment endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    FakeXhr.all = [];
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("uploadAskAttachment posts the file as multipart with the bearer, a correlation id and progress", async () => {
    const onProgress = vi.fn();
    const p = uploadAskAttachment("ws1", file(), { onProgress });
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("http://api.test/api/v1/workspaces/ws1/ai/attachments");
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.setHeaders["Authorization"]).toBe("Bearer tok");
    expect(xhr.setHeaders[CORRELATION_HEADER]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    // The multipart boundary is the browser's to set.
    expect(xhr.setHeaders["Content-Type"]).toBeUndefined();
    const form = xhr.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((form.get("file") as File).name).toBe("q3.pdf");
    xhr.progress(4, 8);
    expect(onProgress).toHaveBeenCalledWith(4, 8);
    xhr.answer(200, uploaded);
    await expect(p).resolves.toEqual(uploaded);
  });

  it("uploadAskAttachment degrades on a malformed response instead of throwing", async () => {
    for (const bad of [{ file_id: 1 }, "not json", [], null]) {
      const p = uploadAskAttachment("ws1", file());
      FakeXhr.last.answer(200, bad);
      // No usable file id: the caller reads an empty id as a failed upload.
      await expect(p).resolves.toMatchObject({ file_id: "", name: "q3.pdf", mime: "application/pdf", size: 8 });
    }
    const p = uploadAskAttachment("ws1", file());
    FakeXhr.last.answer(200, { file_id: "f2", name: 7, size: "big" });
    await expect(p).resolves.toEqual({ file_id: "f2", name: "", mime: "", size: 0, kind: "" });
  });

  it("uploadAskAttachment maps a refusal to the ApiError the transport throws", async () => {
    const p = uploadAskAttachment("ws1", file()).catch((e: unknown) => e);
    FakeXhr.last.answer(
      422,
      { error: { code: "ai_attachment_unreadable", message: "unreadable" } },
      "Content-Type: application/json\r\nX-Correlation-ID: corr-1",
    );
    const err = await p;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, correlationId: "corr-1" });
    expect(errorCode(err)).toBe("ai_attachment_unreadable");
    // A refusal with no JSON body still becomes an ApiError.
    const q = uploadAskAttachment("ws1", file()).catch((e: unknown) => e);
    FakeXhr.last.answer(502, "<html>bad gateway</html>", "Content-Type: text/html");
    expect(await q).toMatchObject({ status: 502, code: "internal" });
  });

  it("uploadAskAttachment refreshes the session once on 401 and sends the file again with the new token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ user: { id: "u", email: "a@b.c", display_name: "A" }, access_token: "tok-2" }),
    );
    const p = uploadAskAttachment("ws1", file());
    FakeXhr.last.answer(401, { error: { code: "unauthorized", message: "x" } });
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(2));
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/auth/refresh");
    expect(FakeXhr.last.setHeaders["Authorization"]).toBe("Bearer tok-2");
    expect((FakeXhr.last.body as FormData).get("file")).toBeInstanceOf(File);
    FakeXhr.last.answer(200, uploaded);
    await expect(p).resolves.toEqual(uploaded);
  });

  it("uploadAskAttachment aborts the request and rejects with an AbortError", async () => {
    const ctl = new AbortController();
    const p = uploadAskAttachment("ws1", file(), { signal: ctl.signal }).catch((e: unknown) => e);
    ctl.abort();
    const err = await p;
    expect(FakeXhr.last.aborted).toBe(true);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
    // A signal that is already aborted sends nothing.
    const late = await uploadAskAttachment("ws1", file(), { signal: ctl.signal }).catch((e: unknown) => e);
    expect((late as DOMException).name).toBe("AbortError");
    expect(FakeXhr.all.filter((x) => x.body !== null)).toHaveLength(1);
  });

  it("uploadAskAttachment rejects with a TypeError on a network error", async () => {
    const p = uploadAskAttachment("ws1", file()).catch((e: unknown) => e);
    FakeXhr.last.fire("error");
    expect(await p).toBeInstanceOf(TypeError);
  });

  it("deleteAskAttachment sends DELETE for the file id and reads a 204", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteAskAttachment("ws1", "f1")).resolves.toBeUndefined();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/workspaces/ws1/ai/attachments/f1");
    expect((init as RequestInit).method).toBe("DELETE");
    // An answer body, if one ever comes, is not read as anything.
    vi.mocked(fetch).mockResolvedValueOnce(json({ ok: true }));
    await expect(deleteAskAttachment("ws1", "f2")).resolves.toBeUndefined();
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "not_found", message: "m" } }, 404));
    await expect(deleteAskAttachment("ws1", "f3")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("downloadAskAttachment returns the bytes with the bearer, and throws the refusal", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("%PDF-1.7", { status: 200, headers: { "Content-Type": "application/pdf" } }),
    );
    const blob = await downloadAskAttachment("ws1", "a1");
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(8);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/workspaces/ws1/ai/attachments/a1/content");
    expect(((init as RequestInit).headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "not_found", message: "m" } }, 404));
    await expect(downloadAskAttachment("ws1", "other")).rejects.toMatchObject({ status: 404 });
  });
});

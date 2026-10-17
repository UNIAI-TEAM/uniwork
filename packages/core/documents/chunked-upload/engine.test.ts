import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/http";
import { setAccessToken } from "../../api/session";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import type { StorageAdapter } from "../../types/storage";
import {
  ChunkedUploadError,
  findResumableUpload,
  startChunkedUpload,
  uploadFileKey,
  type ChunkedUploadProgress,
} from "./index";

const API = "http://api.test";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

function createFakeStorage(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const createdDoc = {
  id: "doc-created",
  organization_id: "org-1",
  workspace_id: "ws-1",
  parent_id: null,
  kind: "file",
  title: "Report.pdf",
  content_text: "",
  visibility: "workspace",
  revision: "1",
  current_version: 1,
  position: 0,
  created_by: "u-1",
  created_by_kind: "human",
  updated_by: "u-1",
  updated_by_kind: "human",
  created_at: "2026-10-17T12:00:00Z",
  updated_at: "2026-10-17T12:00:00Z",
  breadcrumbs: [],
};

const makePartUrls = (nums: number[], gen = 1, expiresAt = "2099-01-01T00:00:00Z") =>
  nums.map((n) => ({
    part_number: n,
    method: "PUT",
    url: `https://s3.test/upload/part-${n}?gen=${gen}`,
    headers: { "x-part": String(n) },
    expires_at: expiresAt,
  }));

function makeSessionBody(
  sessionId: string,
  totalParts: number,
  parts = makePartUrls(Array.from({ length: totalParts }, (_, i) => i + 1)),
  completedParts: { part_number: number; etag: string; size: number }[] = [],
) {
  return {
    session_id: sessionId,
    part_size: 10,
    total_parts: totalParts,
    completed_parts: completedParts,
    parts,
    expires_at: "2099-01-02T00:00:00Z",
  };
}

function makeFile(sizeBytes = 25, name = "Report.pdf"): File {
  const bytes = new Uint8Array(sizeBytes);
  const header = new TextEncoder().encode("%PDF-1.7\n");
  bytes.set(header.subarray(0, Math.min(header.length, sizeBytes)), 0);
  return new File([bytes], name, { type: "application/pdf", lastModified: 1760700000000 });
}

describe("chunked upload engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setAccessToken("session-tok");
    configureRuntime({ apiUrl: API });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setAccessToken(null);
    resetRuntimeConfig();
  });

  it("uploads 3 parts concurrently on the happy path, emits monotonic progress, and completes", async () => {
    const file = makeFile(25);
    const storage = createFakeStorage();
    const target = { kind: "workspace" as const, workspaceId: "ws-1", title: "Report" };
    const progressEvents: ChunkedUploadProgress[] = [];
    let inFlightPuts = 0;
    let maxInFlightPuts = 0;
    const completedBodyParts: unknown[] = [];

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url === `${API}/api/v1/workspaces/ws-1/documents/upload-sessions`) {
        return json(makeSessionBody("sess-happy", 3), 201);
      }
      if (method === "PUT" && url.startsWith("https://s3.test/upload/part-")) {
        inFlightPuts += 1;
        maxInFlightPuts = Math.max(maxInFlightPuts, inFlightPuts);
        await new Promise<void>((r) => queueMicrotask(r));
        inFlightPuts -= 1;
        const partNum = Number(/part-(\d+)/.exec(url)?.[1]);
        const bodyBlob = init?.body as Blob;
        expect(bodyBlob.size).toBe(partNum < 3 ? 10 : 5);
        expect(init?.credentials).toBe("omit");
        expect(new Headers(init?.headers).get("Authorization")).toBeNull();
        return new Response(null, { status: 200, headers: { ETag: `"etag-${partNum}"` } });
      }
      if (method === "POST" && url === `${API}/api/v1/upload-sessions/sess-happy/complete`) {
        completedBodyParts.push(JSON.parse(String(init?.body)));
        return json({ document: createdDoc }, 200);
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fakeFetch);
    const upload = startChunkedUpload({
      file,
      filename: file.name,
      target,
      idempotencyKey: "idem-happy",
      storage,
      concurrency: 2,
      fetch: fakeFetch,
      onProgress: (p) => progressEvents.push({ ...p }),
    });

    const res = await upload.result;
    expect(res).toEqual({ kind: "document", document: createdDoc });
    expect(maxInFlightPuts).toBe(2);
    expect(completedBodyParts[0]).toEqual({
      parts: [
        { part_number: 1, etag: '"etag-1"' },
        { part_number: 2, etag: '"etag-2"' },
        { part_number: 3, etag: '"etag-3"' },
      ],
    });

    expect(progressEvents.map((p) => p.phase)).toContain("probing");
    expect(progressEvents.map((p) => p.phase)).toContain("opening");
    expect(progressEvents.map((p) => p.phase)).toContain("uploading");
    expect(progressEvents.map((p) => p.phase)).toContain("verifying");
    expect(progressEvents.at(-1)).toEqual({
      phase: "done",
      sentBytes: 25,
      totalBytes: 25,
      sessionId: "sess-happy",
    });
    for (let i = 1; i < progressEvents.length; i += 1) {
      expect(progressEvents[i]!.sentBytes).toBeGreaterThanOrEqual(progressEvents[i - 1]!.sentBytes);
    }
    expect(findResumableUpload(storage, uploadFileKey(file), target)).toBeNull();
  });

  it("retries a part that fails twice at 1s and 2s then succeeds on the 3rd attempt", async () => {
    const file = makeFile(10);
    let part1Attempts = 0;

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/upload-sessions")) {
        return json(makeSessionBody("sess-retry-ok", 1), 201);
      }
      if (method === "PUT" && url.includes("part-1")) {
        part1Attempts += 1;
        if (part1Attempts <= 2) return new Response("server error", { status: 503 });
        return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } });
      }
      if (method === "POST" && url.endsWith("/complete")) {
        return json({ document: createdDoc }, 200);
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fakeFetch);
    const upload = startChunkedUpload({
      file,
      filename: file.name,
      target: { kind: "workspace", workspaceId: "ws-1" },
      idempotencyKey: "idem-retry",
      fetch: fakeFetch,
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    const res = await upload.result;
    expect(res.kind).toBe("document");
    expect(part1Attempts).toBe(3);
  });

  it("marks the upload failed and keeps the session + resume record when a part fails 4 times", async () => {
    const file = makeFile(10);
    const storage = createFakeStorage();
    const target = { kind: "workspace" as const, workspaceId: "ws-1" };
    let part1Attempts = 0;
    let deleteCalled = false;
    const phases: string[] = [];

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/upload-sessions")) {
        return json(makeSessionBody("sess-fail-4", 1), 201);
      }
      if (method === "PUT" && url.includes("part-1")) {
        part1Attempts += 1;
        return new Response("gateway error", { status: 502 });
      }
      if (method === "DELETE") {
        deleteCalled = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fakeFetch);
    const upload = startChunkedUpload({
      file,
      filename: file.name,
      target,
      idempotencyKey: "idem-fail-4",
      storage,
      fetch: fakeFetch,
      onProgress: (p) => phases.push(p.phase),
    });

    const outcomePromise = upload.result.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);

    const err = await outcomePromise;
    expect(err).toBeInstanceOf(ApiError);
    expect(part1Attempts).toBe(4);
    expect(deleteCalled).toBe(false);
    expect(phases.at(-1)).toBe("failed");
    expect(findResumableUpload(storage, uploadFileKey(file), target)).toEqual({
      session_id: "sess-fail-4",
      expires_at: "2099-01-02T00:00:00Z",
      idempotency_key: "idem-fail-4",
    });
  });

  it("refreshes part URLs via GET when a part PUT returns 403", async () => {
    const file = makeFile(10);
    let getCalls = 0;
    const putUrls: string[] = [];

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/upload-sessions")) {
        return json(makeSessionBody("sess-403", 1, makePartUrls([1], 1)), 201);
      }
      if (method === "PUT" && url.startsWith("https://s3.test/upload/part-1")) {
        putUrls.push(url);
        if (url.includes("gen=1")) return new Response("expired signature", { status: 403 });
        return new Response(null, { status: 200, headers: { ETag: '"etag-fresh"' } });
      }
      if (method === "GET" && url === `${API}/api/v1/upload-sessions/sess-403`) {
        getCalls += 1;
        return json({ ...makeSessionBody("sess-403", 1, makePartUrls([1], 2)), status: "open" });
      }
      if (method === "POST" && url.endsWith("/complete")) {
        return json({ document: createdDoc }, 200);
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fakeFetch);
    const upload = startChunkedUpload({
      file,
      filename: file.name,
      target: { kind: "workspace", workspaceId: "ws-1" },
      idempotencyKey: "idem-403",
      fetch: fakeFetch,
    });

    await vi.advanceTimersByTimeAsync(1000);
    const res = await upload.result;
    expect(res.kind).toBe("document");
    expect(getCalls).toBe(1);
    expect(putUrls).toEqual([
      "https://s3.test/upload/part-1?gen=1",
      "https://s3.test/upload/part-1?gen=2",
    ]);
  });

  it("retries a part when the PUT 200 response is missing an ETag header", async () => {
    const file = makeFile(10);
    let attempts = 0;

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/upload-sessions")) {
        return json(makeSessionBody("sess-no-etag", 1), 201);
      }
      if (method === "PUT" && url.includes("part-1")) {
        attempts += 1;
        if (attempts === 1) return new Response(null, { status: 200 });
        return new Response(null, { status: 200, headers: { ETag: '"etag-after-retry"' } });
      }
      if (method === "POST" && url.endsWith("/complete")) {
        return json({ document: createdDoc }, 200);
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fakeFetch);
    const upload = startChunkedUpload({
      file,
      filename: file.name,
      target: { kind: "workspace", workspaceId: "ws-1" },
      idempotencyKey: "idem-etag",
      fetch: fakeFetch,
    });

    await vi.advanceTimersByTimeAsync(1000);
    const res = await upload.result;
    expect(res.kind).toBe("document");
    expect(attempts).toBe(2);
  });

  it("pause aborts in-flight parts and resume skips completed parts via GET", async () => {
    const file = makeFile(20);
    const storage = createFakeStorage();
    const target = { kind: "workspace" as const, workspaceId: "ws-1" };
    const putPartNumbers: number[] = [];
    let resolvePart2Block!: () => void;
    const part2Started = new Promise<void>((r) => {
      resolvePart2Block = r;
    });

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/upload-sessions")) {
        return json(makeSessionBody("sess-pause", 2, makePartUrls([1, 2], 1)), 201);
      }
      if (method === "PUT" && url.includes("part-1")) {
        putPartNumbers.push(1);
        return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } });
      }
      if (method === "PUT" && url.includes("part-2")) {
        putPartNumbers.push(2);
        if (url.includes("gen=1")) {
          resolvePart2Block();
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        return new Response(null, { status: 200, headers: { ETag: '"etag-2"' } });
      }
      if (method === "GET" && url === `${API}/api/v1/upload-sessions/sess-pause`) {
        return json({
          ...makeSessionBody(
            "sess-pause",
            2,
            makePartUrls([2], 2),
            [{ part_number: 1, etag: '"etag-1"', size: 10 }],
          ),
          status: "open",
        });
      }
      if (method === "POST" && url.endsWith("/complete")) {
        return json({ document: createdDoc }, 200);
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const phases: string[] = [];
    vi.stubGlobal("fetch", fakeFetch);
    const upload = startChunkedUpload({
      file,
      filename: file.name,
      target,
      idempotencyKey: "idem-pause",
      storage,
      concurrency: 1,
      fetch: fakeFetch,
      onProgress: (p) => phases.push(p.phase),
    });

    await part2Started;
    upload.pause();
    expect(phases).toContain("paused");
    expect(findResumableUpload(storage, uploadFileKey(file), target)?.session_id).toBe("sess-pause");

    upload.resume();
    const res = await upload.result;
    expect(res.kind).toBe("document");
    expect(putPartNumbers).toEqual([1, 2, 2]);
  });

  it("cancel sends DELETE and clears the resume record", async () => {
    const file = makeFile(10);
    const storage = createFakeStorage();
    const target = { kind: "workspace" as const, workspaceId: "ws-1" };
    let deleteCalled = false;
    let partStarted!: () => void;
    const partInFlight = new Promise<void>((r) => {
      partStarted = r;
    });

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/upload-sessions")) {
        return json(makeSessionBody("sess-cancel", 1), 201);
      }
      if (method === "PUT" && url.includes("part-1")) {
        partStarted();
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      if (method === "DELETE" && url === `${API}/api/v1/upload-sessions/sess-cancel`) {
        deleteCalled = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fakeFetch);
    const upload = startChunkedUpload({
      file,
      filename: file.name,
      target,
      idempotencyKey: "idem-cancel",
      storage,
      fetch: fakeFetch,
    });

    await partInFlight;
    expect(findResumableUpload(storage, uploadFileKey(file), target)?.session_id).toBe("sess-cancel");

    await upload.cancel();
    expect(deleteCalled).toBe(true);
    expect(findResumableUpload(storage, uploadFileKey(file), target)).toBeNull();
    await expect(upload.result).rejects.toBeInstanceOf(ChunkedUploadError);
  });

  it("waits Retry-After on complete 409 upload_session_busy and retries complete", async () => {
    const file = makeFile(10);
    let completeAttempts = 0;

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/upload-sessions")) {
        return json(makeSessionBody("sess-busy", 1), 201);
      }
      if (method === "PUT" && url.includes("part-1")) {
        return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } });
      }
      if (method === "POST" && url.endsWith("/complete")) {
        completeAttempts += 1;
        if (completeAttempts === 1) {
          return json(
            { error: { code: "upload_session_busy", message: "validating", fields: { retry_after: 3 } } },
            409,
            { "Retry-After": "3" },
          );
        }
        return json({ document: createdDoc }, 200);
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fakeFetch);
    const upload = startChunkedUpload({
      file,
      filename: file.name,
      target: { kind: "workspace", workspaceId: "ws-1" },
      idempotencyKey: "idem-busy",
      fetch: fakeFetch,
    });

    await vi.advanceTimersByTimeAsync(3000);
    const res = await upload.result;
    expect(res).toEqual({ kind: "document", document: createdDoc });
    expect(completeAttempts).toBe(2);
  });

  it("pauses in opening without aborting session creation, waits before uploading parts, and resumes", async () => {
    const file = makeFile(10);
    const storage = createFakeStorage();
    const target = { kind: "workspace" as const, workspaceId: "ws-1" };
    let createStarted!: () => void;
    const createInFlight = new Promise<void>((r) => {
      createStarted = r;
    });
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((r) => {
      releaseCreate = r;
    });
    let putCalls = 0;

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/upload-sessions")) {
        createStarted();
        return await new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
          void createGate.then(() => resolve(json(makeSessionBody("sess-open-pause", 1), 201)));
        });
      }
      if (method === "GET" && url === `${API}/api/v1/upload-sessions/sess-open-pause`) {
        return json({ ...makeSessionBody("sess-open-pause", 1), status: "open" });
      }
      if (method === "PUT" && url.includes("part-1")) {
        putCalls += 1;
        return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } });
      }
      if (method === "POST" && url.endsWith("/complete")) {
        return json({ document: createdDoc }, 200);
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const phases: string[] = [];
    vi.stubGlobal("fetch", fakeFetch);
    const upload = startChunkedUpload({
      file,
      filename: file.name,
      target,
      idempotencyKey: "idem-open-pause",
      storage,
      fetch: fakeFetch,
      onProgress: (p) => phases.push(p.phase),
    });

    await createInFlight;
    upload.pause();
    releaseCreate();
    for (let i = 0; i < 20; i += 1) await Promise.resolve();

    expect(phases.at(-1)).toBe("paused");
    expect(putCalls).toBe(0);
    expect(findResumableUpload(storage, uploadFileKey(file), target)?.session_id).toBe(
      "sess-open-pause",
    );

    upload.resume();
    const res = await upload.result;
    expect(res).toEqual({ kind: "document", document: createdDoc });
    expect(putCalls).toBe(1);
  });

  it("pauses during a session refresh without aborting GET, waits at the next boundary, and resumes", async () => {
    const file = makeFile(10);
    const storage = createFakeStorage();
    const target = { kind: "workspace" as const, workspaceId: "ws-1" };
    let refreshStarted!: () => void;
    const refreshInFlight = new Promise<void>((r) => {
      refreshStarted = r;
    });
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((r) => {
      releaseRefresh = r;
    });
    let getCalls = 0;
    let putCalls = 0;

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/upload-sessions")) {
        return json(
          makeSessionBody("sess-refresh-pause", 1, makePartUrls([1], 1, "2020-01-01T00:00:00Z")),
          201,
        );
      }
      if (method === "GET" && url === `${API}/api/v1/upload-sessions/sess-refresh-pause`) {
        getCalls += 1;
        if (getCalls === 1) {
          refreshStarted();
          return await new Promise<Response>((resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
            void refreshGate.then(() =>
              resolve(
                json({
                  ...makeSessionBody("sess-refresh-pause", 1, makePartUrls([1], 2)),
                  status: "open",
                }),
              ),
            );
          });
        }
        return json({
          ...makeSessionBody("sess-refresh-pause", 1, makePartUrls([1], 3)),
          status: "open",
        });
      }
      if (method === "PUT" && url.includes("part-1")) {
        putCalls += 1;
        return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } });
      }
      if (method === "POST" && url.endsWith("/complete")) {
        return json({ document: createdDoc }, 200);
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const phases: string[] = [];
    vi.stubGlobal("fetch", fakeFetch);
    const upload = startChunkedUpload({
      file,
      filename: file.name,
      target,
      idempotencyKey: "idem-refresh-pause",
      storage,
      fetch: fakeFetch,
      onProgress: (p) => phases.push(p.phase),
    });

    await refreshInFlight;
    upload.pause();
    releaseRefresh();
    await Promise.resolve();
    await Promise.resolve();

    expect(phases.at(-1)).toBe("paused");
    expect(putCalls).toBe(0);

    upload.resume();
    const res = await upload.result;
    expect(res).toEqual({ kind: "document", document: createdDoc });
    expect(putCalls).toBe(1);
    expect(getCalls).toBe(2);
  });

  it("does not abort an in-flight complete request when pause() is called during verifying", async () => {
    const file = makeFile(10);
    let completeStarted!: () => void;
    const completeInFlight = new Promise<void>((r) => {
      completeStarted = r;
    });
    let releaseComplete!: () => void;
    const completeGate = new Promise<void>((r) => {
      releaseComplete = r;
    });

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/upload-sessions")) {
        return json(makeSessionBody("sess-verify-pause", 1), 201);
      }
      if (method === "PUT" && url.includes("part-1")) {
        return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } });
      }
      if (method === "POST" && url.endsWith("/complete")) {
        completeStarted();
        return await new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
          void completeGate.then(() => resolve(json({ document: createdDoc }, 200)));
        });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const phases: string[] = [];
    vi.stubGlobal("fetch", fakeFetch);
    const upload = startChunkedUpload({
      file,
      filename: file.name,
      target: { kind: "workspace", workspaceId: "ws-1" },
      idempotencyKey: "idem-verify-pause",
      fetch: fakeFetch,
      onProgress: (p) => phases.push(p.phase),
    });

    await completeInFlight;
    upload.pause();
    releaseComplete();

    const res = await upload.result;
    expect(res).toEqual({ kind: "document", document: createdDoc });
    expect(phases.at(-1)).toBe("done");
    expect(phases).not.toContain("failed");
  });

  it("treats cancel DELETE as best-effort: swallows 409/network errors while keeping the resume record, and clears the record on 404/410", async () => {
    const file = makeFile(10);
    const storage = createFakeStorage();
    const target = { kind: "workspace" as const, workspaceId: "ws-1" };
    let deleteStatus = 409;
    let partStarted!: () => void;
    let partInFlight = new Promise<void>((r) => {
      partStarted = r;
    });

    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/upload-sessions")) {
        return json(makeSessionBody("sess-cancel-f6", 1), 201);
      }
      if (method === "PUT" && url.includes("part-1")) {
        partStarted();
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      if (method === "DELETE" && url === `${API}/api/v1/upload-sessions/sess-cancel-f6`) {
        if (deleteStatus === 409) {
          return json({ error: { code: "upload_session_busy", message: "busy" } }, 409);
        }
        return json({ error: { code: "not_found", message: "gone" } }, deleteStatus);
      }
      if (method === "GET" && url === `${API}/api/v1/upload-sessions/sess-cancel-f6`) {
        return json({ ...makeSessionBody("sess-cancel-f6", 1), status: "open" });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fakeFetch);
    const upload1 = startChunkedUpload({
      file,
      filename: file.name,
      target,
      idempotencyKey: "idem-cancel-f6",
      storage,
      fetch: fakeFetch,
    });

    await partInFlight;
    await expect(upload1.cancel()).resolves.toBeUndefined();
    expect(findResumableUpload(storage, uploadFileKey(file), target)?.session_id).toBe(
      "sess-cancel-f6",
    );

    // Second attempt resumes the kept session, and a 410 on cancel DELETE clears the record.
    deleteStatus = 410;
    partInFlight = new Promise<void>((r) => {
      partStarted = r;
    });
    const upload2 = startChunkedUpload({
      file,
      filename: file.name,
      target,
      idempotencyKey: "idem-cancel-f6",
      storage,
      fetch: fakeFetch,
    });
    await partInFlight;
    await expect(upload2.cancel()).resolves.toBeUndefined();
    expect(findResumableUpload(storage, uploadFileKey(file), target)).toBeNull();
  });
});

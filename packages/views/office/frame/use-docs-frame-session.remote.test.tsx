import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { DocsProtocolError, PROTOCOL_NS, PROTOCOL_VERSION, type Envelope } from "@uniwork/core/office/docs-frame-protocol";
import { requestMock } from "../../test/api-mock";
import { useDocsFrameSession, type DocsFrameSessionOptions } from "./use-docs-frame-session";

// G5-03w, host side: doc.remoteVersion, the api.open revision (OQ-P3), aiRun per frame, and the
// revoke/delete block. The realtime socket and the office_sync_feed flag are faked here; the
// transport (getDocument, the change feed, the version list) goes through requestMock.

const ws = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const reconnects = new Set<() => void>();
  const client = {
    on: (event: string, handler: (payload: unknown) => void) => {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
      return () => { set.delete(handler); };
    },
    onReconnect: (callback: () => void) => { reconnects.add(callback); return () => { reconnects.delete(callback); }; },
  };
  return {
    client, handlers, reconnects,
    emit: (event: string, payload: unknown) => { for (const h of handlers.get(event) ?? []) h(payload); },
    reconnect: () => { for (const cb of reconnects) cb(); },
  };
});
const flag = vi.hoisted(() => ({ syncFeed: true }));

vi.mock("@uniwork/core/realtime", () => ({ useOptionalWS: () => ({ client: ws.client }) }));
vi.mock("@uniwork/core/feature-flags", () => ({ useFlag: (key: string, fallback: boolean) => (key === "office_sync_feed" ? flag.syncFeed : fallback) }));

const MINT_PATH = "/api/v1/documents/doc-1/office/frame-token";
const DOC_PATH = "/api/v1/documents/doc-1";
const VERSIONS_PATH = "/api/v1/documents/doc-1/versions";
const FEED_PATH = "/api/v1/workspaces/ws-1/documents/changes";
const minted = {
  token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: true, module: "docs",
};
const fileOf = (revision: string, versionId: string) => ({ fileId: "doc-1", name: "Plan.docx", versionId, etag: revision });
const headDoc = (revision: string, versionId: string) => ({
  document: {
    id: "doc-1", workspace_id: "ws-1", kind: "file", title: "Plan", revision, updated_at: "2026-10-13T08:00:00Z",
    file: { file_id: "f-1", version_id: versionId, version: 1, filename: "Plan.docx", mime_type: "application/octet-stream", size_bytes: 1, checksum_sha256: "x" },
  },
});

interface Server {
  head: { revision: string; versionId: string };
  headError?: ApiError;
  versions: string[];
  /** A feed page, or a function of the request path (to answer each page, or reject). */
  feed: unknown;
}

function setup() {
  const server: Server = { head: { revision: "9", versionId: "v1" }, versions: ["v1"], feed: null };
  requestMock.mockImplementation((path: string) => {
    if (path === MINT_PATH) return Promise.resolve(minted);
    if (path === DOC_PATH) return server.headError ? Promise.reject(server.headError) : Promise.resolve(headDoc(server.head.revision, server.head.versionId));
    if (path.startsWith(VERSIONS_PATH)) return Promise.resolve({ versions: server.versions.map((id, i) => ({ id, document_id: "doc-1", version: i + 1 })) });
    if (path.startsWith(FEED_PATH)) return typeof server.feed === "function" ? Promise.resolve().then(() => (server.feed as (p: string) => unknown)(path)) : Promise.resolve(server.feed);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const win = iframe.contentWindow!;
  const received: Envelope[] = [];
  let seq = 0;
  const post = (data: unknown) => act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin: window.location.origin, source: win }));
  });
  const envelope = (kind: Envelope["kind"], type: string, payload: unknown, id = `f${(seq += 1)}`): Envelope =>
    ({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id, kind, type, payload });
  vi.spyOn(win, "postMessage").mockImplementation((message: unknown) => {
    const m = message as Envelope;
    received.push(m);
    if (m.kind === "request" && m.type === "init") {
      queueMicrotask(() => { void post(envelope("response", "init", { protocolVersion: 1, capabilities: {} }, m.id)); });
    }
  });
  const open = vi.fn(async () => ({ file: fileOf(server.head.revision, server.head.versionId), source: { kind: "bytes", data: new ArrayBuffer(4) } }));
  const save = vi.fn(async (_payload?: { etag?: string }, _context?: unknown) => {
    server.head = { revision: String(BigInt(server.head.revision) + 1n), versionId: `own-${server.head.revision}` };
    return { ok: true, file: fileOf(server.head.revision, server.head.versionId), versionId: server.head.versionId };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const options: DocsFrameSessionOptions = {
    iframeRef: { current: iframe }, frameOrigin: window.location.origin, wsId: "ws-1", documentId: "doc-1",
    readonly: false, locale: "vi", theme: "light", onError: vi.fn(),
    api: { open, save, recents: vi.fn() } as unknown as DocsFrameApi,
  };
  const hook = renderHook(() => useDocsFrameSession(options), { wrapper });
  const events = (type: string) => received.filter((m) => m.kind === "event" && m.type === type).map((m) => m.payload);
  const request = (type: string, payload: unknown) => { const e = envelope("request", type, payload); void post(e); return e.id; };
  const answer = async (id: string) => {
    await waitFor(() => expect(received.some((m) => m.kind === "response" && m.id === id)).toBe(true));
    return received.find((m) => m.kind === "response" && m.id === id)!;
  };
  return {
    server, hook, open, save, iframe, events, request, answer, received,
    event: (type: string, payload: unknown) => post(envelope("event", type, payload)),
    async boot() {
      await post(envelope("event", "ready", { protocolVersion: 1, capabilities: {}, module: "docs", instanceId: "i-1" }));
      await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    },
    /** The frame opens the document the way it does on start (`api.open` without a version). */
    async opened() {
      return answer(request("api.open", { fileId: "doc-1" }));
    },
    /** A new head lands on the server and its realtime frame reaches the page. */
    async commitElsewhere(revision: string, versionId: string) {
      server.head = { revision, versionId };
      server.versions.push(versionId);
      await act(async () => { ws.emit("document.version_created", { document_id: "doc-1", version_id: versionId, workspace_id: "ws-1" }); });
    },
  };
}

type Frame = ReturnType<typeof setup>;
async function openedFrame(): Promise<Frame> {
  const frame = setup();
  await frame.boot();
  await frame.opened();
  return frame;
}
/** Lets the head reads a frame triggered settle. */
const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => { flag.syncFeed = true; });
afterEach(() => {
  vi.restoreAllMocks(); requestMock.mockReset(); document.body.innerHTML = "";
  ws.handlers.clear(); ws.reconnects.clear();
});

describe("useDocsFrameSession: api.open carries the real revision (X-02, OQ-P3)", () => {
  it("fills file.revision from the same read as the bytes, without versionChanged on a plain open", async () => {
    const frame = setup();
    await frame.boot();
    const reply = await frame.opened();
    expect(reply.payload).toMatchObject({ file: { revision: "9", versionId: "v1", etag: "9" } });
    expect(reply.payload).not.toHaveProperty("versionChanged");
  });

  it("a commit between doc.remoteVersion and api.open answers the head with its own revision and versionChanged", async () => {
    const frame = await openedFrame();
    await frame.commitElsewhere("10", "v2");
    await waitFor(() => expect(frame.events("doc.remoteVersion")).toHaveLength(1));
    // Another commit lands before the frame asks for v2.
    frame.server.head = { revision: "11", versionId: "v3" };
    const reply = await frame.answer(frame.request("api.open", { fileId: "doc-1", versionId: "v2" }));
    expect(reply.error).toBeUndefined();
    expect(reply.payload).toMatchObject({ versionChanged: true, file: { revision: "11", versionId: "v3" } });
    // v2 was announced by this host: no version lookup was needed.
    expect(requestMock.mock.calls.some(([path]) => String(path).startsWith(VERSIONS_PATH))).toBe(false);
  });

  it("the Save after a head reload is based on the reply's revision; a stale base meets 409 (OQ-P3)", async () => {
    const frame = await openedFrame();
    // The server checks the Save base like the real one: the etag must be the head revision.
    frame.save.mockImplementation(async (payload?: { etag?: string }) => {
      if (payload?.etag !== frame.server.head.revision) {
        throw new DocsProtocolError({ code: "conflict", message: "document_version_conflict (HTTP 409)", status: 409, details: { apiCode: "document_version_conflict" } });
      }
      frame.server.head = { revision: String(BigInt(frame.server.head.revision) + 1n), versionId: `own-${frame.server.head.revision}` };
      return { ok: true, file: fileOf(frame.server.head.revision, frame.server.head.versionId), versionId: frame.server.head.versionId };
    });
    await frame.commitElsewhere("10", "v2");
    await waitFor(() => expect(frame.events("doc.remoteVersion")).toHaveLength(1));
    const reload = await frame.answer(frame.request("api.open", { fileId: "doc-1", versionId: "v2" }));
    const base = (reload.payload as { file: { revision: string; etag: string } }).file;
    expect(base).toMatchObject({ revision: "10", etag: "10" });
    const stale = await frame.answer(frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(2), etag: "9" }));
    expect(stale.error).toMatchObject({ code: "conflict", status: 409 });
    const saved = await frame.answer(frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(2), etag: base.revision }));
    expect(saved.error).toBeUndefined();
    expect(frame.save).toHaveBeenLastCalledWith(expect.objectContaining({ etag: "10" }), expect.anything());
  });

  it("asking for the head itself answers without versionChanged", async () => {
    const frame = await openedFrame();
    await frame.commitElsewhere("10", "v2");
    const reply = await frame.answer(frame.request("api.open", { fileId: "doc-1", versionId: "v2" }));
    expect(reply.payload).toMatchObject({ file: { revision: "10", versionId: "v2" } });
    expect(reply.payload).not.toHaveProperty("versionChanged");
  });

  it("refuses a version this document never had with not_found, before any bytes move", async () => {
    const frame = await openedFrame();
    frame.open.mockClear();
    const reply = await frame.answer(frame.request("api.open", { fileId: "doc-1", versionId: "of-another-doc" }));
    expect(reply.error?.code).toBe("not_found");
    expect(frame.open).not.toHaveBeenCalled();
  });

  it("accepts an older version of this document it never announced, after reading the version list", async () => {
    const frame = await openedFrame();
    frame.server.versions.unshift("v0");
    const reply = await frame.answer(frame.request("api.open", { fileId: "doc-1", versionId: "v0" }));
    expect(reply.payload).toMatchObject({ versionChanged: true, file: { revision: "9", versionId: "v1" } });
  });
});

describe("useDocsFrameSession: doc.remoteVersion", () => {
  it("announces a newer head, comparing revisions as integers (\"10\" after \"9\")", async () => {
    const frame = await openedFrame();
    await frame.commitElsewhere("10", "v2");
    await waitFor(() => expect(frame.events("doc.remoteVersion")).toEqual([
      { document_id: "doc-1", revision: "10", version_id: "v2", saved_at: "2026-10-13T08:00:00Z" },
    ]));
  });

  it("stays silent for a revision at or below the open one, and announces a head once", async () => {
    const frame = await openedFrame();
    await frame.commitElsewhere("9", "v-same-rev");
    await frame.commitElsewhere("8", "v-older");
    await flush();
    expect(frame.events("doc.remoteVersion")).toHaveLength(0);
    await frame.commitElsewhere("10", "v2");
    await act(async () => { ws.emit("document.updated", { document_id: "doc-1", workspace_id: "ws-1" }); });
    await flush();
    expect(frame.events("doc.remoteVersion")).toHaveLength(1);
  });

  it("never echoes this session's own commit, even when its frame arrives before the save answer", async () => {
    const frame = await openedFrame();
    let release!: () => void;
    frame.save.mockImplementationOnce(async () => {
      frame.server.head = { revision: "10", versionId: "own-10" };
      // The outbox is faster than the answer: the realtime frame lands while the save is open.
      ws.emit("document.version_created", { document_id: "doc-1", version_id: "own-10", workspace_id: "ws-1" });
      await new Promise<void>((r) => { release = r; });
      return { ok: true, file: fileOf("10", "own-10"), versionId: "own-10" };
    });
    const id = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(2), etag: "9" });
    await flush();
    await act(async () => { release(); });
    await frame.answer(id);
    await act(async () => { ws.emit("document.version_created", { document_id: "doc-1", version_id: "own-10", workspace_id: "ws-1" }); });
    await flush();
    expect(frame.events("doc.remoteVersion")).toHaveLength(0);
    // A real new version after it is still announced.
    await frame.commitElsewhere("11", "v-other");
    await waitFor(() => expect(frame.events("doc.remoteVersion")).toHaveLength(1));
  });

  it("a head read while the first api.open is in flight reaches the frame after that open answer (R3-02)", async () => {
    const frame = setup();
    await frame.boot();
    // The open read answered R9 on the server; R10 lands elsewhere before that answer reaches the host.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    frame.open.mockImplementationOnce(async () => { await gate; return { file: fileOf("9", "v1"), source: { kind: "bytes", data: new ArrayBuffer(4) } }; });
    const id = frame.request("api.open", { fileId: "doc-1" });
    await frame.commitElsewhere("10", "v2");
    await flush();
    expect(frame.events("doc.remoteVersion")).toHaveLength(0);
    release();
    await frame.answer(id);
    await waitFor(() => expect(frame.events("doc.remoteVersion")).toEqual([{ document_id: "doc-1", revision: "10", version_id: "v2", saved_at: "2026-10-13T08:00:00Z" }]));
    const at = (pick: (m: Envelope) => boolean) => frame.received.findIndex(pick);
    expect(at((m) => m.kind === "response" && m.id === id)).toBeLessThan(at((m) => m.kind === "event" && m.type === "doc.remoteVersion"));
  });

  it("ignores frames of another document", async () => {
    const frame = await openedFrame();
    frame.server.head = { revision: "10", versionId: "v2" };
    await act(async () => { ws.emit("document.version_created", { document_id: "doc-2", version_id: "x", workspace_id: "ws-1" }); });
    await flush();
    expect(frame.events("doc.remoteVersion")).toHaveLength(0);
  });

  it("a metadata-only bump (same version, higher revision) sends nothing and the Save keeps its base (OQ-P1 a1)", async () => {
    const frame = await openedFrame();
    frame.server.head = { revision: "12", versionId: "v1" };
    await act(async () => { ws.emit("document.moved", { document_id: "doc-1", workspace_id: "ws-1" }); });
    await flush();
    expect(frame.events("doc.remoteVersion")).toHaveLength(0);
    const reply = await frame.answer(frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(2), etag: "9" }));
    expect(reply.error).toBeUndefined();
    expect(frame.save).toHaveBeenCalledWith(expect.objectContaining({ etag: "9" }), expect.anything());
  });

  it("with office_sync_feed off sends nothing and reads no feed (a reconnect reads the head once, for a block only); a stale Save still meets the conflict", async () => {
    flag.syncFeed = false;
    const frame = await openedFrame();
    await frame.commitElsewhere("10", "v2");
    await act(async () => { ws.reconnect(); });
    await flush();
    expect(frame.events("doc.remoteVersion")).toHaveLength(0);
    // The reconnect asks the head once for a block verdict (R3-03); no feed, no new-version news.
    expect(requestMock.mock.calls.filter(([path]) => path === DOC_PATH)).toHaveLength(1);
    expect(requestMock.mock.calls.some(([path]) => String(path).startsWith(FEED_PATH))).toBe(false);
    frame.save.mockRejectedValueOnce(new DocsProtocolError({ code: "conflict", message: "document_version_conflict (HTTP 409)", status: 409, details: { apiCode: "document_version_conflict" } }));
    const reply = await frame.answer(frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(2), etag: "9" }));
    expect(reply.error).toMatchObject({ code: "conflict", status: 409 });
    expect(frame.hook.result.current.blocked).toBeNull();
  });

  it("after a realtime reconnect, catches up through the change feed", async () => {
    const frame = await openedFrame();
    // The socket was down: the server moved on and no frame arrived.
    frame.server.head = { revision: "10", versionId: "v2" };
    frame.server.feed = {
      phase: "snapshot", has_more: false, next_cursor: "c-1", expires_at: "2026-10-14T00:00:00Z",
      changes: [{ document_id: "doc-9", kind: "file", revision: "3", current_version: 1, version_id: "z" }, { document_id: "doc-1", kind: "file", revision: "10", current_version: 2, version_id: "v2" }],
    };
    await act(async () => { ws.reconnect(); });
    await waitFor(() => expect(frame.events("doc.remoteVersion")).toEqual([expect.objectContaining({ revision: "10", version_id: "v2" })]));
    expect(requestMock.mock.calls.some(([path]) => String(path).startsWith(FEED_PATH))).toBe(true);
  });
});

describe("useDocsFrameSession: aiRun per frame", () => {
  it("running, then the frame unloads without idle: the host reads idle and the next version still reaches the clean frame", async () => {
    const frame = await openedFrame();
    await frame.event("aiRun", { state: "running", run_id: "r1" });
    expect(frame.hook.result.current.aiRunning).toBe(true);
    act(() => { frame.iframe.contentWindow!.dispatchEvent(new Event("pagehide")); });
    expect(frame.hook.result.current.aiRunning).toBe(false);
    // The reloaded frame shakes hands again and opens the head: it is clean, with no turn running.
    await frame.event("ready", { protocolVersion: 1, capabilities: {}, module: "docs", instanceId: "i-2" });
    await frame.opened();
    expect(frame.hook.result.current.aiRunning).toBe(false);
    await frame.commitElsewhere("10", "v2");
    await waitFor(() => expect(frame.events("doc.remoteVersion")).toHaveLength(1));
  });

  it("running, then the endpoint is lost (retry): idle", async () => {
    const frame = await openedFrame();
    await frame.event("aiRun", { state: "running" });
    expect(frame.hook.result.current.aiRunning).toBe(true);
    act(() => { frame.hook.result.current.retry(); });
    expect(frame.hook.result.current.aiRunning).toBe(false);
  });

  it("idle ends the turn", async () => {
    const frame = await openedFrame();
    await frame.event("aiRun", { state: "running", run_id: "r1" });
    await frame.event("aiRun", { state: "idle", run_id: "r1" });
    expect(frame.hook.result.current.aiRunning).toBe(false);
  });
});

describe("useDocsFrameSession: revoke and delete block the frame", () => {
  it("a deleted document refuses every Save with 410 and announces nothing more", async () => {
    const frame = await openedFrame();
    await act(async () => { ws.emit("document.deleted", { document_id: "doc-1", workspace_id: "ws-1" }); });
    expect(frame.hook.result.current.blocked).toBe("document_deleted");
    const reply = await frame.answer(frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(2), etag: "9" }));
    expect(reply.error).toMatchObject({ code: "not_found", status: 410, details: { apiCode: "document_deleted" } });
    expect(frame.save).not.toHaveBeenCalled();
    const copy = await frame.answer(frame.request("api.saveAs", { name: "Copy.docx", data: new ArrayBuffer(2) }));
    expect(copy.error?.status).toBe(410);
    await frame.commitElsewhere("10", "v2");
    await flush();
    expect(frame.events("doc.remoteVersion")).toHaveLength(0);
  });

  it("a revoked share blocks when the head read answers 403", async () => {
    const frame = await openedFrame();
    frame.server.headError = new ApiError("forbidden", "forbidden", 403);
    await act(async () => { ws.emit("document.share_revoked", { document_id: "doc-1", workspace_id: "ws-1", share_id: "s-1" }); });
    await waitFor(() => expect(frame.hook.result.current.blocked).toBe("permission_revoked"));
    const reply = await frame.answer(frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(2), etag: "9" }));
    expect(reply.error).toMatchObject({ code: "forbidden", status: 403, details: { apiCode: "permission_revoked" } });
    expect(frame.save).not.toHaveBeenCalled();
  });

  it("a head read refused for an organization reason tells the frame, but refuses no Save here (the server does)", async () => {
    for (const code of ["organization_suspended", "member_deactivated", "document_archived"]) {
      const frame = await openedFrame();
      frame.server.headError = new ApiError(code, code, 403);
      await act(async () => { ws.emit("document.share_revoked", { document_id: "doc-1", workspace_id: "ws-1", share_id: "s-1" }); });
      await waitFor(() => expect(frame.events("doc.blocked")).toEqual([{ document_id: "doc-1", reason: code }]));
      expect(frame.hook.result.current.blocked).toBeNull();
      const reply = await frame.answer(frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(2), etag: "9" }));
      expect(reply.error).toBeUndefined();
      expect(frame.save).toHaveBeenCalledTimes(1);
      frame.hook.unmount();
      ws.handlers.clear(); ws.reconnects.clear(); document.body.innerHTML = "";
    }
  });

  it("a Save the server refuses with 410 blocks the next one; a suspended organization does not", async () => {
    const frame = await openedFrame();
    frame.save.mockRejectedValueOnce(new DocsProtocolError({ code: "forbidden", message: "organization_suspended (HTTP 403)", status: 403, details: { apiCode: "organization_suspended" } }));
    await frame.answer(frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(2), etag: "9" }));
    expect(frame.hook.result.current.blocked).toBeNull();
    frame.save.mockRejectedValueOnce(new DocsProtocolError({ code: "internal", message: "gone (HTTP 410)", status: 410, details: { apiCode: "document_gone" } }));
    await frame.answer(frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(2), etag: "9" }));
    await waitFor(() => expect(frame.hook.result.current.blocked).toBe("document_deleted"));
    frame.save.mockClear();
    const reply = await frame.answer(frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(2), etag: "9" }));
    expect(reply.error?.status).toBe(410);
    expect(frame.save).not.toHaveBeenCalled();
  });

  it("a block outlives a retry of the same document", async () => {
    const frame = await openedFrame();
    await act(async () => { ws.emit("document.deleted", { document_id: "doc-1", workspace_id: "ws-1" }); });
    act(() => { frame.hook.result.current.retry(); });
    await frame.boot();
    const reply = await frame.answer(frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(2), etag: "9" }));
    expect(reply.error?.status).toBe(410);
    expect(frame.hook.result.current.blocked).toBe("document_deleted");
  });
});

describe("useDocsFrameSession: change feed catch-up after a reconnect (G5-02)", () => {
  const page = (changes: Array<{ document_id: string; revision: string; version_id: string }>, cursor: string, hasMore = false) => ({
    phase: "snapshot", has_more: hasMore, next_cursor: cursor, expires_at: "2026-10-14T00:00:00Z",
    changes: changes.map((c) => ({ ...c, kind: "file", current_version: 1 })),
  });
  const feedCalls = () => requestMock.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith(FEED_PATH));
  const headReads = () => requestMock.mock.calls.filter(([path]) => path === DOC_PATH).length;
  const reconnect = async () => { await act(async () => { ws.reconnect(); }); await flush(); };

  it("a page without this document reads no head", async () => {
    const frame = await openedFrame();
    frame.server.feed = page([{ document_id: "doc-9", revision: "3", version_id: "z" }], "c-1");
    await reconnect();
    expect(feedCalls()).toHaveLength(1);
    expect(headReads()).toBe(0);
    expect(frame.events("doc.remoteVersion")).toHaveLength(0);
  });

  it("follows has_more with each next cursor, then reads the head once", async () => {
    const frame = await openedFrame();
    frame.server.head = { revision: "10", versionId: "v2" };
    frame.server.feed = (path: string) => path.includes("cursor=c-1")
      ? page([{ document_id: "doc-1", revision: "10", version_id: "v2" }], "c-2")
      : page([{ document_id: "doc-9", revision: "3", version_id: "z" }], "c-1", true);
    await reconnect();
    expect(feedCalls()).toEqual([FEED_PATH, `${FEED_PATH}?cursor=c-1`]);
    expect(headReads()).toBe(1);
    expect(frame.events("doc.remoteVersion")).toEqual([expect.objectContaining({ revision: "10" })]);
  });

  it("the second reconnect continues from the cursor the first one ended on", async () => {
    const frame = await openedFrame();
    frame.server.feed = page([], "c-1");
    await reconnect();
    frame.server.feed = page([], "c-2");
    await reconnect();
    expect(feedCalls()).toEqual([FEED_PATH, `${FEED_PATH}?cursor=c-1`]);
  });

  it("a cursor the server refuses restarts once from a snapshot; a second refusal waits for the next reconnect", async () => {
    const frame = await openedFrame();
    frame.server.feed = page([], "c-1");
    await reconnect();
    requestMock.mockClear();
    frame.server.feed = () => { throw new ApiError("change cursor expired", "change_cursor_expired", 410); };
    await reconnect();
    // the expired cursor, then one cold start that is refused again: stop
    expect(feedCalls()).toEqual([`${FEED_PATH}?cursor=c-1`, FEED_PATH]);
    expect(headReads()).toBe(0);
    requestMock.mockClear();
    frame.server.head = { revision: "10", versionId: "v2" };
    let calls = 0;
    frame.server.feed = () => {
      calls += 1;
      if (calls === 1) throw new ApiError("invalid change cursor", "change_cursor_invalid", 400);
      return page([{ document_id: "doc-1", revision: "10", version_id: "v2" }], "c-9");
    };
    await reconnect();
    // the snapshot left no cursor, so the next catch-up starts cold and finds the document
    expect(feedCalls()).toEqual([FEED_PATH, FEED_PATH]);
    expect(frame.events("doc.remoteVersion")).toEqual([expect.objectContaining({ revision: "10" })]);
  });

  it("a malformed page or a failed request stops the catch-up without a head read", async () => {
    const frame = await openedFrame();
    frame.server.feed = { changes: "not a page" };
    await reconnect();
    frame.server.feed = () => { throw new ApiError("not implemented", "unsupported_operation", 501); };
    await reconnect();
    expect(feedCalls()).toHaveLength(2);
    expect(headReads()).toBe(0);
    expect(frame.hook.result.current.blocked).toBeNull();
  });
});

describe("useDocsFrameSession: doc.blocked reaches the frame at once (G5-03w)", () => {
  const share = () => act(async () => { ws.emit("document.share_revoked", { document_id: "doc-1", workspace_id: "ws-1", share_id: "s-1" }); });

  it("a realtime revoke: doc.blocked permission_revoked before any Save", async () => {
    const frame = await openedFrame();
    frame.server.headError = new ApiError("forbidden", "forbidden", 403);
    await share();
    await waitFor(() => expect(frame.events("doc.blocked")).toEqual([{ document_id: "doc-1", reason: "permission_revoked" }]));
    expect(frame.save).not.toHaveBeenCalled();
    expect(requestMock.mock.calls.some(([path]) => path === DOC_PATH)).toBe(true);
  });

  it("a realtime delete: doc.blocked document_deleted at once, once per reason", async () => {
    const frame = await openedFrame();
    await act(async () => { ws.emit("document.deleted", { document_id: "doc-1", workspace_id: "ws-1" }); });
    expect(frame.events("doc.blocked")).toEqual([{ document_id: "doc-1", reason: "document_deleted" }]);
    await act(async () => { ws.emit("document.deleted", { document_id: "doc-1", workspace_id: "ws-1" }); });
    frame.server.headError = new ApiError("forbidden", "forbidden", 403);
    await share();
    await flush();
    expect(frame.events("doc.blocked")).toHaveLength(1);
  });

  it("another document's delete or revoke sends nothing", async () => {
    const frame = await openedFrame();
    await act(async () => {
      ws.emit("document.deleted", { document_id: "doc-2", workspace_id: "ws-1" });
      ws.emit("document.share_revoked", { document_id: "doc-2", workspace_id: "ws-1", share_id: "s-2" });
    });
    await flush();
    expect(frame.events("doc.blocked")).toHaveLength(0);
    expect(frame.hook.result.current.blocked).toBeNull();
  });

  it("after a reconnect the feed lists the document and its head is gone: doc.blocked document_deleted", async () => {
    const frame = await openedFrame();
    frame.server.headError = new ApiError("not found", "not_found", 404);
    frame.server.feed = {
      phase: "snapshot", has_more: false, next_cursor: "c-1", expires_at: "2026-10-14T00:00:00Z",
      changes: [{ document_id: "doc-1", kind: "file", revision: "10", current_version: 2, version_id: "v2" }],
    };
    await act(async () => { ws.reconnect(); });
    await waitFor(() => expect(frame.events("doc.blocked")).toEqual([{ document_id: "doc-1", reason: "document_deleted" }]));
    expect(frame.hook.result.current.blocked).toBe("document_deleted");
  });

  it("after a reconnect the feed refuses this viewer: the head read decides (403 -> revoked)", async () => {
    const frame = await openedFrame();
    frame.server.headError = new ApiError("forbidden", "forbidden", 403);
    frame.server.feed = () => { throw new ApiError("forbidden", "forbidden", 403); };
    await act(async () => { ws.reconnect(); });
    await waitFor(() => expect(frame.events("doc.blocked")).toEqual([{ document_id: "doc-1", reason: "permission_revoked" }]));
  });

  it("with office_sync_feed off the realtime delete and revoke still block (the flag turns off S6 news only)", async () => {
    flag.syncFeed = false;
    const frame = await openedFrame();
    frame.server.headError = new ApiError("forbidden", "forbidden", 403);
    await share();
    await waitFor(() => expect(frame.events("doc.blocked")).toEqual([{ document_id: "doc-1", reason: "permission_revoked" }]));
    await act(async () => { ws.emit("document.deleted", { document_id: "doc-1", workspace_id: "ws-1" }); });
    expect(frame.events("doc.blocked").map((p) => (p as { reason: string }).reason)).toEqual(["permission_revoked", "document_deleted"]);
    expect(frame.events("doc.remoteVersion")).toHaveLength(0);
  });

  it("with office_sync_feed off a reconnect still reads the head once: a delete while offline blocks (R3-03)", async () => {
    flag.syncFeed = false;
    const frame = await openedFrame();
    frame.server.headError = new ApiError("not found", "not_found", 404);
    await act(async () => { ws.reconnect(); });
    await waitFor(() => expect(frame.events("doc.blocked")).toEqual([{ document_id: "doc-1", reason: "document_deleted" }]));
    expect(frame.hook.result.current.blocked).toBe("document_deleted");
    expect(requestMock.mock.calls.some(([path]) => String(path).startsWith(FEED_PATH))).toBe(false);
  });

  it("a block heard before the frame (re)connects reaches it on the handshake", async () => {
    const frame = await openedFrame();
    await act(async () => { ws.emit("document.deleted", { document_id: "doc-1", workspace_id: "ws-1" }); });
    act(() => { frame.hook.result.current.retry(); });
    await frame.boot();
    await waitFor(() => expect(frame.events("doc.blocked")).toHaveLength(2));
    expect(frame.events("doc.blocked").at(-1)).toEqual({ document_id: "doc-1", reason: "document_deleted" });
  });
});

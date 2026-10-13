import { afterEach, describe, expect, it, vi } from "vitest";
import { Endpoint, type RejectInfo } from "./docs-frame-endpoint";
import { createDocsFrameHost, type DocsFrameHostOptions } from "./docs-frame-host";
import {
  CAPABILITY_KEYS, DocsProtocolError, HOST_EVENT_TYPES, PROTOCOL_NS, PROTOCOL_VERSION, isDecimalRevision, openReplyRevision, parseEnvelope,
  type ApiOpenPayload, type Envelope,
} from "./docs-frame-protocol";

// The fork tests the vendored endpoint/host in depth (web/docs/protocol/test);
// these pin the behaviour the UniWork host relies on, through the vendored copy.

const ORIGIN = "http://app.test";

function harness(overrides: Partial<DocsFrameHostOptions> = {}) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const self = {
    addEventListener: (_: "message", listener: (event: MessageEvent) => void) => { listeners.add(listener); },
    removeEventListener: (_: "message", listener: (event: MessageEvent) => void) => { listeners.delete(listener); },
  };
  const sent: Envelope[] = [];
  const frame = { postMessage: vi.fn((message: Envelope, origin: string) => { expect(origin).toBe(ORIGIN); sent.push(message); }) };
  const getInit = vi.fn(async () => ({
    token: "tok", tokenExpiresAt: 1, documentId: "doc-1", workspaceId: "ws-1", apiBase: "http://api.test/api/v1",
    apiMode: "host-proxy" as const, locale: "vi", theme: "light" as const, capabilities: { save: true },
  }));
  const host = createDocsFrameHost({ self, frame: () => frame, allowedOrigins: [ORIGIN], getInit, refreshToken: async () => ({ token: "tok-2", tokenExpiresAt: 2 }), timeoutMs: 500, ...overrides });
  let seq = 0;
  const deliver = (kind: Envelope["kind"], type: string, payload: unknown, { id = `f${(seq += 1)}`, origin = ORIGIN, source = frame as unknown } = {}) => {
    for (const listener of [...listeners]) listener({ data: { ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id, kind, type, payload }, origin, source } as MessageEvent);
    return id;
  };
  const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
  const handshake = async () => {
    deliver("event", "ready", { protocolVersion: PROTOCOL_VERSION, capabilities: {} });
    await flush();
    const init = sent.find((m) => m.kind === "request" && m.type === "init")!;
    deliver("response", "init", { protocolVersion: PROTOCOL_VERSION, capabilities: {} }, { id: init.id });
    await flush();
    return init;
  };
  return { host, deliver, sent, getInit, handshake, flush };
}

afterEach(() => { vi.useRealTimers(); });

describe("vendored docs frame host", () => {
  it("answers ready with init carrying the token, ignoring other origins and windows", async () => {
    const { host, deliver, getInit, handshake, flush } = harness();
    deliver("event", "ready", { protocolVersion: PROTOCOL_VERSION, capabilities: {} }, { origin: "http://evil.test" });
    deliver("event", "ready", { protocolVersion: PROTOCOL_VERSION, capabilities: {} }, { source: {} });
    await flush();
    expect(getInit).not.toHaveBeenCalled();
    const init = await handshake();
    expect(init.payload).toMatchObject({ protocolVersion: PROTOCOL_VERSION, token: "tok", documentId: "doc-1" });
    expect(host.isReady).toBe(true);
  });

  it("proxies api requests to the supplied handlers and answers missing ones unsupported", async () => {
    const open = vi.fn(async () => ({ file: { fileId: "doc-1", name: "a.docx" }, source: { kind: "url" as const, url: "/x" } }));
    const { deliver, sent, handshake, flush } = harness({ api: { "api.open": open } });
    await handshake();
    const openId = deliver("request", "api.open", { fileId: "doc-1" });
    const exportId = deliver("request", "api.export", { format: "pdf" });
    await flush();
    expect(sent.find((m) => m.id === openId)?.payload).toMatchObject({ file: { fileId: "doc-1" } });
    expect(sent.find((m) => m.id === exportId)?.error?.code).toBe("unsupported");
  });

  it("refuses api requests before the handshake started", async () => {
    const { deliver, sent, flush } = harness({ api: { "api.recents": async () => ({ files: [] }) } });
    const id = deliver("request", "api.recents", {});
    await flush();
    expect(sent.find((m) => m.id === id)?.error?.code).toBe("not_ready");
  });

  it("answers token.refresh, and pushes a rotated token only after the handshake", async () => {
    const { host, deliver, sent, handshake, flush } = harness();
    host.pushToken({ token: "early", tokenExpiresAt: 3 });
    expect(sent).toHaveLength(0);
    await handshake();
    const id = deliver("request", "token.refresh", { reason: "expiring" });
    await flush();
    expect(sent.find((m) => m.id === id)?.payload).toEqual({ token: "tok-2", tokenExpiresAt: 2 });
    host.pushToken({ token: "tok-3", tokenExpiresAt: 3 });
    expect(sent.at(-1)).toMatchObject({ kind: "event", type: "token.update", payload: { token: "tok-3" } });
  });

  it("reports a frame on another protocol version as a handshake error", async () => {
    const onHandshakeError = vi.fn();
    const { deliver, getInit, flush } = harness({ onHandshakeError });
    deliver("event", "ready", { protocolVersion: PROTOCOL_VERSION + 1, capabilities: {} });
    await flush();
    expect(getInit).not.toHaveBeenCalled();
    expect(onHandshakeError).toHaveBeenCalledWith(expect.objectContaining({ code: "version_mismatch" }));
  });
});

const REMOTE = { document_id: "doc-1", revision: "6", version_id: "v2", saved_at: "2026-10-12T10:00:00Z" };
const env = (kind: Envelope["kind"], type: string, payload: unknown) =>
  parseEnvelope({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: "x1", kind, type, payload });

describe("X-02 protocol shape (vendored)", () => {
  it("keeps version 1 and validates the new messages", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(CAPABILITY_KEYS).toEqual(expect.arrayContaining(["download", "uniworkAi"]));
    expect(env("event", "doc.remoteVersion", REMOTE).ok).toBe(true);
    expect(env("event", "doc.remoteVersion", { ...REMOTE, revision: "abc" }).ok).toBe(false);
    expect(env("request", "api.open", { fileId: "doc-1", versionId: "v2" }).ok).toBe(true);
    expect(env("request", "api.download", { data: new ArrayBuffer(1) }).ok).toBe(true);
    expect(env("request", "api.download", { data: "x" }).ok).toBe(false);
    expect(env("event", "aiRun", { state: "running", run_id: "r1" }).ok).toBe(true);
    expect(env("event", "aiRun", { state: "done" }).ok).toBe(false);
    const file = { fileId: "doc-1", name: "a.docx" };
    const source = { kind: "url", url: "/x" };
    expect(env("response", "api.open", { file: { ...file, revision: "7" }, source, versionChanged: true }).ok).toBe(true);
    expect(env("response", "api.open", { file, source, versionChanged: true }).ok).toBe(false);
    expect(env("response", "api.open", { file: { ...file, revision: "07" }, source }).ok).toBe(false);
    expect(isDecimalRevision("18446744073709551615")).toBe(true);
    expect(openReplyRevision({ file })).toBeNull();
  });

  it("new frame -> new host: aiRun reaches the listener; api.download without a handler is unsupported", async () => {
    const { host, deliver, sent, handshake, flush } = harness();
    const seen: unknown[] = [];
    host.on("aiRun", (p) => seen.push(p));
    await handshake();
    deliver("event", "aiRun", { state: "running", run_id: "r1" });
    deliver("event", "aiRun", { state: "idle", run_id: "r1" });
    const id = deliver("request", "api.download", { data: new ArrayBuffer(2) });
    await flush();
    expect(seen).toEqual([{ state: "running", run_id: "r1" }, { state: "idle", run_id: "r1" }]);
    expect(sent.find((m) => m.id === id)?.error?.code).toBe("unsupported");
  });

  it("new frame -> old host (an endpoint without X-02 handlers): unknown_type plus onReject, aiRun dropped", async () => {
    const listeners = new Set<(event: MessageEvent) => void>();
    const rejects: RejectInfo[] = [];
    const replies: Envelope[] = [];
    const frame = { postMessage: (m: Envelope) => { replies.push(m); } };
    const self = {
      addEventListener: (_: "message", l: (event: MessageEvent) => void) => { listeners.add(l); },
      removeEventListener: (_: "message", l: (event: MessageEvent) => void) => { listeners.delete(l); },
    };
    const old = new Endpoint({ self, peer: () => frame, allowedOrigins: [ORIGIN], idPrefix: "h", onReject: (r) => rejects.push(r) });
    const deliver = (kind: Envelope["kind"], type: string, payload: unknown) => {
      const data = { ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: `f-${type}`, kind, type, payload };
      for (const l of [...listeners]) l({ data, origin: ORIGIN, source: frame } as MessageEvent);
    };
    deliver("request", "api.download", { data: new ArrayBuffer(1) });
    deliver("event", "aiRun", { state: "running" });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(replies).toEqual([expect.objectContaining({ id: "f-api.download", error: expect.objectContaining({ code: "unknown_type" }) })]);
    expect(rejects).toEqual([expect.objectContaining({ reason: "unknown_type", detail: "api.download" })]);
    old.dispose();
  });

  it("new host -> frame: doc.remoteVersion only after the handshake, no reply expected; closeCheck right after works", async () => {
    const onReject = vi.fn();
    const { host, deliver, sent, handshake, flush } = harness({ onReject });
    host.notifyRemoteVersion(REMOTE);
    expect(sent).toHaveLength(0);
    await handshake();
    host.notifyRemoteVersion(REMOTE);
    expect(sent.at(-1)).toMatchObject({ kind: "event", type: "doc.remoteVersion", payload: REMOTE });
    const check = host.closeCheck();
    await flush();
    const req = sent.find((m) => m.kind === "request" && m.type === "doc.closeCheck")!;
    deliver("response", "doc.closeCheck", { dirty: false, autoSave: false }, { id: req.id });
    await expect(check).resolves.toEqual({ dirty: false, autoSave: false });
    expect(onReject).not.toHaveBeenCalled();
  });
});

describe("doc.blocked (G5-03w, vendored)", () => {
  it("is an additive host event under version 1; any non-empty reason validates", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(HOST_EVENT_TYPES).toContain("doc.blocked");
    for (const reason of ["permission_revoked", "document_deleted", "organization_suspended", "member_deactivated", "document_archived", "newer_reason"]) {
      expect(env("event", "doc.blocked", { document_id: "doc-1", reason }).ok).toBe(true);
    }
    expect(env("event", "doc.blocked", { document_id: "doc-1", reason: "" }).ok).toBe(false);
    expect(env("event", "doc.blocked", { document_id: "", reason: "document_deleted" }).ok).toBe(false);
  });

  it("is sent only after the handshake, and expects no reply", async () => {
    const onReject = vi.fn();
    const { host, sent, handshake, flush } = harness({ onReject });
    host.notifyBlocked({ document_id: "doc-1", reason: "permission_revoked" });
    expect(sent).toHaveLength(0);
    await handshake();
    host.notifyBlocked({ document_id: "doc-1", reason: "document_deleted" });
    await flush();
    expect(sent.at(-1)).toMatchObject({ kind: "event", type: "doc.blocked", payload: { document_id: "doc-1", reason: "document_deleted" } });
    expect(onReject).not.toHaveBeenCalled();
  });
});

describe("X-02 OQ-P3 through the vendored host (fake document; the real host is G5-03w)", () => {
  function fakeDocument() {
    const versions = [{ id: "v1", revision: "5" }, { id: "v2", revision: "6" }];
    const open = async ({ fileId, versionId }: ApiOpenPayload) => {
      if (versionId !== undefined && !versions.some((v) => v.id === versionId)) {
        throw new DocsProtocolError({ code: "not_found", message: "no such version" });
      }
      const head = versions[versions.length - 1]!; // one read: bytes + revision of the head
      return {
        file: { fileId, name: "a.docx", versionId: head.id, revision: head.revision },
        source: { kind: "url" as const, url: `/content?version=${head.id}` },
        ...(versionId !== undefined && versionId !== head.id ? { versionChanged: true } : {}),
      };
    };
    return { open, commit: (id: string, revision: string) => versions.push({ id, revision }) };
  }

  it("a commit between doc.remoteVersion and api.open -> the head with its own revision and versionChanged", async () => {
    const doc = fakeDocument();
    const { host, deliver, sent, handshake, flush } = harness({ api: { "api.open": doc.open } });
    await handshake();
    host.notifyRemoteVersion(REMOTE);
    doc.commit("v3", "7");
    const id = deliver("request", "api.open", { fileId: "doc-1", versionId: REMOTE.version_id });
    await flush();
    const reply = sent.find((m) => m.id === id && m.kind === "response")!;
    expect(reply.payload).toEqual({
      file: { fileId: "doc-1", name: "a.docx", versionId: "v3", revision: "7" },
      source: { kind: "url", url: "/content?version=v3" },
      versionChanged: true,
    });
    expect(env("response", "api.open", reply.payload).ok).toBe(true);
  });

  it("an unknown or other-document version is refused with not_found", async () => {
    const doc = fakeDocument();
    const { deliver, sent, handshake, flush } = harness({ api: { "api.open": doc.open } });
    await handshake();
    const id = deliver("request", "api.open", { fileId: "doc-1", versionId: "other-doc-v1" });
    await flush();
    expect(sent.find((m) => m.id === id)?.error?.code).toBe("not_found");
  });
});

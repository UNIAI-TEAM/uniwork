import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocsFrameHost, type DocsFrameHostOptions } from "./docs-frame-host";
import { PROTOCOL_NS, PROTOCOL_VERSION, type Envelope } from "./docs-frame-protocol";

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

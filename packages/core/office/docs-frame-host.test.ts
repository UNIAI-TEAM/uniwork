import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocsFrameHost, type DocsFrameHostOptions } from "./docs-frame-host";
import { DocsProtocolError, PROTOCOL_NS, PROTOCOL_VERSION, type Envelope } from "./docs-frame-protocol";

const ORIGIN = "http://app.test";

function harness(overrides: Partial<DocsFrameHostOptions> = {}) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const self = {
    addEventListener: (_: "message", listener: (event: MessageEvent) => void) => { listeners.add(listener); },
    removeEventListener: (_: "message", listener: (event: MessageEvent) => void) => { listeners.delete(listener); },
  };
  const sent: Envelope[] = [];
  const peer = { postMessage: vi.fn((message: Envelope, origin: string) => { expect(origin).toBe(ORIGIN); sent.push(message); }) };
  const onReject = vi.fn();
  const host = createDocsFrameHost({ self, peer: () => peer, allowedOrigins: [ORIGIN], onReject, timeoutMs: 1_000, ...overrides });
  const deliver = (data: unknown, { origin = ORIGIN, source = peer as unknown }: { origin?: string; source?: unknown } = {}) => {
    for (const listener of [...listeners]) listener({ data, origin, source } as MessageEvent);
  };
  const frame = (kind: Envelope["kind"], type: string, id: string, rest: Partial<Envelope> = {}): Envelope =>
    ({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id, kind, type, ...rest });
  return { host, deliver, frame, sent, peer, onReject, listeners };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

afterEach(() => { vi.useRealTimers(); });

describe("createDocsFrameHost", () => {
  it("refuses a wildcard origin", () => {
    expect(() => harness({ allowedOrigins: ["*"] })).toThrow();
  });

  it("delivers events only from the frame window and the exact origin", () => {
    const { host, deliver, frame } = harness();
    const dirty = vi.fn();
    host.on("dirty", dirty);
    deliver(frame("event", "dirty", "f1", { payload: { dirty: true } }), { origin: "http://evil.test" });
    deliver(frame("event", "dirty", "f2", { payload: { dirty: true } }), { source: {} });
    deliver({ hello: "devtools" });
    expect(dirty).not.toHaveBeenCalled();
    deliver(frame("event", "dirty", "f3", { payload: { dirty: true } }));
    expect(dirty).toHaveBeenCalledWith({ dirty: true });
  });

  it("answers a frame request with the handler's payload, or its error as a typed shape", async () => {
    const { host, deliver, frame, sent } = harness();
    host.handle("api.recents", async () => ({ files: [] }));
    host.handle("api.open", async () => { throw new DocsProtocolError({ code: "forbidden", message: "no", status: 403 }); });
    deliver(frame("request", "api.recents", "f1", { payload: {} }));
    deliver(frame("request", "api.open", "f2", { payload: { fileId: "doc-1" } }));
    deliver(frame("request", "api.export", "f3", { payload: { format: "pdf" } }));
    await flush();
    expect(sent.find((m) => m.id === "f1")).toMatchObject({ kind: "response", type: "api.recents", payload: { files: [] } });
    expect(sent.find((m) => m.id === "f2")?.error).toMatchObject({ code: "forbidden", status: 403 });
    expect(sent.find((m) => m.id === "f3")?.error?.code).toBe("unknown_type");
  });

  it("answers a request from another protocol version with version_mismatch", () => {
    const { deliver, sent, onReject } = harness();
    deliver({ ns: PROTOCOL_NS, v: 99, id: "f1", kind: "request", type: "api.recents", payload: {} });
    expect(sent[0]).toMatchObject({ id: "f1", kind: "response", error: { code: "version_mismatch" } });
    expect(onReject).toHaveBeenCalledWith("version_mismatch", "v99");
  });

  it("answers a malformed request and reports it", () => {
    const { deliver, frame, sent, onReject } = harness();
    deliver(frame("request", "api.save", "f1", { payload: { fileId: "" } }));
    expect(sent[0]?.error?.code).toBe("malformed");
    expect(onReject).toHaveBeenCalledWith("malformed", expect.stringContaining("api.save"));
  });

  it("correlates its own requests with the frame's responses", async () => {
    const { host, deliver, frame, sent } = harness();
    const saved = host.request("save", { reason: "navigate" });
    const request = sent[0]!;
    expect(request).toMatchObject({ kind: "request", type: "save", payload: { reason: "navigate" } });
    deliver(frame("response", "save", "other", { payload: { ok: true, file: { fileId: "x", name: "a" } } }));
    deliver(frame("response", "save", request.id, { payload: { ok: true, file: { fileId: "doc-1", name: "a.docx" } } }));
    await expect(saved).resolves.toMatchObject({ ok: true, file: { fileId: "doc-1" } });
  });

  it("rejects a request on an error response, a timeout and a cancel", async () => {
    vi.useFakeTimers();
    const { host, deliver, frame, sent } = harness();
    const failed = host.request("print", {});
    deliver(frame("response", "print", sent[0]!.id, { error: { code: "internal", message: "boom" } }));
    await expect(failed).rejects.toMatchObject({ code: "internal" });

    const slow = host.request("save", { reason: "user" }, { timeoutMs: 50 });
    vi.advanceTimersByTime(60);
    await expect(slow).rejects.toMatchObject({ code: "timeout" });

    const controller = new AbortController();
    const cancelled = host.request("save", { reason: "user" }, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
    expect(sent.at(-1)).toMatchObject({ kind: "event", type: "cancel" });
  });

  it("aborts an inbound handler when the frame cancels it, and answers nothing", async () => {
    const { host, deliver, frame, sent } = harness();
    let aborted = false;
    host.handle("api.save", (_payload, { signal }) => new Promise((resolve) => {
      signal.addEventListener("abort", () => { aborted = true; resolve(null); });
    }));
    deliver(frame("request", "api.save", "f1", { payload: { fileId: "doc-1", data: new ArrayBuffer(1) } }));
    deliver(frame("event", "cancel", "f2", { payload: { id: "f1" } }));
    await flush();
    expect(aborted).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("disposes: stops listening and rejects what is pending", async () => {
    const { host, listeners, sent } = harness();
    const pending = host.request("save", { reason: "user" });
    host.dispose();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(listeners.size).toBe(0);
    expect(host.emit("theme", { theme: "dark" })).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("fails a request at once while no frame is attached", async () => {
    const { host } = harness({ peer: () => null });
    await expect(host.request("save", { reason: "user" })).rejects.toMatchObject({ code: "not_ready" });
  });
});

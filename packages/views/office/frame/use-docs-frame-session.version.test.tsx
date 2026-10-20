import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { DocsProtocolError, PROTOCOL_NS, PROTOCOL_VERSION, type Envelope } from "@uniwork/core/office/docs-frame-protocol";
import { requestMock } from "../../test/api-mock";
import type { DocsFrameSessionOptions } from "./docs-frame-session-model";
import type { FrameEditLock } from "./frame-edit-lock";
import { useDocsFrameSession } from "./use-docs-frame-session";

// UNI-2033: a stored version opened read-only. The session is a document session (document
// token) with the source-style read-only grant, no edit lock and no recovery.

const MINT_PATH = "/api/v1/documents/doc-1/office/frame-token";
const minted = () => ({
  token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: true, module: "docs",
});

function setup({ api = {} as Partial<DocsFrameApi>, editLock }: { api?: Partial<DocsFrameApi>; editLock?: FrameEditLock } = {}) {
  requestMock.mockImplementation((path: string) => {
    if (path === MINT_PATH) return Promise.resolve(minted());
    if (String(path).startsWith("/api/v1/config")) return Promise.resolve({ flags: {} });
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const options: DocsFrameSessionOptions = {
    iframeRef: { current: iframe }, frameOrigin: window.location.origin, module: "docs", wsId: "ws-1",
    fileRef: { kind: "document", id: "doc-1", version: 2 },
    readonly: false, editLock, locale: "vi", theme: "light", onError: vi.fn(),
    api: { open: vi.fn(), save: vi.fn(), ...api } as unknown as DocsFrameApi,
  };
  const hook = renderHook(() => useDocsFrameSession(options), { wrapper });
  return {
    hook, options, received,
    sent: (type: string) => received.filter((m) => m.kind === "request" && m.type === type),
    request: (type: string, payload: unknown) => { const e = envelope("request", type, payload); void post(e); return e.id; },
    answerTo: (id: string) => received.find((m) => m.kind === "response" && m.id === id),
    async boot() {
      await post(envelope("event", "ready", { protocolVersion: 1, capabilities: {}, module: "docs", instanceId: "i-1" }));
      await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    },
  };
}

afterEach(() => { vi.restoreAllMocks(); requestMock.mockReset(); document.body.innerHTML = ""; });

describe("useDocsFrameSession: a version view (UNI-2033)", () => {
  it("mints the document token and inits read-only with the source-style grant and nothing to recover", async () => {
    const frame = setup();
    await frame.boot();
    expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(true);
    const init = frame.sent("init")[0]?.payload as { documentId: string; token: string; profile?: string; capabilities: Record<string, boolean>; recovery?: unknown };
    expect(init.token).toBe("tok-1");
    expect(init.documentId).toBe("doc-1");
    expect(init.profile).toBe("readOnly");
    expect(init.capabilities).toMatchObject({
      save: false, saveAs: false, recents: false, exportPdf: false, exportHtml: false,
      attachments: false, images: false, ai: false, uniworkAi: false, desktopOpen: false, download: false, print: true,
    });
    expect(init.capabilities["commentsViewVersion"]).toBeUndefined();
    expect(init.recovery).toBeUndefined();
    expect(frame.hook.result.current.viewOnly).toBe(true);
  });

  it("holds no edit lock: it makes no lock request and a lock in scope neither blocks nor re-attaches it", async () => {
    const onLocked = vi.fn();
    const frame = setup({ editLock: { held: false, lockId: undefined, onLocked } });
    await frame.boot();
    expect(frame.hook.result.current.viewOnly).toBe(true);
    const paths = requestMock.mock.calls.map(([path]) => String(path));
    expect(paths.some((path) => /lock/i.test(path))).toBe(false);
    frame.options.editLock = { held: true, lockId: "L2", onLocked };
    frame.hook.rerender();
    expect(frame.hook.result.current.attempt).toBe(0);
  });

  it("refuses api.save and api.download even if the frame asks anyway", async () => {
    const save = vi.fn();
    const frame = setup({ api: { save } as unknown as Partial<DocsFrameApi> });
    await frame.boot();
    const saveId = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4), etag: "7" });
    await waitFor(() => expect(frame.answerTo(saveId)?.error?.code).toBe("forbidden"));
    const dlId = frame.request("api.download", { data: new ArrayBuffer(4) });
    await waitFor(() => expect(frame.answerTo(dlId)?.error?.code).toBe("forbidden"));
    expect(save).not.toHaveBeenCalled();
  });

  it("fails the session as not_found when the version does not exist, and a cancelled open does not fail it", async () => {
    const open = vi.fn(async () => { throw new DocsProtocolError({ code: "not_found", message: "version 2 not found" }); });
    const frame = setup({ api: { open } });
    await frame.boot();
    frame.request("api.open", { fileId: "doc-1" });
    await waitFor(() => expect(frame.hook.result.current.status).toBe("failed"));
    expect(frame.hook.result.current.failure?.code).toBe("not_found");

    const cancelling = setup({ api: { open: vi.fn(async () => { throw new DocsProtocolError({ code: "cancelled", message: "aborted" }); }) } });
    await cancelling.boot();
    const id = cancelling.request("api.open", { fileId: "doc-1" });
    await waitFor(() => expect(cancelling.answerTo(id)?.error?.code).toBe("cancelled"));
    expect(cancelling.hook.result.current.status).toBe("ready");
  });
});

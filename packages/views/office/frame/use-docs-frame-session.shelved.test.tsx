import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { DocsProtocolError, PROTOCOL_NS, PROTOCOL_VERSION, type Envelope } from "@uniwork/core/office/docs-frame-protocol";
import { documentKeys } from "@uniwork/core/documents/keys";
import { requestMock } from "../../test/api-mock";
import type { DocsFrameSessionOptions } from "./docs-frame-session-model";
import { useDocsFrameSession } from "./use-docs-frame-session";

// ARCHIVE-01 (UNI-1845) addendum §8 U-8, test UI-AR5: the Office frame of a
// shelved document opens in view mode (the token says can_edit=false), and a
// save answered document_shelved turns the live frame read-only without
// reloading it, so the open content survives.

const MINT_PATH = "/api/v1/documents/doc-1/office/frame-token";
const FILE = { fileId: "doc-1", name: "Plan.docx" };
const minted = (canEdit: boolean) => ({
  token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: canEdit, module: "docs",
});

/** The 409 the server answers a frame save with once the document is shelved, as core's docsFrameError shapes it. */
const shelvedShape = () => ({
  code: "conflict" as const, message: "document_shelved (HTTP 409)", status: 409, retryable: false,
  details: { apiCode: "document_shelved" },
});

function setup({ canEdit = true, api = {} as Partial<DocsFrameApi> } = {}) {
  requestMock.mockImplementation((path: string) => {
    if (path === MINT_PATH) return Promise.resolve(minted(canEdit));
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
  const onError = vi.fn();
  const onShelved = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const options: DocsFrameSessionOptions = {
    iframeRef: { current: iframe }, frameOrigin: window.location.origin, module: "docs", wsId: "ws-1", documentId: "doc-1",
    readonly: false, locale: "vi", theme: "light", onError, onShelved,
    api: { open: vi.fn(), save: vi.fn(async () => ({ ok: true, file: FILE, versionId: "v2" })), recents: vi.fn(), ...api } as unknown as DocsFrameApi,
  };
  const hook = renderHook(() => useDocsFrameSession(options), { wrapper });
  const answerTo = (id: string) => received.find((m) => m.kind === "response" && m.id === id);
  return {
    hook, onError, onShelved, invalidate, received, api: options.api,
    sent: (type: string) => received.filter((m) => m.kind === "request" && m.type === type),
    request: (type: string, payload: unknown) => { const e = envelope("request", type, payload); void post(e); return e.id; },
    answered: async (id: string) => { await waitFor(() => expect(answerTo(id)).toBeDefined()); return answerTo(id)!; },
    async boot() {
      await post(envelope("event", "ready", { protocolVersion: 1, capabilities: {}, module: "docs", instanceId: "i-1" }));
      await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    },
  };
}

const save = (frame: ReturnType<typeof setup>) => frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4), etag: "e1" });

afterEach(() => { vi.restoreAllMocks(); requestMock.mockReset(); document.body.innerHTML = ""; });

describe("UI-AR5 the Office frame of a shelved document", () => {
  it("opens in view mode when the token says can_edit=false, and sends no save", async () => {
    const frame = setup({ canEdit: false });
    await frame.boot();
    const init = frame.sent("init")[0]?.payload as { capabilities: { save: boolean; saveAs: boolean; images: boolean } };
    expect(init.capabilities).toMatchObject({ save: false, saveAs: false, images: false });
    expect(frame.hook.result.current.viewOnly).toBe(true);

    const id = save(frame);
    expect((await frame.answered(id)).error?.code).toBe("forbidden");
    expect(frame.api.save).not.toHaveBeenCalled();
  });

  it("answers a save refused with document_shelved as a read-only refusal, once, and turns the session read-only", async () => {
    const save409 = vi.fn(async () => ({ ok: false as const, error: shelvedShape() }));
    const frame = setup({ api: { save: save409 } as unknown as Partial<DocsFrameApi> });
    await frame.boot();
    expect(frame.hook.result.current.viewOnly).toBe(false);

    const id = save(frame);
    const answer = await frame.answered(id);
    // Not a conflict: the frame must not open its "newer version" dialog for an archived document.
    expect(answer.error?.code).toBe("forbidden");
    await waitFor(() => expect(frame.hook.result.current.viewOnly).toBe(true));
    expect(frame.onShelved).toHaveBeenCalledTimes(1);
    expect(frame.invalidate).toHaveBeenCalledWith({ queryKey: documentKeys.detail("ws-1", "doc-1") });
    // The frame is not re-created: it keeps the open content, and no failure screen replaces it.
    expect(frame.hook.result.current.status).toBe("ready");
    expect(frame.sent("init")).toHaveLength(1);

    // The next save never reaches the server, and nothing is announced twice.
    const again = save(frame);
    expect((await frame.answered(again)).error?.code).toBe("forbidden");
    expect(save409).toHaveBeenCalledTimes(1);
    expect(frame.onShelved).toHaveBeenCalledTimes(1);
    expect(frame.onError).not.toHaveBeenCalled();
  });

  it("recognises the refusal when the upload step throws it", async () => {
    const throwing = vi.fn(async () => { throw new DocsProtocolError(shelvedShape()); });
    const frame = setup({ api: { save: throwing } as unknown as Partial<DocsFrameApi> });
    await frame.boot();
    const id = save(frame);
    expect((await frame.answered(id)).error?.code).toBe("forbidden");
    await waitFor(() => expect(frame.hook.result.current.viewOnly).toBe(true));
    expect(frame.onShelved).toHaveBeenCalledTimes(1);
  });

  it("leaves an ordinary stale-base conflict alone", async () => {
    const stale = vi.fn(async () => ({
      ok: false as const, error: { code: "conflict" as const, message: "revision_conflict (HTTP 409)", status: 409, details: { apiCode: "revision_conflict" } },
    }));
    const frame = setup({ api: { save: stale } as unknown as Partial<DocsFrameApi> });
    await frame.boot();
    const id = save(frame);
    expect((await frame.answered(id)).payload).toMatchObject({ ok: false });
    expect(frame.hook.result.current.viewOnly).toBe(false);
    expect(frame.onShelved).not.toHaveBeenCalled();
  });
});

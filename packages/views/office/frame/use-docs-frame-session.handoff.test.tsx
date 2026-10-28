import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOfficeHandoffStore } from "@uniwork/core/ai/office-handoff";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { PROTOCOL_NS, PROTOCOL_VERSION, type Envelope, type InitPayload } from "@uniwork/core/office/docs-frame-protocol";
import { requestMock } from "../../test/api-mock";
import type { DocsFrameSessionOptions } from "./docs-frame-session-model";
import type { FrameEditLock } from "./frame-edit-lock";
import { useDocsFrameSession } from "./use-docs-frame-session";

// Ask UNI's job handed to the editor AI (UNI-2264) through the real frame session: the edit lock
// starts in parallel with the frame boot, so the first handshake may be read-only for want of the
// lock. That handshake must leave the job queued for the edit-mode re-attach.

// Records what the session calls on the binding while the real hook does the work.
const calls = vi.hoisted(() => ({ attach: vi.fn(), documentOpened: vi.fn(), detach: vi.fn(), onAiRun: vi.fn() }));
vi.mock("./use-frame-ai-handoff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-frame-ai-handoff")>();
  const { useMemo } = await import("react");
  return {
    useFrameAiHandoff: (documentId: string) => {
      const real = actual.useFrameAiHandoff(documentId);
      return useMemo(() => ({
        attach: (...a: Parameters<typeof real.attach>) => { calls.attach(...a); real.attach(...a); },
        documentOpened: (...a: Parameters<typeof real.documentOpened>) => { calls.documentOpened(...a); real.documentOpened(...a); },
        detach: () => { calls.detach(); real.detach(); },
        onAiRun: (...a: Parameters<typeof real.onAiRun>) => { calls.onAiRun(...a); real.onAiRun(...a); },
      }), [real]);
    },
  };
});

const MINT_PATH = "/api/v1/documents/doc-1/office/frame-token";
const FILE = { fileId: "doc-1", name: "Plan.docx" };
const minted = () => ({
  token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: true, module: "docs",
  ai: { ai: false, uniwork_ai: true, web_search: false, image_search: false, image_generation: false },
});
const lockOf = (held: boolean): FrameEditLock => ({ held, lockId: held ? "L1" : undefined, onLocked: vi.fn() });
const status = () => useOfficeHandoffStore.getState().byDocument["doc-1"]?.status;

/** A frame that claims every capability the host grants, so the ack carries `aiStart` exactly when the init did. */
function setup(editLock: FrameEditLock) {
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
      const capabilities = { aiStart: (m.payload as InitPayload).capabilities.aiStart === true };
      queueMicrotask(() => { void post(envelope("response", "init", { protocolVersion: 1, capabilities }, m.id)); });
    }
    if (m.kind === "request" && m.type === "ai.start") {
      queueMicrotask(() => { void post(envelope("response", "ai.start", { queued: true }, m.id)); });
    }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const open = vi.fn(async () => ({ file: FILE, source: { kind: "bytes" as const, data: new ArrayBuffer(4) } }));
  const options = {
    iframeRef: { current: iframe }, frameOrigin: window.location.origin, module: "docs", wsId: "ws-1",
    fileRef: { kind: "document", id: "doc-1" }, readonly: false, editLock, locale: "vi", theme: "light", onError: vi.fn(),
    api: { open, save: vi.fn(), recents: vi.fn() } as unknown as DocsFrameApi,
  } as DocsFrameSessionOptions;
  const hook = renderHook(() => useDocsFrameSession(options), { wrapper });
  const sent = (type: string) => received.filter((m) => m.kind === "request" && m.type === type);
  const answerTo = (id: string) => received.find((m) => m.kind === "response" && m.id === id);
  return {
    hook, options, sent,
    event: (type: string, payload: unknown) => post(envelope("event", type, payload)),
    /** The frame instance boots, completes the handshake, and opens the document. */
    async bootAndOpen(instanceId: string) {
      const inits = sent("init").length;
      await post(envelope("event", "ready", { protocolVersion: 1, capabilities: {}, module: "docs", instanceId }));
      await waitFor(() => expect(sent("init")).toHaveLength(inits + 1));
      await waitFor(() => expect(calls.attach).toHaveBeenCalledTimes(inits + 1));
      const e = envelope("request", "api.open", { fileId: "doc-1" });
      await post(e);
      await waitFor(() => expect(answerTo(e.id)?.payload).toBeDefined());
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  requestMock.mockReset();
  document.body.innerHTML = "";
  useOfficeHandoffStore.getState().reset();
  for (const spy of Object.values(calls)) spy.mockReset();
});

describe("useDocsFrameSession: Ask UNI's handed-over job (UNI-2264)", () => {
  it("keeps the job through a locked-out first handshake and sends it once from the edit-mode re-attach", async () => {
    useOfficeHandoffStore.getState().queue("doc-1", "h1", "Soạn báo cáo");
    const frame = setup(lockOf(false));
    await frame.bootAndOpen("i-1");
    expect(frame.sent("init")[0]?.payload).toMatchObject({ capabilities: { aiStart: false } });
    expect(calls.documentOpened).toHaveBeenCalledTimes(1);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(frame.sent("ai.start")).toHaveLength(0);
    expect(status()).toBe("pending");
    // A run of the read-only frame's own AI does not move a job it was never sent.
    await frame.event("aiRun", { state: "running" });
    expect(calls.onAiRun).toHaveBeenCalledWith("running");
    expect(status()).toBe("pending");

    frame.options.editLock = lockOf(true);
    frame.hook.rerender();
    await waitFor(() => expect(frame.hook.result.current.attempt).toBe(1));
    expect(calls.detach).toHaveBeenCalledTimes(1);
    await frame.bootAndOpen("i-2");
    expect(frame.sent("init")[1]?.payload).toMatchObject({ capabilities: { aiStart: true } });
    await waitFor(() => expect(frame.sent("ai.start")).toHaveLength(1));
    expect(frame.sent("ai.start")[0]?.payload).toEqual({ handoffId: "h1", text: "Soạn báo cáo", displayText: "Soạn báo cáo" });
    expect(status()).toBe("sent");

    await frame.event("aiRun", { state: "running" });
    expect(status()).toBe("running");
    await frame.event("aiRun", { state: "idle" });
    expect(status()).toBe("idle");
    expect(frame.sent("ai.start")).toHaveLength(1);

    frame.hook.unmount();
    expect(calls.detach).toHaveBeenCalledTimes(2);
  });
});

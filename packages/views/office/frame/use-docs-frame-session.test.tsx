import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { DocsProtocolError, PROTOCOL_NS, PROTOCOL_VERSION, type Envelope, type OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { requestMock } from "../../test/api-mock";
import { frameDownloadMaxBytes } from "./frame-download";
import type { DocsFrameSessionOptions } from "./docs-frame-session-model";
import type { FrameEditLock } from "./frame-edit-lock";
import { useDocsFrameSession } from "./use-docs-frame-session";

const MINT_PATH = "/api/v1/documents/doc-1/office/frame-token";
const SOURCE_ID = "chat:s-1";
const SOURCE_MINT_PATH = `/api/v1/workspaces/ws-1/documents/sources/${encodeURIComponent(SOURCE_ID)}/office/frame-token`;
const FILE = { fileId: "doc-1", name: "Plan.docx" };
const minted = (canEdit = true) => ({
  token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: canEdit, module: "docs",
});
const mintedSource = () => ({
  token: "ofs1.tok", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  source_id: SOURCE_ID, parent_kind: "chat_channel", parent_id: "c-1",
  workspace_id: "ws-1", organization_id: "org-1", can_edit: false, module: "docs", readonly: true,
});

/** A frame on the other side of the wire: records what the host posts, posts back as the iframe's window. */
function setup({ module = "docs" as OfficeModule, canEdit = true, readonly = false, api = {} as Partial<DocsFrameApi>, editLock, uploadMaxBytes, configPromise, fileRef }: { module?: OfficeModule; canEdit?: boolean; readonly?: boolean; api?: Partial<DocsFrameApi>; editLock?: FrameEditLock; uploadMaxBytes?: number; configPromise?: Promise<unknown>; fileRef?: { kind: "document" | "source"; id: string } } = {}) {
  const ref = fileRef ?? { kind: "document" as const, id: "doc-1" };
  requestMock.mockImplementation((path: string) => {
    if (path === MINT_PATH) return Promise.resolve({ ...minted(canEdit), module });
    if (path === SOURCE_MINT_PATH) return Promise.resolve({ ...mintedSource(), module });
    if (String(path).startsWith("/api/v1/config")) {
      if (configPromise) return configPromise;
      return Promise.resolve(uploadMaxBytes !== undefined ? { flags: {}, documents: { limits: { upload_max_bytes: uploadMaxBytes } } } : { flags: {} });
    }
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const options: DocsFrameSessionOptions = {
    iframeRef: { current: iframe }, frameOrigin: window.location.origin, module, wsId: "ws-1", fileRef: ref,
    readonly, editLock, locale: "vi", theme: "light", onError, downloadName: () => "Kế hoạch: Q4 (bản của tôi)",
    api: { open: vi.fn(), save: vi.fn(async () => ({ ok: true, file: FILE, versionId: "v2" })), recents: vi.fn(), ...api } as unknown as DocsFrameApi,
  };
  const hook = renderHook(() => useDocsFrameSession(options), { wrapper });
  const sent = (type: string) => received.filter((m) => m.kind === "request" && m.type === type);
  return {
    iframe, hook, onError, received, sent, options, client,
    event: (type: string, payload: unknown) => post(envelope("event", type, payload)),
    respond: (to: Envelope, payload: unknown) => post(envelope("response", to.type, payload, to.id)),
    respondError: (to: Envelope, error: Envelope["error"]) =>
      post({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: to.id, kind: "response", type: to.type, error }),
    request: (type: string, payload: unknown) => { const e = envelope("request", type, payload); void post(e); return e.id; },
    answerTo: (id: string) => received.find((m) => m.kind === "response" && m.id === id),
    async boot(instanceId = "i-1") {
      await post(envelope("event", "ready", { protocolVersion: 1, capabilities: {}, module, instanceId }));
      await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    },
  };
}

/** Starts a page Save once the frame is ready; timers are fake from here on (the watchdog's clock). */
async function startSave(frame: ReturnType<typeof setup>, reason: "user" | "navigate" = "user") {
  await frame.boot();
  await frame.event("dirty", { dirty: true });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let saving!: Promise<string>;
  act(() => { saving = frame.hook.result.current.save(reason); });
  await settle();
  expect(frame.sent("save")).toHaveLength(1);
  return { saving, request: frame.sent("save")[0]! };
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
/**
 * Lets pending promises and zero-delay work run once timers are fake. Testing Library's waitFor
 * would hang here: its async wrapper waits on a setTimeout that only a fake clock can fire.
 */
const settle = () => advance(0);

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); requestMock.mockReset(); document.body.innerHTML = ""; });

describe("useDocsFrameSession: a Save the page sends to the frame", () => {
  it("waits as long as the frame's conflict dialog stays open, and maps Overwrite to saved", async () => {
    const frame = setup();
    const { saving, request } = await startSave(frame);
    expect(request.payload).toEqual({ reason: "user" });
    expect(frame.hook.result.current.saveState).toBe("saving");
    await frame.event("modal", { open: true });
    await advance(5 * 60_000);
    expect(frame.hook.result.current.saveState).toBe("saving");
    expect(frame.received.some((m) => m.kind === "event" && m.type === "cancel")).toBe(false);
    await frame.event("modal", { open: false });
    await frame.respond(request, { ok: true, file: FILE, versionId: "v3" });
    await expect(saving).resolves.toBe("saved");
    await frame.event("dirty", { dirty: false });
    expect(frame.hook.result.current.saveState).toBe("saved");
    expect(frame.onError).not.toHaveBeenCalled();
  });

  it("cancels a save the frame neither answers nor opens a dialog for in 30 s: header error and onError, as a timeout", async () => {
    const frame = setup();
    const { saving } = await startSave(frame);
    await advance(29_999);
    expect(frame.hook.result.current.saveState).toBe("saving");
    await advance(1);
    await expect(saving).resolves.toBe("failed");
    expect(frame.hook.result.current.saveState).toBe("error");
    expect(frame.onError).toHaveBeenCalledTimes(1);
    expect(frame.onError.mock.calls[0]![0]).toMatchObject({ code: "timeout" });
  });

  it("pauses the watchdog while the frame runs api.save for this Save, however long it takes", async () => {
    let finish!: (value: unknown) => void;
    const save = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const frame = setup({ api: { save } as unknown as Partial<DocsFrameApi> });
    const { saving, request } = await startSave(frame);
    await advance(10_000);
    const upload = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4) });
    await settle();
    expect(save).toHaveBeenCalled();
    await advance(90_000);
    await act(async () => { finish({ ok: true, file: FILE, versionId: "v4" }); });
    await settle();
    expect(frame.answerTo(upload)?.payload).toMatchObject({ ok: true });
    await frame.respond(request, { ok: true, file: FILE, versionId: "v4" });
    await expect(saving).resolves.toBe("saved");
    await frame.event("dirty", { dirty: false });
    expect(frame.hook.result.current.saveState).toBe("saved");
    expect(frame.onError).not.toHaveBeenCalled();
  });

  it("restarts the 30 s when the frame's dialog closes without an answer", async () => {
    const frame = setup();
    const { saving } = await startSave(frame);
    await advance(20_000);
    await frame.event("modal", { open: true });
    await advance(60_000);
    await frame.event("modal", { open: false });
    await advance(29_000);
    expect(frame.hook.result.current.saveState).toBe("saving");
    await advance(1_000);
    await expect(saving).resolves.toBe("failed");
    expect(frame.onError.mock.calls[0]![0]).toMatchObject({ code: "timeout" });
  });

  it("reads Cancel in the frame's dialog as unsaved edits, not an error", async () => {
    const frame = setup();
    const { saving, request } = await startSave(frame);
    await frame.event("modal", { open: true });
    await frame.event("modal", { open: false });
    await frame.respond(request, { ok: false, error: { code: "cancelled", message: "user cancelled" } });
    await expect(saving).resolves.toBe("cancelled");
    expect(frame.hook.result.current.saveState).toBe("dirty");
    expect(frame.onError).not.toHaveBeenCalled();
  });

  it("reads Reload latest (ok without a new version) as ready", async () => {
    const frame = setup();
    const { saving, request } = await startSave(frame);
    await frame.respond(request, { ok: true, file: FILE });
    await expect(saving).resolves.toBe("reloaded");
    await frame.event("dirty", { dirty: false });
    expect(frame.hook.result.current.saveState).toBe("ready");
    expect(frame.onError).not.toHaveBeenCalled();
  });

  it("reads a text module that reloads itself after Reload latest as ready, not unsaved", async () => {
    const frame = setup({ module: "markdown" });
    const { saving, request } = await startSave(frame);
    await frame.respond(request, { ok: true, file: FILE });
    await expect(saving).resolves.toBe("reloaded");
    // Markdown and HTML call location.reload() right after that answer; the new document is clean.
    act(() => { frame.iframe.dispatchEvent(new Event("load")); frame.iframe.dispatchEvent(new Event("load")); });
    await settle();
    expect(frame.hook.result.current.dirty).toBe(false);
    expect(frame.hook.result.current.saveState).toBe("ready");
    expect(frame.onError).not.toHaveBeenCalled();
  });

  it("does not show the page's own conflict dialog any more: the session has no conflict state", async () => {
    const frame = setup();
    await frame.boot();
    expect(frame.hook.result.current).not.toHaveProperty("conflict");
    expect(frame.hook.result.current).not.toHaveProperty("reloadLatest");
  });

  it.each([
    ["unauthorized", 401],
    ["forbidden", 403],
    ["not_found", 410],
    ["internal", 503],
  ] as const)("reports a %s answer (HTTP %i) as an error", async (code, status) => {
    const frame = setup();
    const { saving, request } = await startSave(frame, "navigate");
    expect(request.payload).toEqual({ reason: "navigate" });
    await frame.respond(request, { ok: false, error: { code, message: "refused", status } });
    await expect(saving).resolves.toBe("failed");
    expect(frame.hook.result.current.saveState).toBe("error");
    expect(frame.onError).toHaveBeenCalledWith(expect.objectContaining({ code }));
  });

  it("holds a navigate save through the frame's conflict dialog until the frame answers", async () => {
    const frame = setup();
    const { saving, request } = await startSave(frame, "navigate");
    let settled = false;
    void saving.then(() => { settled = true; });
    await frame.event("modal", { open: true });
    expect(frame.hook.result.current.modal).toBe(true);
    await advance(10 * 60_000);
    expect(settled).toBe(false);
    await frame.event("modal", { open: false });
    await frame.respond(request, { ok: true, file: FILE, versionId: "v5" });
    await expect(saving).resolves.toBe("saved");
  });

  it("cancels the request and clears the modal when the frame document unloads mid-save", async () => {
    const frame = setup();
    const { saving, request } = await startSave(frame);
    await frame.event("modal", { open: true });
    expect(frame.hook.result.current.modal).toBe(true);
    // The frame document goes away: the iframe loads a new one.
    act(() => { frame.iframe.dispatchEvent(new Event("load")); frame.iframe.dispatchEvent(new Event("load")); });
    await expect(saving).resolves.toBe("failed");
    await settle();
    expect(frame.hook.result.current.modal).toBe(false);
    expect(frame.hook.result.current.saveState).toBe("error");
    expect(frame.received.some((m) => m.kind === "event" && m.type === "cancel" && (m.payload as { id?: string }).id === request.id)).toBe(true);
    expect(frame.onError).toHaveBeenCalledTimes(1);
  });
});

describe("useDocsFrameSession: a Save whose frame stops being usable", () => {
  const cancelled = (frame: ReturnType<typeof setup>, id: string) =>
    frame.received.some((m) => m.kind === "event" && m.type === "cancel" && (m.payload as { id?: string }).id === id);

  it("gives up the Save when the frame document goes away, with no replacement load", async () => {
    const frame = setup();
    const { saving, request } = await startSave(frame, "navigate");
    await frame.event("modal", { open: true });
    expect(frame.hook.result.current.modal).toBe(true);
    // The old document is torn down; nothing replaces it (yet).
    act(() => { frame.iframe.contentWindow!.dispatchEvent(new Event("pagehide")); });
    await expect(saving).resolves.toBe("failed");
    await settle();
    expect(cancelled(frame, request.id)).toBe(true);
    expect(frame.hook.result.current.modal).toBe(false);
    expect(frame.hook.result.current.saveState).toBe("error");
    expect(frame.onError).toHaveBeenCalledTimes(1);
    expect(frame.onError.mock.calls[0]![0]).toMatchObject({ code: "internal", details: { reason: "frame_unloaded" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reads a single replacement load as the old document gone when the first load was never seen", async () => {
    const frame = setup();
    const { saving, request } = await startSave(frame);
    await frame.event("modal", { open: true });
    // The document that shook hands loaded before the host listened; the next load is a new document.
    const replacement = document.implementation.createHTMLDocument("next");
    Object.defineProperty(frame.iframe, "contentDocument", { configurable: true, get: () => replacement });
    act(() => { frame.iframe.dispatchEvent(new Event("load")); });
    await expect(saving).resolves.toBe("failed");
    await settle();
    expect(cancelled(frame, request.id)).toBe(true);
    expect(frame.hook.result.current.modal).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not read the first load of the document that shook hands as an unload", async () => {
    const frame = setup();
    await startSave(frame);
    await frame.event("modal", { open: true });
    act(() => { frame.iframe.dispatchEvent(new Event("load")); });
    await settle();
    expect(frame.hook.result.current.modal).toBe(true);
    expect(frame.hook.result.current.saveState).toBe("saving");
  });

  it("settles the Save on a fatal frame error: failed with that error, one onError, no timer left", async () => {
    const frame = setup();
    const { saving, request } = await startSave(frame, "navigate");
    await frame.event("modal", { open: true });
    await frame.event("error", { error: { code: "internal", message: "editor crashed" }, fatal: true });
    await expect(saving).resolves.toBe("failed");
    await settle();
    expect(cancelled(frame, request.id)).toBe(true);
    expect(frame.hook.result.current.status).toBe("failed");
    expect(frame.hook.result.current.saveState).toBe("error");
    expect(frame.onError).toHaveBeenCalledTimes(1);
    expect(frame.onError.mock.calls[0]![0]).toMatchObject({ code: "internal", message: "editor crashed" });
    // A late dialog event from the dead frame cannot re-arm anything.
    await frame.event("modal", { open: false });
    await advance(5 * 60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(frame.onError).toHaveBeenCalledTimes(1);
  });

  it("settles the Save when a new frame instance fails its handshake", async () => {
    const frame = setup();
    const { saving, request } = await startSave(frame, "navigate");
    await frame.event("modal", { open: true });
    await frame.event("ready", { protocolVersion: 99, capabilities: {}, module: "docs", instanceId: "i-2" });
    await expect(saving).resolves.toBe("failed");
    await settle();
    expect(cancelled(frame, request.id)).toBe(true);
    expect(frame.hook.result.current.status).toBe("failed");
    expect(frame.hook.result.current.failure).toMatchObject({ code: "version_mismatch" });
    expect(frame.hook.result.current.saveState).toBe("error");
    expect(frame.hook.result.current.modal).toBe(false);
    expect(frame.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a dialog the frame reports after its document went away, and starts a new handshake with none open", async () => {
    const frame = setup();
    const { saving } = await startSave(frame, "navigate");
    await frame.event("modal", { open: true });
    act(() => { frame.iframe.contentWindow!.dispatchEvent(new Event("pagehide")); });
    await expect(saving).resolves.toBe("failed");
    await settle();
    expect(frame.hook.result.current.modal).toBe(false);
    // A message queued before the teardown arrives late: nothing is left to close that dialog.
    await frame.event("modal", { open: true });
    expect(frame.hook.result.current.modal).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    // A replacement load lifts nothing and restores nothing.
    act(() => { frame.iframe.dispatchEvent(new Event("load")); });
    await settle();
    expect(frame.hook.result.current.modal).toBe(false);
    await frame.event("modal", { open: true });
    expect(frame.hook.result.current.modal).toBe(false);
    // The new document that shook hands reports its own dialogs again, from a clean start.
    await frame.event("ready", { protocolVersion: 1, capabilities: {}, module: "docs", instanceId: "i-2" });
    await settle();
    expect(frame.hook.result.current.status).toBe("ready");
    expect(frame.hook.result.current.modal).toBe(false);
    await frame.event("modal", { open: true });
    expect(frame.hook.result.current.modal).toBe(true);
  });

  it("does not re-arm the watchdog when the frame's api.save ends after the Save was answered", async () => {
    let finish!: (value: unknown) => void;
    const save = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const frame = setup({ api: { save } as unknown as Partial<DocsFrameApi> });
    const { saving, request } = await startSave(frame);
    frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4) });
    await settle();
    expect(save).toHaveBeenCalled();
    await frame.respond(request, { ok: true, file: FILE, versionId: "v6" });
    await expect(saving).resolves.toBe("saved");
    await act(async () => { finish({ ok: true, file: FILE, versionId: "v6" }); });
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(frame.onError).not.toHaveBeenCalled();
  });

  it("does not re-arm the watchdog or touch the next session when api.save ends after a retry", async () => {
    let finish!: (value: unknown) => void;
    const save = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const frame = setup({ api: { save } as unknown as Partial<DocsFrameApi> });
    const { saving } = await startSave(frame);
    frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4) });
    await settle();
    act(() => { frame.hook.result.current.retry(); });
    await expect(saving).resolves.toBe("cancelled");
    await settle();
    expect(frame.hook.result.current.saveState).toBe("ready");
    // The new session's own boot timers run; the old upload must not add a watchdog to them.
    const timers = vi.getTimerCount();
    await act(async () => { finish({ ok: true, file: FILE, versionId: "v7" }); });
    await settle();
    expect(vi.getTimerCount()).toBe(timers);
    // The new session never saw that upload: its header still reads clean.
    expect(frame.hook.result.current.saveState).toBe("ready");
    expect(frame.onError).not.toHaveBeenCalled();
  });

  it("does not re-arm the watchdog when api.save ends after unmount", async () => {
    let finish!: (value: unknown) => void;
    const save = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const frame = setup({ api: { save } as unknown as Partial<DocsFrameApi> });
    const { saving } = await startSave(frame);
    frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4) });
    await settle();
    frame.hook.unmount();
    await expect(saving).resolves.toBe("cancelled");
    await act(async () => { finish({ ok: true, file: FILE, versionId: "v8" }); });
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useDocsFrameSession: api.download", () => {
  async function ready(opts: Parameters<typeof setup>[0] = {}) {
    const frame = setup(opts);
    await frame.boot();
    const created: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => { created.push(blob); return "blob:frame-download"; });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    return { frame, created, createObjectURL, revokeObjectURL, clicks, fetchSpy };
  }

  it("advertises download to a user who may edit, and not to a viewer", async () => {
    const editor = setup();
    await editor.boot();
    expect(editor.sent("init")[0]?.payload).toMatchObject({ capabilities: { download: true } });
    editor.hook.unmount();
    document.body.innerHTML = "";
    const viewer = setup({ readonly: true });
    await viewer.boot();
    expect(viewer.sent("init")[0]?.payload).toMatchObject({ capabilities: { download: false } });
  });

  it("sends the download cap max(upload_max_bytes + 64 MiB, 256 MiB) in init when download is advertised", async () => {
    expect(frameDownloadMaxBytes(50 * 1024 * 1024)).toBe(256 * 1024 * 1024);
    expect(frameDownloadMaxBytes(200 * 1024 * 1024)).toBe(264 * 1024 * 1024);

    const editor = setup({ uploadMaxBytes: 50 * 1024 * 1024 });
    // The ceiling comes from useDocumentLimits, so the config must have landed before init goes out.
    await waitFor(() => expect(editor.client.getQueryData(["public-config"])).toBeDefined());
    await editor.boot();
    const editorInit = editor.sent("init")[0]?.payload as { capabilities: { download: boolean }; downloadMaxBytes?: number };
    expect(editorInit.capabilities.download).toBe(true);
    expect(editorInit.downloadMaxBytes).toBe(256 * 1024 * 1024);
    editor.hook.unmount();
    document.body.innerHTML = "";
    const viewer = setup({ readonly: true });
    await viewer.boot();
    const viewerInit = viewer.sent("init")[0]?.payload as { capabilities: { download: boolean } };
    expect(viewerInit.capabilities.download).toBe(false);
    expect(viewerInit).not.toHaveProperty("downloadMaxBytes");
  });

  it("sends no download cap when the page is editable but the minted token says can_edit: false", async () => {
    const tokenViewer = setup({ canEdit: false });
    await tokenViewer.boot();
    const init = tokenViewer.sent("init")[0]?.payload as { capabilities: { download: boolean } };
    expect(init.capabilities.download).toBe(false);
    expect(init).not.toHaveProperty("downloadMaxBytes");
  });

  it.each([
    ["docs", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["sheets", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["markdown", "md", "text/markdown"],
  ] as const)("delivers the %s bytes once, named by the host in the module's own format", async (module, ext, mime) => {
    const { frame, created, revokeObjectURL, clicks, fetchSpy } = await ready({ module });
    requestMock.mockClear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const id = frame.request("api.download", { data: new ArrayBuffer(8), name: "evil.exe", mimeType: "application/x-msdownload" });
    await settle();
    expect(frame.answerTo(id)?.payload).toEqual({ delivered: true });
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.download).toBe(`Kế hoạch_ Q4 (bản của tôi).${ext}`);
    expect(clicks[0]!.href).toBe("blob:frame-download");
    expect(clicks[0]!.isConnected).toBe(false);
    expect(created).toHaveLength(1);
    expect(created[0]!.type).toBe(mime);
    expect(created[0]!.size).toBe(8);
    await advance(0);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:frame-download");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("refuses bytes over the download ceiling", async () => {
    const ceiling = frameDownloadMaxBytes(200 * 1024 * 1024);
    const { frame, clicks } = await ready();
    const fakeOversize = { byteLength: ceiling + 1 };
    Object.setPrototypeOf(fakeOversize, ArrayBuffer.prototype);
    const id = frame.request("api.download", { data: fakeOversize });
    await waitFor(() => expect(frame.answerTo(id)?.error?.code).toBe("too_large"));
    expect(frame.answerTo(id)?.error?.details).toEqual({ maxBytes: ceiling });
    expect(clicks).toHaveLength(0);
  });

  it.each([
    ["the page is readonly", { readonly: true }],
    ["the current token cannot edit", { canEdit: false }],
  ])("refuses when %s", async (_why, opts) => {
    const { frame, clicks } = await ready(opts);
    const id = frame.request("api.download", { data: new ArrayBuffer(8) });
    await waitFor(() => expect(frame.answerTo(id)?.error?.code).toBe("forbidden"));
    expect(clicks).toHaveLength(0);
  });

  it("refuses a malformed payload", async () => {
    const { frame, clicks } = await ready();
    const id = frame.request("api.download", { data: "not bytes" });
    await waitFor(() => expect(frame.answerTo(id)?.error?.code).toBe("malformed"));
    expect(clicks).toHaveLength(0);
  });

  it("enforces the exact downloadMaxBytes ceiling sent in init even if config resolves after init (N1)", async () => {
    let resolveConfig!: (val: unknown) => void;
    const configPromise = new Promise((r) => { resolveConfig = r; });
    const frame = setup({ configPromise });
    await frame.boot();
    const initCeiling = frameDownloadMaxBytes(200 * 1024 * 1024);
    expect((frame.sent("init")[0]?.payload as { downloadMaxBytes?: number }).downloadMaxBytes).toBe(initCeiling);

    // Config arrives after init with a higher 300 MiB upload_max_bytes.
    await act(async () => {
      resolveConfig({ flags: {}, documents: { limits: { upload_max_bytes: 300 * 1024 * 1024, save_warn_ratio: 0.9 } } });
    });
    await waitFor(() => expect(frame.client.getQueryData(["public-config"])).toBeDefined());

    // api.download must still enforce the ceiling sent in init (264 MiB), not 364 MiB.
    const fakeOversize = { byteLength: initCeiling + 1 };
    Object.setPrototypeOf(fakeOversize, ArrayBuffer.prototype);
    const id = frame.request("api.download", { data: fakeOversize });
    await waitFor(() => expect(frame.answerTo(id)?.error?.code).toBe("too_large"));
    expect(frame.answerTo(id)?.error?.details).toEqual({ maxBytes: initCeiling });
  });

  it("includes limits and capabilities.sizeUi: true on init and api.open across modules", async () => {
    const open = vi.fn(async () => ({ file: FILE, source: { kind: "bytes" as const, data: new ArrayBuffer(4) } }));
    const frame = setup({ module: "sheets", uploadMaxBytes: 100 * 1024 * 1024, api: { open } });
    await waitFor(() => expect(frame.client.getQueryData(["public-config"])).toBeDefined());
    await frame.boot();
    expect(frame.sent("init")[0]?.payload).toMatchObject({
      capabilities: { sizeUi: true },
      limits: { max_bytes: 100 * 1024 * 1024, warn_ratio: 0.9 },
    });
    const openId = frame.request("api.open", { fileId: "doc-1" });
    await waitFor(() => expect(frame.answerTo(openId)?.payload).toBeDefined());
    expect(frame.answerTo(openId)?.payload).toMatchObject({
      file: FILE,
      limits: { max_bytes: 100 * 1024 * 1024, warn_ratio: 0.9 },
    });
  });

  it("calls onError when the frame replies with an error to doc.download (R1-3)", async () => {
    const frame = setup();
    await frame.boot();
    act(() => { frame.hook.result.current.downloadCopy(); });
    expect(frame.sent("doc.download")).toHaveLength(1);
    const req = frame.sent("doc.download")[0]!;
    await frame.respondError(req, { code: "unknown_type", message: "no handler for doc.download" });
    await waitFor(() => expect(frame.onError).toHaveBeenCalledTimes(1));
    expect(frame.onError.mock.calls[0]![0]).toMatchObject({ code: "unknown_type", message: "no handler for doc.download" });
  });

  it("ignores a second downloadCopy click while pending and times out to onError when the frame does not reply (R1-3)", async () => {
    const frame = setup();
    await frame.boot();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => {
      frame.hook.result.current.downloadCopy();
      frame.hook.result.current.downloadCopy();
    });
    expect(frame.sent("doc.download")).toHaveLength(1);
    await advance(29_999);
    expect(frame.onError).not.toHaveBeenCalled();
    await advance(1);
    expect(frame.onError).toHaveBeenCalledTimes(1);
    expect(frame.onError.mock.calls[0]![0]).toMatchObject({ code: "timeout", retryable: true });

    // Once settled, a subsequent click sends a new request.
    act(() => { frame.hook.result.current.downloadCopy(); });
    expect(frame.sent("doc.download")).toHaveLength(2);
    await frame.respond(frame.sent("doc.download")[1]!, { delivered: true });
    await settle();
    expect(frame.onError).toHaveBeenCalledTimes(1);
  });
});

describe("useDocsFrameSession: a source file session (UNI-1869)", () => {
  const sourceRef = { kind: "source" as const, id: SOURCE_ID };

  it("mints on the source route, opens view-only and never offers a write or host extra", async () => {
    const frame = setup({ fileRef: sourceRef });
    await frame.boot();
    expect(requestMock.mock.calls.some(([path]) => path === SOURCE_MINT_PATH)).toBe(true);
    expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(false);
    const init = frame.sent("init")[0]?.payload as {
      documentId: string; token: string;
      capabilities: { comments?: boolean } & Record<string, boolean>;
      user?: unknown; recovery?: unknown; commentsLevel?: unknown;
    };
    expect(init.token).toBe("ofs1.tok");
    expect(init.documentId).toBe(SOURCE_ID);
    // A source frame can look and print only: every write, export, asset, AI and
    // desktop/download capability is off by construction.
    expect(init.capabilities).toMatchObject({
      save: false, saveAs: false, recents: false, exportPdf: false, exportHtml: false,
      attachments: false, images: false, ai: false, uniworkAi: false,
      desktopOpen: false, download: false,
      print: true,
    });
    expect(init.capabilities.comments ?? false).toBe(false);
    expect(init.commentsLevel).toBeUndefined();
    expect(init.user).toBeUndefined();
    expect(init.recovery).toBeUndefined();
    expect(frame.hook.result.current.viewOnly).toBe(true);
  });

  it("refuses api.save and api.download even if a frame asks anyway", async () => {
    const frame = setup({ fileRef: sourceRef });
    await frame.boot();
    const saveId = frame.request("api.save", { fileId: SOURCE_ID, data: new ArrayBuffer(4), etag: "0" });
    await waitFor(() => expect(frame.answerTo(saveId)?.error?.code).toBe("forbidden"));
    const dlId = frame.request("api.download", { data: new ArrayBuffer(4) });
    await waitFor(() => expect(frame.answerTo(dlId)?.error?.code).toBe("forbidden"));
  });

  it("fails the session as not_found when the mint is refused", async () => {
    requestMock.mockImplementation((path: string) =>
      path === SOURCE_MINT_PATH
        ? Promise.reject(new ApiError("not found", "not_found", 404))
        : Promise.reject(new Error(`unexpected ${path}`)),
    );
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    // Built once: a fresh iframeRef per render would restart the session every render.
    const options: DocsFrameSessionOptions = {
      iframeRef: { current: iframe }, frameOrigin: window.location.origin, module: "docs", wsId: "ws-1", fileRef: sourceRef,
      readonly: false, locale: "vi", theme: "light", onError: vi.fn(), api: {} as DocsFrameApi,
    };
    const hook = renderHook(() => useDocsFrameSession(options), { wrapper });
    await waitFor(() => expect(hook.result.current.status).toBe("failed"));
    expect(hook.result.current.failure?.code).toBe("not_found");
  });

  it("makes no lock request and ignores an edit lock in scope: view-only, no lock id, no onLocked", async () => {
    const onLocked = vi.fn();
    const save = vi.fn();
    // A lock provider in scope (here: not held, which would lock a document out) must not touch a source.
    const frame = setup({ fileRef: sourceRef, editLock: { held: false, lockId: undefined, onLocked }, api: { save } as unknown as Partial<DocsFrameApi> });
    await frame.boot();
    expect(frame.hook.result.current.viewOnly).toBe(true);
    const id = frame.request("api.save", { fileId: SOURCE_ID, data: new ArrayBuffer(4), etag: "0" });
    await waitFor(() => expect(frame.answerTo(id)?.error?.code).toBe("forbidden"));
    expect(save).not.toHaveBeenCalled();
    expect(onLocked).not.toHaveBeenCalled();
    // The only transport calls are the source mint and the flag config: no documents/* lock route.
    const paths = requestMock.mock.calls.map(([path]) => String(path));
    expect(paths.filter((path) => !path.startsWith("/api/v1/config") && path !== SOURCE_MINT_PATH)).toEqual([]);
    expect(paths.some((path) => /lock/i.test(path))).toBe(false);
    // A lock arriving later never re-attaches a source frame.
    frame.options.editLock = { held: true, lockId: "L2", onLocked };
    frame.hook.rerender();
    expect(frame.hook.result.current.attempt).toBe(0);
  });
});

describe("useDocsFrameSession: the page's edit lock (UNI-1645, addendum §11.1)", () => {
  const lockOf = (held: boolean, onLocked = vi.fn()): FrameEditLock => ({ held, lockId: held ? "L1" : undefined, onLocked });

  it("is view-only while the page does not hold the lock: no save capability, a write is refused", async () => {
    const save = vi.fn();
    const frame = setup({ editLock: lockOf(false), api: { save } as unknown as Partial<DocsFrameApi> });
    await frame.boot();
    expect(frame.hook.result.current.viewOnly).toBe(true);
    expect(frame.sent("init")[0]?.payload).toMatchObject({ capabilities: { save: false } });
    const id = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4), etag: "7" });
    await waitFor(() => expect(frame.answerTo(id)?.error?.code).toBe("forbidden"));
    expect(save).not.toHaveBeenCalled();
  });

  it("commits with the held lock id", async () => {
    const save = vi.fn(async (_payload: unknown, _call: unknown) => ({ ok: true, file: FILE, versionId: "v2" }));
    const frame = setup({ editLock: lockOf(true), api: { save } as unknown as Partial<DocsFrameApi> });
    await frame.boot();
    expect(frame.hook.result.current.viewOnly).toBe(false);
    const id = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4), etag: "7" });
    await waitFor(() => expect(frame.answerTo(id)?.payload).toMatchObject({ ok: true }));
    expect(save.mock.calls[0]?.[1]).toMatchObject({ documentId: "doc-1", editLockId: "L1" });
  });

  it("423 on save flips the host lock state to lost: onLocked gets the holder, the frame a read-only refusal, never {ok:false}", async () => {
    const fields = { holder_id: "u2", holder_name: "An", held_by_me: false };
    const locked = new DocsProtocolError({ code: "forbidden", message: "document_locked (HTTP 423)", status: 423, details: { apiCode: "document_locked", fields } });
    const save = vi.fn(async () => { throw locked; });
    const onLocked = vi.fn();
    const frame = setup({ editLock: lockOf(true, onLocked), api: { save } as unknown as Partial<DocsFrameApi> });
    await frame.boot();
    const id = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4), etag: "7" });
    await waitFor(() => expect(frame.answerTo(id)?.error).toMatchObject({ code: "forbidden", status: 403 }));
    expect(frame.answerTo(id)?.payload).toBeUndefined();
    expect(onLocked).toHaveBeenCalledWith(fields);
    // The current pin advertises no editLock capability: no doc.editLock is sent (Q4).
    expect(frame.received.some((m) => m.type === "doc.editLock")).toBe(false);
  });

  it("re-attaches a frame that opened read-only once the lock is held, and only then", async () => {
    const frame = setup({ editLock: lockOf(false) });
    await frame.boot();
    expect(frame.hook.result.current.attempt).toBe(0);
    frame.options.editLock = lockOf(false);
    frame.hook.rerender();
    expect(frame.hook.result.current.attempt).toBe(0);
    frame.options.editLock = lockOf(true);
    frame.hook.rerender();
    await waitFor(() => expect(frame.hook.result.current.attempt).toBe(1));
    expect(frame.hook.result.current.viewOnly).toBe(false);
  });
});

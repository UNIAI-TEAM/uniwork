import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import type { Document } from "@uniwork/core/types/document";
import { PROTOCOL_NS, PROTOCOL_VERSION, isInitPayload, type Envelope, type OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { endOfficeDraftSession } from "@uniwork/core/office/draft-session-key";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrap } from "../../test/api-mock";
import { DocsFrameRefusalContext, useDocsFrameRefusal } from "./docs-frame-refusal";
import type { FrameDesktopOpenProps } from "./frame-desktop-open";
import { DropdownMenu, DropdownMenuContent } from "@uniwork/ui/components/ui/dropdown-menu";
import { HeaderActionsMenuItems, HeaderActionsSlot, HeaderActionsSlotProvider } from "../../layout/header-actions-slot";
import { leaveGuardAllows } from "../../navigation/leave-guard";
import { OfficeModuleFrame } from "./office-module-frame";
import { OfficeModuleOpenSwitch } from "./office-module-open-switch";
import { OfficeTooLargeProvider } from "../too-large-notice";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// Modules whose grant lacks `print` (RHP-3): every module in the table grants it today, so the
// host's narrowing is exercised by patching the grant for the modules this set names.
const printlessModules = vi.hoisted(() => new Set<string>());
vi.mock("@uniwork/core/office/office-modules", async (orig) => {
  const original = await orig<typeof import("@uniwork/core/office/office-modules")>();
  return {
    ...original,
    officeModuleSpec: (module: OfficeModule) => {
      const spec = original.officeModuleSpec(module);
      return printlessModules.has(module) ? { ...spec, grant: { ...spec.grant, print: false } } : spec;
    },
  };
});

const MINT_PATH = "/api/v1/documents/doc-1/office/frame-token";
const SOURCE_MINT_PATH = `/api/v1/workspaces/ws-1/documents/sources/${encodeURIComponent("chat:s-1")}/office/frame-token`;
const minted = {
  token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: true, module: "pdf",
};
const mintedSource = {
  token: "ofs1.tok", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  source_id: "chat:s-1", parent_kind: "chat_channel", parent_id: "c-1",
  workspace_id: "ws-1", organization_id: "org-1", can_edit: false, module: "docs", readonly: true,
};

let lastApi: DocsFrameApi | null = null;

function fullApi(): DocsFrameApi {
  return {
    open: vi.fn(), save: vi.fn(), recents: vi.fn(), saveAs: vi.fn(), export: vi.fn(), addAttachments: vi.fn(), uploadImage: vi.fn(),
  } as unknown as DocsFrameApi;
}

function mountFrame(module: OfficeModule, { canEdit = true, readonly = false, tokenModule = module, mint, refuse, desktopOpen, inHeader = false, menu = false, fileActions = false, onFrameCommentsChange, onSessionFailure, ackComments = false, ackCapabilities, fileRef, myLevel, documentDetail, extraRoutes }: { ackCapabilities?: Record<string, boolean>; onFrameCommentsChange?: (framePanel: boolean) => void; onSessionFailure?: (failure: unknown) => void; ackComments?: boolean; inHeader?: boolean; /** Render the header's overflow menu so the frame's contributed items can be clicked. */ menu?: boolean; canEdit?: boolean; readonly?: boolean; tokenModule?: string; mint?: () => Promise<unknown>; refuse?: () => void; desktopOpen?: FrameDesktopOpenProps; fileActions?: boolean | "download_only"; fileRef?: { kind: "document" | "source"; id: string }; myLevel?: string | null; documentDetail?: Document; extraRoutes?: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown> | undefined } = {}) {
  const ref = fileRef ?? { kind: "document" as const, id: "doc-1" };
  requestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    const routed = extraRoutes?.(path, init);
    if (routed !== undefined) return routed;
    return path === MINT_PATH ? (mint?.() ?? Promise.resolve({ ...minted, can_edit: canEdit, module: tokenModule })) : path === SOURCE_MINT_PATH ? Promise.resolve({ ...mintedSource, module: tokenModule }) : Promise.reject(new Error(`unexpected ${init?.method ?? "GET"} ${path}`));
  });
  lastApi = fullApi();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const bare = <OfficeModuleFrame module={module} wsId="ws-1" fileRef={ref} title="Scan" frameVersion="1.0.0" api={lastApi} readonly={readonly} myLevel={myLevel} desktopOpen={desktopOpen} onFrameCommentsChange={onFrameCommentsChange} onSessionFailure={onSessionFailure} documentDetail={documentDetail} />;
  const framed = fileActions
    ? <OfficeTooLargeProvider value={{ desktopAction: fileActions === "download_only" ? null : <button type="button">Mở trong UniWork Office</button>, onDownload: vi.fn() }}>{bare}</OfficeTooLargeProvider>
    : bare;
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider defaultTheme="light" enableSystem={false}>
        <DocsFrameRefusalContext.Provider value={refuse ?? null}>
          {inHeader ? (
            <HeaderActionsSlotProvider>
              {menu ? <DropdownMenu open><DropdownMenuContent><HeaderActionsMenuItems /></DropdownMenuContent></DropdownMenu> : null}
              <HeaderActionsSlot />
              {framed}
            </HeaderActionsSlotProvider>
          ) : framed}
        </DocsFrameRefusalContext.Provider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const iframe = screen.getByTestId("office-docs-frame-iframe") as HTMLIFrameElement;
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
      queueMicrotask(() => { void post(envelope("response", "init", { protocolVersion: 1, capabilities: ackCapabilities ?? (ackComments ? { comments: true } : {}) }, m.id)); });
    }
  });
  return {
    received,
    iframe,
    unmount: () => view.unmount(),
    event: (type: string, payload: unknown) => post(envelope("event", type, payload)),
    ready: (payload: Record<string, unknown>) => post(envelope("event", "ready", { protocolVersion: 1, capabilities: {}, ...payload })),
    inits: () => received.filter((m) => m.kind === "request" && m.type === "init"),
    sent: (type: string) => received.filter((m) => m.kind === "request" && m.type === type),
    respondError: (to: Envelope, error: Envelope["error"]) =>
      post({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: to.id, kind: "response", type: to.type, error }),
    request: (type: string, payload: unknown) => { const e = envelope("request", type, payload); void post(e); return e.id; },
    answerTo: (id: string) => received.find((m) => m.kind === "response" && m.id === id),
    respond: (to: Envelope, payload: unknown) =>
      post({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: to.id, kind: "response", type: to.type, payload }),
  };
}

afterEach(async () => { printlessModules.clear(); requestMock.mockReset(); toast.error.mockReset(); toast.success.mockReset(); toast.dismiss.mockReset(); resetAuthStoreForTests(); await endOfficeDraftSession(); });

describe("OfficeModuleFrame", () => {
  it("serves the module's build and grants it only what its frame implements", async () => {
    const frame = mountFrame("pdf");
    expect(frame.iframe.getAttribute("src")).toBe("/office-frame/pdf/1.0.0/index.html");
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(true));
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).not.toHaveProperty("profile");
    expect(frame.inits()[0]?.payload).toMatchObject({
      module: "pdf", documentId: "doc-1", token: "tok-1",
      capabilities: { save: true, saveAs: true, recents: false, print: true, exportPdf: false, exportHtml: false, attachments: false, images: false, ai: false },
    });
  });

  it("opens a source file view-only on the source token, with no write or host extra granted", async () => {
    const frame = mountFrame("docs", { fileRef: { kind: "source", id: "chat:s-1" } });
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === SOURCE_MINT_PATH)).toBe(true));
    expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(false);
    await frame.ready({ module: "docs" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    const init = frame.inits()[0]?.payload as { documentId?: string; token?: string; capabilities?: { comments?: boolean } & Record<string, boolean> };
    expect(init).toMatchObject({
      documentId: "chat:s-1",
      token: "ofs1.tok",
      profile: "readOnly",
      capabilities: { save: false, saveAs: false, recents: false, exportPdf: false, exportHtml: false, attachments: false, images: false, ai: false, desktopOpen: false, download: false },
    });
    // No comments claim and no save control for a read-only source.
    expect(init?.capabilities?.comments ?? false).toBe(false);
    expect(screen.queryByLabelText("Lưu vào UniWork")).toBeNull();
  });

  it("refuses save, saveAs, export, attachments, images, and download from a view-only source frame with no server call and a view-only toast", async () => {
    const frame = mountFrame("docs", { fileRef: { kind: "source", id: "chat:s-1" } });
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === SOURCE_MINT_PATH)).toBe(true));
    await frame.ready({ module: "docs" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    requestMock.mockClear();

    const requests: [string, unknown][] = [
      ["api.save", { fileId: "chat:s-1", data: new ArrayBuffer(1), etag: "0" }],
      ["api.saveAs", { fileId: "chat:s-1", name: "Copy.docx", data: new ArrayBuffer(1) }],
      ["api.export", { fileId: "chat:s-1", format: "pdf" }],
      ["api.export", { fileId: "chat:s-1", format: "html" }],
      ["api.attachments.add", { files: [{ name: "a.bin", mimeType: "application/octet-stream", data: new ArrayBuffer(1) }] }],
      ["api.images.upload", { fileId: "chat:s-1", name: "img.png", mimeType: "image/png", data: new ArrayBuffer(1) }],
      ["api.download", { data: new ArrayBuffer(1) }],
    ];
    for (const [type, payload] of requests) {
      toast.error.mockClear();
      const id = frame.request(type, payload);
      await waitFor(() => expect(frame.answerTo(id)?.error?.code).toBe("forbidden"));
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith(
        type === "api.export" ? "Tệp này chỉ xem, không xuất được." : "Tệp này chỉ xem, không lưu được.",
      );
    }
    expect(requestMock).not.toHaveBeenCalled();
    expect(lastApi?.save).not.toHaveBeenCalled();
    expect(lastApi?.saveAs).not.toHaveBeenCalled();
    expect(lastApi?.export).not.toHaveBeenCalled();
    expect(lastApi?.addAttachments).not.toHaveBeenCalled();
    expect(lastApi?.uploadImage).not.toHaveBeenCalled();
  });

  it("still toasts a failed print in a source view while suppressing only fatal frame errors when onSessionFailure is set (F2)", async () => {
    const onSessionFailure = vi.fn();
    const frame = mountFrame("docs", { fileRef: { kind: "source", id: "chat:s-1" }, onSessionFailure });
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === SOURCE_MINT_PATH)).toBe(true));
    await frame.ready({ module: "docs" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    await waitFor(() => expect(document.querySelector("[data-office-docs-frame]")).toHaveAttribute("data-state", "ready"));

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(frame.sent("print")).toHaveLength(1));
    await frame.respondError(frame.sent("print")[0]!, { code: "internal", message: "print failed" });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith("Trình soạn thảo tài liệu gặp lỗi.");
    expect(onSessionFailure).not.toHaveBeenCalled();

    toast.error.mockClear();
    await frame.event("error", { error: { code: "not_found", message: "not found" }, fatal: true });
    await waitFor(() => expect(onSessionFailure).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("adds Print to the page menu only once a print-capable frame is ready, for a viewer too", async () => {
    const frame = mountFrame("markdown", { inHeader: true, menu: true });
    expect(screen.queryByRole("menuitem", { name: "In" })).toBeNull();
    await frame.ready({ module: "markdown" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(await screen.findByRole("menuitem", { name: "In" })).toBeInTheDocument();
    cleanup();

    // A view-only reader still may print (the readOnly grant keeps `print`).
    const viewer = mountFrame("markdown", { canEdit: false, inHeader: true, menu: true });
    await viewer.ready({ module: "markdown" });
    await waitFor(() => expect(viewer.inits()).toHaveLength(1));
    expect(await screen.findByRole("menuitem", { name: "In" })).toBeInTheDocument();
  });

  it("prints once per menu click, staying disabled while that print is open", async () => {
    const frame = mountFrame("sheets", { inHeader: true, menu: true });
    await frame.ready({ module: "sheets" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    await screen.findByRole("menuitem", { name: "In" });

    fireEvent.click(screen.getByRole("menuitem", { name: "In" }));
    await waitFor(() => expect(frame.sent("print")).toHaveLength(1));
    expect(frame.sent("print")[0]?.payload).toMatchObject({ mode: "dialog" });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "In" })).toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(screen.getByRole("menuitem", { name: "In" }));
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    expect(frame.sent("print")).toHaveLength(1);

    await frame.respond(frame.sent("print")[0]!, { printed: true });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "In" })).not.toHaveAttribute("aria-disabled", "true"));
  });

  it("sends the frame one print for repeated Ctrl+P while the first is still open", async () => {
    const frame = mountFrame("markdown");
    await frame.ready({ module: "markdown" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    await waitFor(() => expect(document.querySelector("[data-office-docs-frame]")).toHaveAttribute("data-state", "ready"));

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(frame.sent("print")).toHaveLength(1));
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    // Let a second request post if one is coming: the dedupe must hold past a macrotask.
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    expect(frame.sent("print")).toHaveLength(1);

    // A next press after the answer prints again: the dedupe is only for the open print.
    await frame.respond(frame.sent("print")[0]!, { printed: true });
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(frame.sent("print")).toHaveLength(2));
  });

  it("shows no Print entry for a read-only source viewer", async () => {
    const frame = mountFrame("markdown", { fileRef: { kind: "source", id: "chat:s-1" }, inHeader: true, menu: true });
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === SOURCE_MINT_PATH)).toBe(true));
    await frame.ready({ module: "markdown" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    await waitFor(() => expect(document.querySelector("[data-office-docs-frame]")).toHaveAttribute("data-state", "ready"));
    expect(screen.queryByRole("menuitem", { name: "In" })).toBeNull();
  });

  it("offers no Print for a module whose grant drops `print`, and Ctrl+P stays the browser's (RHP-3)", async () => {
    printlessModules.add("markdown");
    const frame = mountFrame("markdown", { inHeader: true, menu: true });
    await frame.ready({ module: "markdown" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({ capabilities: { print: false } });
    await waitFor(() => expect(document.querySelector("[data-office-docs-frame]")).toHaveAttribute("data-state", "ready"));

    expect(screen.queryByRole("menuitem", { name: "In" })).toBeNull();
    const press = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, cancelable: true });
    act(() => { window.dispatchEvent(press); });
    expect(press.defaultPrevented).toBe(false);
    expect(frame.sent("print")).toHaveLength(0);
  });

  it("re-enables Print after the frame refuses it, and the next click prints again (RHP-3)", async () => {
    const frame = mountFrame("sheets", { inHeader: true, menu: true });
    await frame.ready({ module: "sheets" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    await screen.findByRole("menuitem", { name: "In" });

    fireEvent.click(screen.getByRole("menuitem", { name: "In" }));
    await waitFor(() => expect(frame.sent("print")).toHaveLength(1));
    await frame.respondError(frame.sent("print")[0]!, { code: "cancelled", message: "user closed the dialog" });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "In" })).not.toHaveAttribute("aria-disabled", "true"));

    fireEvent.click(screen.getByRole("menuitem", { name: "In" }));
    await waitFor(() => expect(frame.sent("print")).toHaveLength(2));
    await frame.respond(frame.sent("print")[1]!, { printed: true });
  });


  it("takes back its comments claim when the frame unmounts, so the page's own panel returns", async () => {
    const onFrameCommentsChange = vi.fn();
    const frame = mountFrame("pdf", { onFrameCommentsChange, ackComments: true });
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(onFrameCommentsChange).toHaveBeenLastCalledWith(true));
    frame.unmount();
    expect(onFrameCommentsChange).toHaveBeenLastCalledWith(false);
  });

  it("gives the claim back when the frame fails, so the page's own panel returns beside the error", async () => {
    const onFrameCommentsChange = vi.fn();
    const frame = mountFrame("pdf", { onFrameCommentsChange, ackComments: true });
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(onFrameCommentsChange).toHaveBeenLastCalledWith(true));
    await frame.event("error", { error: { code: "internal", message: "boom" }, fatal: true });
    await waitFor(() => expect(onFrameCommentsChange).toHaveBeenLastCalledWith(false));
  });

  it("names the signed-in user to the editor", async () => {
    setSessionUser({ id: "u-1", email: "an@example.test", display_name: "Nguyễn An" } as Parameters<typeof setSessionUser>[0]);
    const frame = mountFrame("markdown");
    await frame.ready({ module: "markdown" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    // images (UNI-1232): pasted pictures upload as document assets through api.images.upload.
    expect(frame.inits()[0]?.payload).toMatchObject({ user: { displayName: "Nguyễn An" }, capabilities: { exportHtml: true, save: true, images: true } });
  });

  const ALL_MODULES: OfficeModule[] = ["docs", "pdf", "markdown", "html", "slides", "sheets"];

  const mintWithAI = (module: OfficeModule, ai: unknown) => () => Promise.resolve({ ...minted, module, ai });

  it.each(ALL_MODULES)("grants the %s frame AI as far as the minted token's grant", async (module) => {
    const frame = mountFrame(module, { mint: mintWithAI(module, { ai: true, web_search: true, image_search: false, image_generation: true }) });
    await frame.ready({ module });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({ capabilities: { ai: true, webSearch: true, imageSearch: false, imageGeneration: true } });
  });

  it("keeps AI off for a token without AI and for a malformed grant", async () => {
    const cases: [OfficeModule, unknown][] = [
      ["pdf", { ai: false, web_search: true, image_search: true, image_generation: true }],
      ["markdown", "yes"],
      ["html", undefined],
    ];
    for (const [module, ai] of cases) {
      const frame = mountFrame(module, { mint: mintWithAI(module, ai) });
      await frame.ready({ module });
      await waitFor(() => expect(frame.inits()).toHaveLength(1));
      expect(frame.inits()[0]?.payload).toMatchObject({ capabilities: { ai: false, webSearch: false, imageSearch: false, imageGeneration: false } });
      cleanup();
    }
  });

  // G6-05: UniWork AI is its own grant (`uniwork_ai`), independent of BYOK `ai`; the cloud tools
  // follow their grants under either one, so an organization with only UniWork AI still gets them.
  it.each(ALL_MODULES)("grants the %s frame uniworkAi and the cloud tools from a uniwork_ai grant alone", async (module) => {
    const frame = mountFrame(module, { mint: mintWithAI(module, { ai: false, web_search: true, image_search: false, image_generation: true, uniwork_ai: true }) });
    await frame.ready({ module });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({ capabilities: { ai: false, uniworkAi: true, webSearch: true, imageSearch: false, imageGeneration: true } });
  });

  // G6-05 task 2: the six frames still pinned at web-0.1.0-06d77a2 list `uniworkAi` in their protocol keys but
  // claim it false (their host-claim table), so effective = host grant AND frame claim = false in the ack. The
  // grant is neither a handshake failure nor a hash check at runtime: the session stays up.
  it("stays up when the pinned frame answers a uniworkAi grant with its own uniworkAi: false claim", async () => {
    const frame = mountFrame("pdf", {
      mint: mintWithAI("pdf", { ai: true, web_search: false, image_search: false, image_generation: false, uniwork_ai: true }),
      ackCapabilities: { ai: true, webSearch: true, imageSearch: true, imageGeneration: true, uniworkAi: false, desktopOpen: true, download: true },
    });
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({ capabilities: { ai: true, uniworkAi: true } });
    await waitFor(() => expect(screen.queryByTestId("office-docs-frame-loading")).toBeNull());
    expect(screen.queryByTestId("office-docs-frame-failed")).toBeNull();
    expect(frame.iframe).toBeInTheDocument();
  });

  it("keeps uniworkAi off without the grant, with a drifted one, and keeps cloud tools off without either AI", async () => {
    const cases: [OfficeModule, unknown][] = [
      ["pdf", { ai: true, web_search: true, image_search: true, image_generation: true }],
      ["markdown", { ai: true, web_search: false, image_search: false, image_generation: false, uniwork_ai: "yes" }],
      ["html", { ai: false, web_search: true, image_search: true, image_generation: true, uniwork_ai: false }],
      ["slides", undefined],
    ];
    for (const [module, ai] of cases) {
      const frame = mountFrame(module, { mint: mintWithAI(module, ai) });
      await frame.ready({ module });
      await waitFor(() => expect(frame.inits()).toHaveLength(1));
      const caps = (frame.inits()[0]?.payload as { capabilities: Record<string, boolean> }).capabilities;
      expect(caps.uniworkAi).toBeFalsy();
      if (module !== "pdf" && module !== "markdown") expect([caps.webSearch, caps.imageSearch, caps.imageGeneration]).toEqual([false, false, false]);
      cleanup();
    }
  });

  it("keeps AI for a view-only user, who still cannot save", async () => {
    const frame = mountFrame("pdf", { mint: () => Promise.resolve({ ...minted, can_edit: false, ai: { ai: true, web_search: false, image_search: false, image_generation: false } }) });
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({ capabilities: { ai: true, webSearch: false, save: false, saveAs: false } });
  });

  it.each(ALL_MODULES)("hands the %s frame the session's draft-recovery key and the user:document scope", async (module) => {
    setSessionUser({ id: "u-1", email: "an@example.test", display_name: "An" } as Parameters<typeof setSessionUser>[0]);
    const frame = mountFrame(module);
    await frame.ready({ module, instanceId: "load-1" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    const recovery = (frame.inits()[0]?.payload as { recovery?: { key: CryptoKey; scope: string } }).recovery;
    expect(recovery?.scope).toBe("u-1:doc-1");
    expect(recovery?.key).toBeInstanceOf(CryptoKey);
    expect(recovery?.key.extractable).toBe(false);
    expect(isInitPayload(frame.inits()[0]?.payload)).toBe(true);
    // A frame reload (a new instance) gets a fresh init with the same key: its drafts stay readable.
    await frame.ready({ module, instanceId: "load-2" });
    await waitFor(() => expect(frame.inits()).toHaveLength(2));
    const again = (frame.inits()[1]?.payload as { recovery?: { key: CryptoKey; scope: string } }).recovery;
    expect(again?.key).toBe(recovery?.key);
    expect(again?.scope).toBe("u-1:doc-1");
  });

  it("sends no recovery to a view-only user or without a signed-in user", async () => {
    setSessionUser({ id: "u-1", email: "an@example.test", display_name: "An" } as Parameters<typeof setSessionUser>[0]);
    const viewer = mountFrame("pdf", { canEdit: false });
    await viewer.ready({ module: "pdf" });
    await waitFor(() => expect(viewer.inits()).toHaveLength(1));
    expect(viewer.inits()[0]?.payload).not.toHaveProperty("recovery");
    cleanup();
    resetAuthStoreForTests();
    const anon = mountFrame("pdf");
    await anon.ready({ module: "pdf" });
    await waitFor(() => expect(anon.inits()).toHaveLength(1));
    expect(anon.inits()[0]?.payload).not.toHaveProperty("recovery");
  });

  it.each([
    ["the page says readonly", { readonly: true }],
    ["the minted token cannot edit", { canEdit: false }],
  ])("gives a view-only user the frame without save or save-as when %s", async (_why, opts) => {
    const frame = mountFrame("pdf", opts);
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(true));
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({ profile: "readOnly", capabilities: { save: false, saveAs: false, print: true } });
  });

  it("keeps comments for a comment-level user the host mounted read-only (SVH-1): no profile, commentsLevel 'comment'", async () => {
    // The document page mounts the frame with readonly={!canEdit}, so a commenter arrives
    // with readonly: true on top of can_edit: false; the init must still keep their level.
    const frame = mountFrame("docs", { readonly: true, canEdit: false, myLevel: "comment" });
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(true));
    await frame.ready({ module: "docs" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    const init = frame.inits()[0]?.payload as { profile?: string; commentsLevel?: string; capabilities?: Record<string, boolean> };
    expect(init.profile).toBeUndefined();
    expect(init.commentsLevel).toBe("comment");
    expect(init.capabilities).toMatchObject({ comments: true, save: false, saveAs: false });
  });

  it("refuses the writes of a user whose minted token cannot edit, though the page is not readonly", async () => {
    const frame = mountFrame("markdown", { canEdit: false });
    await frame.ready({ module: "markdown" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    const id = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(1) });
    await waitFor(() => expect(frame.answerTo(id)?.error?.code).toBe("forbidden"));
    expect(lastApi?.save).not.toHaveBeenCalled();
    // A viewer gets no picture upload either (its relative pictures still resolve through open).
    expect(frame.inits()[0]?.payload).toMatchObject({ capabilities: { images: false } });
    const upload = frame.request("api.images.upload", { fileId: "doc-1", name: "image-1.png", mimeType: "image/png", data: new ArrayBuffer(1) });
    await waitFor(() => expect(frame.answerTo(upload)?.error?.code).toBe("forbidden"));
    expect(lastApi?.uploadImage).not.toHaveBeenCalled();
  });

  // A1b (UNI-1232): fresh URLs for the open answer's paths and URLs of paths typed after the open.
  it("answers api.assets.resolve through the API with the frame's own token, a viewer included", async () => {
    const frame = mountFrame("markdown", { canEdit: false });
    await frame.ready({ module: "markdown" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    const assets = { "a.png": "/api/v1/office-frame/documents/01J8X4DOC0N1P2Q3R4S5T6U7V8/linked/01J8X4LNK0N1P2Q3R4S5T6U7V8?sig=ofl1.x.y" };
    const resolveAssets = vi.fn().mockResolvedValue({ assets });
    (lastApi as { resolveAssets?: unknown }).resolveAssets = resolveAssets;
    const id = frame.request("api.assets.resolve", { fileId: "doc-1", paths: ["a.png", "./typed.png"] });
    await waitFor(() => expect(frame.answerTo(id)?.payload).toEqual({ assets }));
    expect(resolveAssets).toHaveBeenCalledWith({ fileId: "doc-1", paths: ["a.png", "./typed.png"] }, expect.objectContaining({ workspaceId: "ws-1", documentId: "doc-1", token: "tok-1" }));
  });

  it("answers api.assets.resolve unsupported from a host API without it, and malformed when out of bounds", async () => {
    const frame = mountFrame("markdown");
    await frame.ready({ module: "markdown" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    const unsupported = frame.request("api.assets.resolve", { paths: ["a.png"] });
    await waitFor(() => expect(frame.answerTo(unsupported)?.error?.code).toBe("unsupported"));
    const resolveAssets = vi.fn();
    (lastApi as { resolveAssets?: unknown }).resolveAssets = resolveAssets;
    for (const paths of [[], Array.from({ length: 51 }, (_, i) => `p${i}.png`), [""]]) {
      const bad = frame.request("api.assets.resolve", { paths });
      await waitFor(() => expect(frame.answerTo(bad)?.error?.code).toBe("malformed"));
    }
    expect(resolveAssets).not.toHaveBeenCalled();
  });

  it("fails with a retry, and no init, when the server minted another module than the frame", async () => {
    const refuse = vi.fn();
    const frame = mountFrame("markdown", { refuse, tokenModule: "sheets" });
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(true));
    await frame.ready({ module: "markdown" });
    expect(await screen.findByTestId("office-docs-frame-failed")).toHaveAttribute("data-failure-kind", "failed");
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
    expect(refuse).not.toHaveBeenCalled();
    expect(frame.inits()).toHaveLength(0);
  });

  it("accepts a token without module from an older server", async () => {
    const frame = mountFrame("pdf", { tokenModule: undefined, mint: () => Promise.resolve({ ...minted, module: undefined }) });
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
  });

  it("refuses a frame that runs another module's editor before any init", async () => {
    const frame = mountFrame("pdf");
    // A Docs bundle says ready without a module (= docs).
    await frame.ready({});
    expect(await screen.findByTestId("office-docs-frame-failed")).toBeTruthy();
    expect(frame.inits()).toHaveLength(0);
  });

  it("asks the switch for the too-large notice when the server refuses a workbook as too large (413)", async () => {
    const refuse = vi.fn();
    mountFrame("sheets", { refuse, mint: () => Promise.reject(new ApiError("document is too large for the web frame", "too_large", 413)) });
    // "size" makes the switch show the open-in-the-app notice instead of an editor.
    await waitFor(() => expect(refuse).toHaveBeenCalledTimes(1));
  });

  it("asks the switch for the too-large notice when the Sheets frame refuses a workbook as too_large", async () => {
    const refuse = vi.fn();
    const frame = mountFrame("sheets", { refuse });
    await frame.ready({ module: "sheets" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(refuse).not.toHaveBeenCalled();
    await frame.event("error", { error: { code: "too_large", message: "worksheet XML over 40 MB" }, fatal: true });
    await waitFor(() => expect(refuse).toHaveBeenCalledTimes(1));
  });

  it.each([
    [true, "Hãy mở tệp trong UniWork Office hoặc tải xuống."],
    ["download_only", "Hãy tải tệp xuống."],
  ] as const)("words a turned-off module for the actions the host offers (%s)", async (fileActions, sentence) => {
    mountFrame("pdf", { fileActions, mint: () => Promise.reject(new ApiError("feature is disabled", "feature_disabled", 403)) });
    const failed = await screen.findByTestId("office-docs-frame-failed");
    expect(failed).toHaveAttribute("data-failure-kind", "unavailable");
    expect(failed).toHaveTextContent(sentence);
    expect(screen.getByRole("button", { name: "Tải xuống" })).toBeInTheDocument();
  });

  it("does not ask for the too-large notice for too_large in a module without a size cap", async () => {
    const refuse = vi.fn();
    mountFrame("pdf", { refuse, mint: () => Promise.reject(new ApiError("too large", "too_large", 413)) });
    expect(await screen.findByTestId("office-docs-frame-failed")).toBeTruthy();
    expect(refuse).not.toHaveBeenCalled();
  });

  it("keeps the save state in the page header at phone width once there is something to say", async () => {
    const frame = mountFrame("slides", { inHeader: true });
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(true));
    await frame.ready({ module: "slides" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    const chip = () => document.querySelector("[data-header-actions-slot] [data-testid^='office-save-']")!;
    // Idle: hidden below sm, shown from sm up.
    await waitFor(() => expect(chip()).toHaveClass("hidden", "sm:flex"));
    await frame.event("dirty", { dirty: true });
    await waitFor(() => expect(chip()).toHaveClass("flex"));
    expect(chip()).not.toHaveClass("hidden");
    expect(chip()).toHaveTextContent("Chưa lưu");
  });

  describe("a frame bundle that never loads (404/5xx on index.html)", () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

    it.each(["docs", "pdf", "markdown", "html", "slides", "sheets"] as const)("fails fast with the load error for %s when the bundle answers 404, never the switch", async (module) => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 404 })));
      const refuse = vi.fn();
      mountFrame(module, { refuse });
      expect(await screen.findByTestId("office-docs-frame-failed")).toHaveAttribute("data-failure-kind", "load");
      expect(screen.queryByTestId("office-docs-frame-loading")).toBeNull();
      expect(refuse).not.toHaveBeenCalled();
    });

    it("shows a styled retryable error, not the skeleton, with the host's open-in-app and download", async () => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 503 })));
      mountFrame("slides", { fileActions: true });
      const failed = await screen.findByTestId("office-docs-frame-failed");
      expect(failed).toHaveTextContent("Không tải được trình soạn thảo");
      expect(failed).toHaveTextContent("Hãy thử lại, mở tệp trong UniWork Office hoặc tải xuống.");
      expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Mở trong UniWork Office" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tải xuống" })).toBeInTheDocument();
      expect(document.querySelector("[data-office-docs-frame]")).toHaveAttribute("data-state", "failed");
    });

    it("words the load error for Download alone when the host offers no desktop launch", async () => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 503 })));
      mountFrame("slides", { fileActions: "download_only" });
      const failed = await screen.findByTestId("office-docs-frame-failed");
      expect(failed).toHaveTextContent("Hãy thử lại hoặc tải tệp xuống.");
      expect(failed).not.toHaveTextContent("UniWork Office");
      expect(screen.queryByRole("button", { name: "Mở trong UniWork Office" })).toBeNull();
      expect(screen.getByRole("button", { name: "Tải xuống" })).toBeInTheDocument();
    });

    it("keeps booting when the probe answers 200 or cannot run", async () => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200 })));
      const refuse = vi.fn();
      mountFrame("html", { refuse });
      await waitFor(() => expect(fetch).toHaveBeenCalledWith("/office-frame/html/1.0.0/index.html", expect.anything()));
      expect(screen.queryByTestId("office-docs-frame-failed")).toBeNull();
      expect(refuse).not.toHaveBeenCalled();
    });

    it("fails when the frame never completes its handshake in time", async () => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200 })));
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const refuse = vi.fn();
      mountFrame("slides", { refuse });
      await act(async () => { vi.advanceTimersByTime(24_000); });
      expect(screen.queryByTestId("office-docs-frame-failed")).toBeNull();
      await act(async () => { vi.advanceTimersByTime(2_000); });
      expect(screen.getByTestId("office-docs-frame-failed")).toHaveAttribute("data-failure-kind", "load");
      expect(refuse).not.toHaveBeenCalled();
    });

    describe("an open that takes longer than usual", () => {
      it("explains the wait after 8 s and offers a retry that restarts it", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200 })));
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const refuse = vi.fn();
        mountFrame("sheets", { refuse });
        await act(async () => { vi.advanceTimersByTime(7_000); });
        expect(screen.queryByTestId("office-docs-frame-slow")).toBeNull();
        expect(screen.getByTestId("office-docs-frame-loading")).toBeInTheDocument();
        await act(async () => { vi.advanceTimersByTime(2_000); });
        const slow = screen.getByTestId("office-docs-frame-slow");
        expect(slow).toHaveTextContent("Trình soạn thảo đang mở lâu hơn bình thường");
        expect(screen.queryByTestId("office-docs-frame-loading")).toBeNull();
        act(() => { screen.getByRole("button", { name: "Thử lại" }).click(); });
        expect(refuse).not.toHaveBeenCalled();
        expect(screen.queryByTestId("office-docs-frame-slow")).toBeNull();
        expect(screen.getByTestId("office-docs-frame-loading")).toBeInTheDocument();
      });

      it("offers the host's open-in-app and download while it waits, not only after the timeout", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200 })));
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        mountFrame("docs", { fileActions: true });
        await act(async () => { vi.advanceTimersByTime(9_000); });
        const slow = screen.getByTestId("office-docs-frame-slow");
        const buttons = Array.from(slow.querySelectorAll("button")).map((button) => button.textContent);
        expect(buttons).toEqual(["Thử lại", "Mở trong UniWork Office", "Tải xuống"]);
      });

      it("drops the slow state once the frame is ready", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200 })));
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const frame = mountFrame("pdf");
        await act(async () => { vi.advanceTimersByTime(9_000); });
        expect(screen.getByTestId("office-docs-frame-slow")).toBeInTheDocument();
        await frame.ready({ module: "pdf" });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(screen.queryByTestId("office-docs-frame-slow")).toBeNull();
        expect(document.querySelector("[data-office-docs-frame]")).toHaveAttribute("data-state", "ready");
      });
    });

    describe("a frame script that fails to load", () => {
      // The frame document loads, one of its module scripts does not: the iframe still fires `load`.
      const loadFrameWithScript = (frame: ReturnType<typeof mountFrame>) => {
        // jsdom does not load the frame document: give it the one script the real bundle has.
        const doc = { querySelectorAll: () => [{ src: "http://localhost:3000/office-frame/pdf/1.0.0/assets/index-abc.js" }] };
        Object.defineProperty(frame.iframe, "contentDocument", { configurable: true, get: () => doc });
        act(() => { frame.iframe.dispatchEvent(new Event("load")); });
      };

      it.each([
        ["a 404", () => Promise.resolve({ status: 404 })],
        ["a blocked request", () => Promise.reject(new TypeError("Failed to fetch"))],
      ])("fails at once with the load error on %s", async (_name, answer) => {
        vi.stubGlobal("fetch", vi.fn((url: string) => (url.endsWith("index.html") ? Promise.resolve({ status: 200 }) : answer())));
        const frame = mountFrame("pdf");
        loadFrameWithScript(frame);
        await waitFor(() => expect(screen.queryByTestId("office-docs-frame-failed")).not.toBeNull());
        expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/office-frame/pdf/1.0.0/assets/index-abc.js"), expect.objectContaining({ cache: "force-cache" }));
        expect(await screen.findByTestId("office-docs-frame-failed")).toHaveAttribute("data-failure-kind", "load");
      });

      it("leaves a script that loaded alone", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200 })));
        const refuse = vi.fn();
        const frame = mountFrame("pdf", { refuse });
        loadFrameWithScript(frame);
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        await act(async () => { await Promise.resolve(); });
        expect(refuse).not.toHaveBeenCalled();
        expect(screen.queryByTestId("office-docs-frame-failed")).toBeNull();
      });
    });

    it("stops the clock once the handshake completes", async () => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200 })));
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const frame = mountFrame("pdf");
      await act(async () => { await Promise.resolve(); });
      await frame.ready({ module: "pdf" });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { vi.advanceTimersByTime(120_000); });
      expect(screen.queryByTestId("office-docs-frame-failed")).toBeNull();
      expect(document.querySelector("[data-office-docs-frame]")).toHaveAttribute("data-state", "ready");
    });
  });

  it("keeps the Docs grant for docs", async () => {
    const frame = mountFrame("docs");
    expect(frame.iframe.getAttribute("src")).toBe("/office-frame/docs/1.0.0/index.html");
    await frame.ready({});
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({
      module: "docs",
      capabilities: { save: true, saveAs: true, recents: true, print: true, exportPdf: true, exportHtml: false, attachments: true, images: true, ai: false },
    });
  });
});

function answer(flags: unknown) {
  requestMock.mockImplementation((path: string) => (path === "/api/v1/config?organization_id=org1"
    ? Promise.resolve({ flags })
    : Promise.reject(new Error(`unexpected ${path}`))));
}

describe("OfficeModuleOpenSwitch", () => {
  function SizeRefusedFrame() {
    const refuse = useDocsFrameRefusal();
    useEffect(() => { refuse?.(); }, [refuse]);
    return <p>pdf frame</p>;
  }

  it("shows the too-large notice and no frame when the file is over the module's size cap", async () => {
    answer({ office_engine: true, office_pdf_web: true });
    render(wrap(<OfficeModuleOpenSwitch module="pdf" organizationId="org1" frame={<SizeRefusedFrame />} tooLarge={<p>too large notice</p>} />));
    expect(await screen.findByText("too large notice")).toBeTruthy();
    expect(screen.queryByText("pdf frame")).toBeNull();
  });

  const ui = <OfficeModuleOpenSwitch module="pdf" organizationId="org1" frame={<p>pdf frame</p>} />;

  it("opens the module's frame when its flag is on or absent (default on, CONTRACT C14)", async () => {
    answer({ office_engine: true, office_pdf_web: true });
    render(wrap(ui));
    expect(await screen.findByText("pdf frame")).toBeTruthy();
  });

  it("shows the unavailable notice, no retry, when the module's own flag is overridden off", async () => {
    answer({ office_engine: true, office_pdf_web: false, office_docs_web: true, office_slides_web: true });
    render(wrap(ui));
    const failed = await screen.findByTestId("office-docs-frame-failed");
    expect(failed).toHaveAttribute("data-failure-kind", "unavailable");
    expect(failed).toHaveTextContent("Tổ chức của bạn chưa bật mở loại tệp này trên web.");
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
    expect(screen.queryByText("pdf frame")).toBeNull();
  });

  it("mounts the frame when the organization's answer could not be read: the server decides", async () => {
    requestMock.mockImplementation(() => Promise.reject(new Error("config down")));
    render(wrap(ui));
    expect(await screen.findByText("pdf frame")).toBeTruthy();
  });
});

describe("Open in desktop app in the module frame", () => {
  const desktopOpen = (loadInstallers = vi.fn(async () => ({ installers: [] }))): FrameDesktopOpenProps => ({
    deploymentId: "dep-1", savedVersion: 3, loadInstallers, launch: vi.fn(async () => "not-installed" as const),
  });
  const action = () => document.querySelector("[data-office-desktop-action]");

  it.each(["docs", "pdf", "markdown", "html", "slides", "sheets"] as const)("shows the action for %s once the frame is ready", async (module) => {
    const frame = mountFrame(module, { desktopOpen: desktopOpen() });
    expect(action()).toBeNull();
    await frame.ready(module === "docs" ? {} : { module });
    await waitFor(() => expect(action()).not.toBeNull());
  });

  it("asks before handing off unsaved frame edits", async () => {
    const launch = vi.fn(async () => "launched" as const);
    const frame = mountFrame("sheets", { desktopOpen: { ...desktopOpen(), launch } });
    await frame.ready({ module: "sheets" });
    await waitFor(() => expect(action()).not.toBeNull());
    await frame.event("dirty", { dirty: true });
    const button = action()!.querySelector("button")!;
    await act(async () => { button.click(); });
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(launch).not.toHaveBeenCalled();
  });

  it("is hidden for a user who may only view", async () => {
    const frame = mountFrame("pdf", { desktopOpen: desktopOpen(), readonly: true });
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(action()).toBeNull();
  });

  it("is hidden for a user whose minted token cannot edit", async () => {
    const frame = mountFrame("pdf", { desktopOpen: desktopOpen(), canEdit: false });
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(action()).toBeNull();
  });

  it("is absent when the page wires no desktop handoff", async () => {
    const frame = mountFrame("pdf");
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(action()).toBeNull();
  });
});

describe("the leave dialog hands focus back to every module's frame", () => {
  it.each(["docs", "pdf", "markdown", "html", "slides", "sheets"] as const)("%s: Stay puts focus on the iframe and its window", async (module) => {
    const frame = mountFrame(module);
    await frame.ready(module === "docs" ? {} : { module });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    await frame.event("dirty", { dirty: true });
    // jsdom has no window.focus: the hand-back lands on spies.
    const focusIframe = vi.spyOn(frame.iframe, "focus");
    const focusWindow = vi.spyOn(frame.iframe.contentWindow!, "focus").mockImplementation(() => undefined);
    const leaving = leaveGuardAllows("/elsewhere");
    fireEvent.click(await screen.findByRole("button", { name: "Ở lại" }));
    await expect(leaving).resolves.toBe(false);
    await waitFor(() => expect(focusWindow).toHaveBeenCalledTimes(1));
    expect(focusIframe).toHaveBeenCalledTimes(1);
  });
});

describe("first save names a never-saved blank (UNI-1847, SAVE-01)", () => {
  const UNTITLED = {
    id: "doc-1", organization_id: "org-1", workspace_id: "ws-1", parent_id: "folder-mine",
    kind: "file", title: "Tài liệu chưa đặt tên.docx", revision: "4", current_version: 1,
    file: {
      file_id: "f-1", version_id: "v-1", version: 1, filename: "untitled.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size_bytes: 12, checksum_sha256: "abc",
    },
  } as unknown as Document;
  const OK_SAVE = { ok: true, file: { fileId: "doc-1", name: "untitled.docx" }, versionId: "v-2" };
  const calls = () => requestMock.mock.calls as [string, { method?: string; body?: unknown } | undefined][];
  const patchCalls = () => calls().filter(([path, init]) => path === "/api/v1/documents/doc-1" && init?.method === "PATCH");

  const namingRoutes = (path: string, init?: { method?: string }) => {
    if (path === "/api/v1/documents/doc-1" && init?.method === "PATCH") return Promise.resolve({ document: { ...UNTITLED, revision: "5" } });
    if (path === "/api/v1/documents/doc-1") return Promise.resolve({ document: UNTITLED });
    return undefined;
  };

  async function mountUnnamed() {
    const frame = mountFrame("docs", { inHeader: true, documentDetail: UNTITLED, extraRoutes: namingRoutes });
    await frame.ready({});
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    await frame.event("dirty", { dirty: true });
    return frame;
  }

  it("header Save opens the name dialog: submit PATCHes the title, asks the frame once, tells it the name", async () => {
    const frame = await mountUnnamed();
    vi.mocked(lastApi!.save).mockResolvedValue(OK_SAVE as never);
    fireEvent.click(screen.getByRole("button", { name: "Lưu vào UniWork" }));
    const dialog = await screen.findByRole("dialog", { name: "Đặt tên tài liệu" });
    expect(dialog).toBeTruthy();
    expect(screen.getByText("Bạn có thể đổi tên sau trong thư mục.")).toBeTruthy();
    const input = screen.getByLabelText("Tên tài liệu") as HTMLInputElement;
    expect(input.value).toBe("Tài liệu chưa đặt tên");
    fireEvent.change(input, { target: { value: "Kế hoạch Q4" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // One PATCH, then the save the click started: the frame is asked once and uploads once.
    expect(patchCalls()).toHaveLength(1);
    await waitFor(() => expect(frame.sent("save")).toHaveLength(1));
    const upload = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4), etag: "4" });
    await waitFor(() => expect(frame.answerTo(upload)?.payload).toMatchObject({ ok: true }));
    expect(lastApi!.save).toHaveBeenCalledTimes(1);
    // The new name names the stored file too: the upload goes as "Kế hoạch Q4.docx".
    expect(vi.mocked(lastApi!.save).mock.calls[0]?.[1]).toMatchObject({ filename: "Kế hoạch Q4.docx" });
    // The frame heard its new name before the save finished.
    const renamed = frame.received.find((m) => m.kind === "event" && m.type === "file.renamed");
    expect(renamed).toBeTruthy();
    expect(JSON.stringify(renamed!.payload)).toContain("Kế hoạch Q4.docx");
    await frame.respond(frame.sent("save")[0]!, OK_SAVE);
    // A second Save stays quiet: no dialog, no PATCH.
    fireEvent.click(screen.getByRole("button", { name: "Lưu vào UniWork" }));
    await waitFor(() => expect(frame.sent("save")).toHaveLength(2));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(patchCalls()).toHaveLength(1);
    await frame.respond(frame.sent("save")[1]!, OK_SAVE);
  });

  it("Cancel keeps the save unsent and the editor dirty; the next Save asks again", async () => {
    const frame = await mountUnnamed();
    fireEvent.click(screen.getByRole("button", { name: "Lưu vào UniWork" }));
    await screen.findByRole("dialog", { name: "Đặt tên tài liệu" });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(frame.sent("save")).toHaveLength(0);
    expect(lastApi!.save).not.toHaveBeenCalled();
    expect(document.querySelector("[data-office-docs-frame]")).toHaveAttribute("data-dirty", "true");
    expect(toast.error).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Lưu vào UniWork" }));
    await screen.findByRole("dialog", { name: "Đặt tên tài liệu" });
  });

  it("Save and leave goes through the same naming step; cancelling it stays on the page", async () => {
    const frame = await mountUnnamed();
    vi.mocked(lastApi!.save).mockResolvedValue(OK_SAVE as never);
    const leaving = leaveGuardAllows("/elsewhere");
    fireEvent.click(await screen.findByRole("button", { name: "Lưu lên UniWork" }));
    await screen.findByRole("dialog", { name: "Đặt tên tài liệu" });
    // Cancel of the name dialog is stay-on-page: no save, no leave.
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await expect(leaving).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(frame.sent("save")).toHaveLength(0);
  });

  it("the leave Save that answers the name dialog carries on saving and leaving", async () => {
    const frame = await mountUnnamed();
    vi.mocked(lastApi!.save).mockResolvedValue(OK_SAVE as never);
    const leaving = leaveGuardAllows("/elsewhere");
    fireEvent.click(await screen.findByRole("button", { name: "Lưu lên UniWork" }));
    await screen.findByRole("dialog", { name: "Đặt tên tài liệu" });
    fireEvent.change(screen.getByLabelText("Tên tài liệu"), { target: { value: "Kế hoạch" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(frame.sent("save")).toHaveLength(1));
    await frame.respond(frame.sent("save")[0]!, OK_SAVE);
    await expect(leaving).resolves.toBe(true);
  });

  it("never prompts for an already-named document, a saved version, or a viewer", async () => {
    const named = { ...UNTITLED, file: { ...UNTITLED.file!, filename: "Plan.docx" } } as unknown as Document;
    const saved = { ...UNTITLED, file: { ...UNTITLED.file!, version: 2 } } as unknown as Document;
    for (const doc of [named, saved]) {
      cleanup();
      const frame = mountFrame("docs", { inHeader: true, documentDetail: doc, extraRoutes: namingRoutes });
      await frame.ready({});
      await waitFor(() => expect(frame.inits()).toHaveLength(1));
      await frame.event("dirty", { dirty: true });
      fireEvent.click(screen.getByRole("button", { name: "Lưu vào UniWork" }));
      await waitFor(() => expect(frame.sent("save")).toHaveLength(1));
      expect(screen.queryByRole("dialog")).toBeNull();
      await frame.respond(frame.sent("save")[0]!, OK_SAVE);
    }
    // A viewer never sees the dialog: api.save is refused before the prompt runs.
    cleanup();
    const viewer = mountFrame("docs", { readonly: true, documentDetail: UNTITLED, extraRoutes: namingRoutes });
    await viewer.ready({});
    await waitFor(() => expect(viewer.inits()).toHaveLength(1));
    const id = viewer.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4), etag: "1" });
    await waitFor(() => expect(viewer.answerTo(id)?.error?.code).toBe("forbidden"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the frame's app.open request (A7)", () => {
  const ticket = `ticket_${"a".repeat(40)}`;
  const wiring = (launch: FrameDesktopOpenProps["launch"], createSession: NonNullable<FrameDesktopOpenProps["createSession"]> = vi.fn(async () => ({ launch_ticket: ticket }) as never)): FrameDesktopOpenProps => ({
    deploymentId: "dep-1", savedVersion: 3, loadInstallers: vi.fn(async () => ({ installers: [] })), launch, createSession,
  });
  const ask = async (frame: ReturnType<typeof mountFrame>) => {
    const id = frame.request("app.open", { feature: "pdf.ocr" });
    await waitFor(() => expect(frame.answerTo(id)).toBeTruthy());
    return frame.answerTo(id)!;
  };

  it("grants desktopOpen only where the header action exists", async () => {
    const withAction = mountFrame("pdf", { desktopOpen: wiring(vi.fn(async () => "launched" as const)) });
    await withAction.ready({ module: "pdf" });
    await waitFor(() => expect(withAction.inits()).toHaveLength(1));
    expect(withAction.inits()[0]?.payload).toMatchObject({ capabilities: { desktopOpen: true } });
    cleanup();
    const viewer = mountFrame("pdf", { desktopOpen: wiring(vi.fn(async () => "launched" as const)), canEdit: false });
    await viewer.ready({ module: "pdf" });
    await waitFor(() => expect(viewer.inits()).toHaveLength(1));
    expect(viewer.inits()[0]?.payload).toMatchObject({ capabilities: { desktopOpen: false } });
    cleanup();
    const bare = mountFrame("pdf");
    await bare.ready({ module: "pdf" });
    await waitFor(() => expect(bare.inits()).toHaveLength(1));
    expect(bare.inits()[0]?.payload).toMatchObject({ capabilities: { desktopOpen: false } });
  });

  it("launches the app through the header flow and answers launched", async () => {
    const launch = vi.fn(async () => "launched" as const);
    const createSession = vi.fn(async () => ({ launch_ticket: ticket }) as never);
    const frame = mountFrame("pdf", { desktopOpen: wiring(launch, createSession) });
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(document.querySelector("[data-office-desktop-action]")).not.toBeNull());
    const answer = await ask(frame);
    expect(answer.payload).toEqual({ outcome: "launched" });
    // The committed version is the current one, so the body leaves `version` out (it would force a read-only session).
    expect(createSession).toHaveBeenCalledWith("doc-1", expect.objectContaining({ operation: "edit", deployment_id: "dep-1" }));
    expect(createSession).toHaveBeenCalledWith("doc-1", expect.not.objectContaining({ version: expect.anything() }));
    expect(launch).toHaveBeenCalledWith(expect.stringContaining("://open?ticket="), expect.anything());
  });

  it("opens the installer prompt when the app does not answer", async () => {
    const frame = mountFrame("sheets", { desktopOpen: wiring(vi.fn(async () => "not-installed" as const)) });
    await frame.ready({ module: "sheets" });
    await waitFor(() => expect(document.querySelector("[data-office-desktop-action]")).not.toBeNull());
    const answer = await ask(frame);
    expect(answer.payload).toEqual({ outcome: "installer" });
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("answers unavailable when the ticket cannot be made", async () => {
    const frame = mountFrame("pdf", { desktopOpen: wiring(vi.fn(), vi.fn(async () => null)) });
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(document.querySelector("[data-office-desktop-action]")).not.toBeNull());
    expect((await ask(frame)).payload).toEqual({ outcome: "unavailable" });
  });

  it("answers unavailable to a frame the host did not grant it", async () => {
    const frame = mountFrame("pdf");
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect((await ask(frame)).payload).toEqual({ outcome: "unavailable" });
  });

  it("waits on the unsaved-changes dialog and answers unavailable when it is cancelled", async () => {
    const launch = vi.fn(async () => "launched" as const);
    const frame = mountFrame("pdf", { desktopOpen: wiring(launch) });
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(document.querySelector("[data-office-desktop-action]")).not.toBeNull());
    await frame.event("dirty", { dirty: true });
    const id = frame.request("app.open", {});
    await screen.findByRole("dialog");
    expect(frame.answerTo(id)).toBeUndefined();
    await act(async () => { screen.getByRole("button", { name: /cancel|hủy/i }).click(); });
    await waitFor(() => expect(frame.answerTo(id)?.payload).toEqual({ outcome: "unavailable" }));
    expect(launch).not.toHaveBeenCalled();
  });
});


const ALL_DOWNLOAD_MODULES: OfficeModule[] = ["docs", "pdf", "markdown", "html", "slides", "sheets"];

describe("the frame's api.download (conflict dialog: download my version)", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const EXT: Record<OfficeModule, string> = { docs: "docx", pdf: "pdf", markdown: "md", html: "html", slides: "pptx", sheets: "xlsx" };

  it.each(ALL_DOWNLOAD_MODULES)("%s: advertises download to an editor and saves the bytes as '<title> (bản của tôi)' in the module's format", async (module) => {
    const frame = mountFrame(module);
    await frame.ready({ module });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({ capabilities: { download: true } });
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.download); });
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:mine"), revokeObjectURL: vi.fn() });
    const id = frame.request("api.download", { data: new ArrayBuffer(3) });
    await waitFor(() => expect(frame.answerTo(id)?.payload).toEqual({ delivered: true }));
    expect(clicks).toEqual([`Scan (bản của tôi).${EXT[module]}`]);
  });

  it("offers no download to a viewer and refuses one", async () => {
    const frame = mountFrame("sheets", { canEdit: false });
    await frame.ready({ module: "sheets" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({ capabilities: { download: false } });
    const id = frame.request("api.download", { data: new ArrayBuffer(3) });
    await waitFor(() => expect(frame.answerTo(id)?.error?.code).toBe("forbidden"));
  });
});

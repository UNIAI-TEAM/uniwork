import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { PROTOCOL_NS, PROTOCOL_VERSION, isInitPayload, type Envelope, type OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { endOfficeDraftSession } from "@uniwork/core/office/draft-session-key";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrap } from "../../test/api-mock";
import { DocsFrameRefusalContext, useDocsFrameRefusal } from "./docs-frame-refusal";
import type { FrameDesktopOpenProps } from "./frame-desktop-open";
import { OfficeModuleFrame } from "./office-module-frame";
import { OfficeModuleOpenSwitch } from "./office-module-open-switch";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const MINT_PATH = "/api/v1/documents/doc-1/office/frame-token";
const minted = {
  token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: true, module: "pdf",
};

let lastApi: DocsFrameApi | null = null;

function fullApi(): DocsFrameApi {
  return {
    open: vi.fn(), save: vi.fn(), recents: vi.fn(), saveAs: vi.fn(), export: vi.fn(), addAttachments: vi.fn(), uploadImage: vi.fn(),
  } as unknown as DocsFrameApi;
}

function mountFrame(module: OfficeModule, { canEdit = true, readonly = false, tokenModule = module, mint, refuse, desktopOpen }: { canEdit?: boolean; readonly?: boolean; tokenModule?: string; mint?: () => Promise<unknown>; refuse?: () => void; desktopOpen?: FrameDesktopOpenProps } = {}) {
  requestMock.mockImplementation((path: string) => (path === MINT_PATH ? (mint?.() ?? Promise.resolve({ ...minted, can_edit: canEdit, module: tokenModule })) : Promise.reject(new Error(`unexpected ${path}`))));
  lastApi = fullApi();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider defaultTheme="light" enableSystem={false}>
        <DocsFrameRefusalContext.Provider value={refuse ?? null}>
          <OfficeModuleFrame module={module} wsId="ws-1" documentId="doc-1" title="Scan" frameVersion="1.0.0" api={lastApi} readonly={readonly} desktopOpen={desktopOpen} />
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
      queueMicrotask(() => { void post(envelope("response", "init", { protocolVersion: 1, capabilities: {} }, m.id)); });
    }
  });
  return {
    iframe,
    event: (type: string, payload: unknown) => post(envelope("event", type, payload)),
    ready: (payload: Record<string, unknown>) => post(envelope("event", "ready", { protocolVersion: 1, capabilities: {}, ...payload })),
    inits: () => received.filter((m) => m.kind === "request" && m.type === "init"),
    request: (type: string, payload: unknown) => { const e = envelope("request", type, payload); void post(e); return e.id; },
    answerTo: (id: string) => received.find((m) => m.kind === "response" && m.id === id),
  };
}

afterEach(async () => { requestMock.mockReset(); resetAuthStoreForTests(); await endOfficeDraftSession(); });

describe("OfficeModuleFrame", () => {
  it("serves the module's build and grants it only what its frame implements", async () => {
    const frame = mountFrame("pdf");
    expect(frame.iframe.getAttribute("src")).toBe("/office-frame/pdf/1.0.0/index.html");
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(true));
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({
      module: "pdf", documentId: "doc-1", token: "tok-1",
      capabilities: { save: true, saveAs: true, recents: false, print: true, exportPdf: false, exportHtml: false, attachments: false, images: false, ai: false },
    });
  });

  it("names the signed-in user to the editor", async () => {
    setSessionUser({ id: "u-1", email: "an@example.test", display_name: "Nguyễn An" } as Parameters<typeof setSessionUser>[0]);
    const frame = mountFrame("markdown");
    await frame.ready({ module: "markdown" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({ user: { displayName: "Nguyễn An" }, capabilities: { exportHtml: true, save: true } });
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
    expect(frame.inits()[0]?.payload).toMatchObject({ capabilities: { save: false, saveAs: false, print: true } });
  });

  it("refuses the writes of a user whose minted token cannot edit, though the page is not readonly", async () => {
    const frame = mountFrame("markdown", { canEdit: false });
    await frame.ready({ module: "markdown" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    const id = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(1) });
    await waitFor(() => expect(frame.answerTo(id)?.error?.code).toBe("forbidden"));
    expect(lastApi?.save).not.toHaveBeenCalled();
  });

  it("hands the document to the G3 editor when the server minted another module than the frame", async () => {
    const refuse = vi.fn();
    const frame = mountFrame("markdown", { refuse, tokenModule: "sheets" });
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(true));
    await frame.ready({ module: "markdown" });
    await waitFor(() => expect(refuse).toHaveBeenCalled());
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

  it("hands a workbook the server refused as too large (413) to the G3 editor", async () => {
    const refuse = vi.fn();
    mountFrame("sheets", { refuse, mint: () => Promise.reject(new ApiError("document is too large for the web frame", "too_large", 413)) });
    await waitFor(() => expect(refuse).toHaveBeenCalled());
  });

  it("hands a workbook the Sheets frame refused to open as too_large to the G3 editor", async () => {
    const refuse = vi.fn();
    const frame = mountFrame("sheets", { refuse });
    await frame.ready({ module: "sheets" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(refuse).not.toHaveBeenCalled();
    await frame.event("error", { error: { code: "too_large", message: "worksheet XML over 40 MB" }, fatal: true });
    await waitFor(() => expect(refuse).toHaveBeenCalled());
  });

  it("does not fall back for too_large in a module without a size cap", async () => {
    const refuse = vi.fn();
    mountFrame("pdf", { refuse, mint: () => Promise.reject(new ApiError("too large", "too_large", 413)) });
    expect(await screen.findByTestId("office-docs-frame-failed")).toBeTruthy();
    expect(refuse).not.toHaveBeenCalled();
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
  const ui = <OfficeModuleOpenSwitch module="pdf" organizationId="org1" frame={<p>pdf frame</p>} fallback={<p>g3 editor</p>} />;

  it("opens the module's frame when its flag is on or absent (default on, CONTRACT C14)", async () => {
    answer({ office_engine: true, office_pdf_web: true });
    render(wrap(ui));
    expect(await screen.findByText("pdf frame")).toBeTruthy();
  });

  it("keeps the G3 editor when the module's own flag is overridden off, whatever the other modules say", async () => {
    answer({ office_engine: true, office_pdf_web: false, office_docs_web: true, office_slides_web: true });
    render(wrap(ui));
    expect(await screen.findByText("g3 editor")).toBeTruthy();
    expect(screen.queryByText("pdf frame")).toBeNull();
  });

  it("falls back when the server refuses the module's token", async () => {
    answer({ office_engine: true, office_pdf_web: true });
    function RefusedFrame() {
      const refuse = useDocsFrameRefusal();
      useEffect(() => { refuse?.(); }, [refuse]);
      return <p>pdf frame</p>;
    }
    render(wrap(<OfficeModuleOpenSwitch module="pdf" organizationId="org1" frame={<RefusedFrame />} fallback={<p>g3 editor</p>} />));
    expect(await screen.findByText("g3 editor")).toBeTruthy();
  });
});

describe("Open in desktop app in the module frame", () => {
  const desktopOpen = (loadInstallers = vi.fn(async () => ({ installers: [] }))): FrameDesktopOpenProps => ({
    deploymentId: "dep-1", savedVersion: 3, loadInstallers, launch: vi.fn(async () => "not-installed" as const),
  });
  const action = () => document.querySelector("[data-office-desktop-action]");

  it.each(["docs", "pdf", "markdown", "html", "slides", "sheets"] as const)("shows the G3 action for %s once the frame is ready", async (module) => {
    const frame = mountFrame(module, { desktopOpen: desktopOpen() });
    expect(action()).toBeNull();
    await frame.ready(module === "docs" ? {} : { module });
    await waitFor(() => expect(action()).not.toBeNull());
  });

  it("asks before handing off unsaved frame edits, like the G3 host", async () => {
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

  it("is hidden for a user who may only view, as in the G3 host", async () => {
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


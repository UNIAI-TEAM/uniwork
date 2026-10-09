import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { PROTOCOL_NS, PROTOCOL_VERSION, type Envelope, type OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { requestMock, wrap } from "../../test/api-mock";
import { useDocsFrameRefusal } from "./docs-frame-refusal";
import { OfficeModuleFrame } from "./office-module-frame";
import { OfficeModuleOpenSwitch } from "./office-module-open-switch";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const MINT_PATH = "/api/v1/documents/doc-1/office/frame-token";
const minted = {
  token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: true, module: "pdf",
};

function fullApi(): DocsFrameApi {
  return {
    open: vi.fn(), save: vi.fn(), recents: vi.fn(), saveAs: vi.fn(), export: vi.fn(), addAttachments: vi.fn(), uploadImage: vi.fn(),
  } as unknown as DocsFrameApi;
}

function mountFrame(module: OfficeModule) {
  requestMock.mockImplementation((path: string) => (path === MINT_PATH ? Promise.resolve(minted) : Promise.reject(new Error(`unexpected ${path}`))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider defaultTheme="light" enableSystem={false}>
        <OfficeModuleFrame module={module} wsId="ws-1" documentId="doc-1" title="Scan" frameVersion="1.0.0" api={fullApi()} />
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
    ready: (payload: Record<string, unknown>) => post(envelope("event", "ready", { protocolVersion: 1, capabilities: {}, ...payload })),
    inits: () => received.filter((m) => m.kind === "request" && m.type === "init"),
  };
}

afterEach(() => { requestMock.mockReset(); });

describe("OfficeModuleFrame", () => {
  it("serves the module's build and grants it nothing its worker has not enabled", async () => {
    const frame = mountFrame("pdf");
    expect(frame.iframe.getAttribute("src")).toBe("/office-frame/pdf/1.0.0/index.html");
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(true));
    await frame.ready({ module: "pdf" });
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({
      module: "pdf", documentId: "doc-1", token: "tok-1",
      capabilities: { save: false, saveAs: false, recents: false, print: false, exportPdf: false, exportHtml: false, attachments: false, images: false, ai: false },
    });
  });

  it("refuses a frame that runs another module's editor before any init", async () => {
    const frame = mountFrame("pdf");
    // A Docs bundle says ready without a module (= docs).
    await frame.ready({});
    expect(await screen.findByTestId("office-docs-frame-failed")).toBeTruthy();
    expect(frame.inits()).toHaveLength(0);
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

  it("opens the module's frame only on its own flag", async () => {
    answer({ office_engine: true, office_pdf_web: true });
    render(wrap(ui));
    expect(await screen.findByText("pdf frame")).toBeTruthy();
  });

  it("keeps the G3 editor when only another module's flag is on", async () => {
    answer({ office_engine: true, office_docs_web: true, office_slides_web: true });
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

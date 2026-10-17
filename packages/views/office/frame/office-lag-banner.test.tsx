import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { DEFAULT_DOCUMENT_LIMITS } from "@uniwork/core/documents/limits";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { endOfficeDraftSession } from "@uniwork/core/office/draft-session-key";
import { PROTOCOL_NS, PROTOCOL_VERSION, type Envelope, type OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import type { StorageAdapter } from "@uniwork/core/types/storage";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { HeaderActionsSlot, HeaderActionsSlotProvider } from "../../layout/header-actions-slot";
import { requestMock } from "../../test/api-mock";
import { OfficeTooLargeProvider } from "../too-large-notice";
import { DocsFrameRefusalContext } from "./docs-frame-refusal";
import type { FrameDesktopOpenProps } from "./frame-desktop-open";
import { OfficeModuleFrame, type OfficeModuleFrameControls } from "./office-module-frame";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const minted = {
  token: "tok-1",
  token_type: "Bearer",
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  expires_in: 600,
  document_id: "doc-1",
  workspace_id: "ws-1",
  organization_id: "org-1",
  can_edit: true,
  module: "docs",
};

function memoryStorage(): StorageAdapter {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
  };
}

interface MountOptions {
  documentId?: string;
  canEdit?: boolean;
  readonly?: boolean;
  desktopOpen?: FrameDesktopOpenProps;
  fileActions?: boolean | "download_only";
  fileSizeBytes?: number | null;
  hasLagObserver?: () => boolean;
  lagStorage?: Pick<StorageAdapter, "getItem" | "setItem">;
  refuse?: () => void;
  controlsRef?: { current: OfficeModuleFrameControls | null };
  onDownload?: () => Promise<void>;
}

function mountLagFrame(module: OfficeModule = "docs", options: MountOptions = {}) {
  const {
    documentId = "doc-1",
    canEdit = true,
    readonly = false,
    desktopOpen,
    fileActions = false,
    fileSizeBytes,
    hasLagObserver,
    lagStorage,
    refuse,
    controlsRef,
    onDownload = vi.fn(async () => undefined),
  } = options;
  const mintPath = `/api/v1/documents/${documentId}/office/frame-token`;
  requestMock.mockImplementation((path: string) => {
    if (path === mintPath) {
      return Promise.resolve({ ...minted, document_id: documentId, can_edit: canEdit, module });
    }
    if (path.startsWith("/api/v1/config")) {
      return Promise.resolve({ flags: { office_engine: true }, documents: { limits: DEFAULT_DOCUMENT_LIMITS } });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  const api: DocsFrameApi = {
    open: vi.fn(async () => ({
      file: { fileId: documentId, name: "Report.docx", mimeType: "application/octet-stream", sizeBytes: fileSizeBytes ?? 1024, etag: "1", writable: true },
      source: { kind: "bytes" as const, data: new ArrayBuffer(8) },
    })),
    save: vi.fn(async () => ({
      ok: true as const,
      file: { fileId: documentId, name: "Report.docx", mimeType: "application/octet-stream", sizeBytes: 1024, etag: "2", writable: true },
      versionId: "v-2",
    })),
    recents: vi.fn(),
    saveAs: vi.fn(),
    export: vi.fn(),
    addAttachments: vi.fn(),
    uploadImage: vi.fn(),
  } as unknown as DocsFrameApi;

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const bare = (
    <OfficeModuleFrame
      module={module}
      wsId="ws-1"
      documentId={documentId}
      title="Report"
      frameVersion="1.0.0"
      api={api}
      readonly={readonly}
      desktopOpen={desktopOpen}
      fileSizeBytes={fileSizeBytes}
      hasLagObserver={hasLagObserver}
      lagStorage={lagStorage}
      controlsRef={controlsRef}
    />
  );
  const framed = fileActions ? (
    <OfficeTooLargeProvider
      value={{
        desktopAction: fileActions === "download_only" ? null : <button type="button">{viLocale.office.desktop.action}</button>,
        onDownload,
      }}
    >
      {bare}
    </OfficeTooLargeProvider>
  ) : bare;

  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider defaultTheme="light" enableSystem={false}>
        <DocsFrameRefusalContext.Provider value={refuse ?? null}>
          <HeaderActionsSlotProvider>
            <HeaderActionsSlot />
            {framed}
          </HeaderActionsSlotProvider>
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
      queueMicrotask(() => { void post(envelope("response", "init", { protocolVersion: 1, capabilities: { save: true } }, m.id)); });
    }
    if (m.kind === "request" && m.type === "save") {
      queueMicrotask(() => {
        void post(envelope("response", "save", {
          ok: true,
          file: { fileId: documentId, name: "Report.docx", mimeType: "application/octet-stream", sizeBytes: 1024, etag: "2", writable: true },
          versionId: "v-2",
        }, m.id));
      });
    }
  });

  return {
    api,
    onDownload,
    unmount: () => view.unmount(),
    ready: () => post(envelope("event", "ready", { protocolVersion: 1, capabilities: { save: true }, ...(module === "docs" ? {} : { module }) })),
    inits: () => received.filter((m) => m.kind === "request" && m.type === "init"),
    event: (type: string, payload: unknown) => post(envelope("event", type, payload)),
    request: (type: string, payload: unknown) => { const e = envelope("request", type, payload); void post(e); return e.id; },
    answerTo: (id: string) => received.find((m) => m.kind === "response" && m.id === id),
  };
}

function desktopWiring(launch: FrameDesktopOpenProps["launch"] = vi.fn(async () => "launched" as const)): FrameDesktopOpenProps {
  const ticket = `ticket_${"a".repeat(40)}`;
  return {
    deploymentId: "dep-1",
    savedVersion: 2,
    loadInstallers: vi.fn(async () => ({ installers: [] })),
    launch,
    createSession: vi.fn(async () => ({ launch_ticket: ticket }) as never),
  };
}

afterEach(async () => {
  cleanup();
  requestMock.mockReset();
  resetAuthStoreForTests();
  await endOfficeDraftSession();
});

describe("OfficeModuleFrame lag banner & open_refused notice (LAG-W1)", () => {
  it("shows the non-blocking lag banner on lag_detected and launches the desktop app on 'Mở bằng app'", async () => {
    const launch = vi.fn(async () => "launched" as const);
    const storage = memoryStorage();
    const frame = mountLagFrame("docs", {
      desktopOpen: desktopWiring(launch),
      hasLagObserver: () => true,
      lagStorage: storage,
    });
    await frame.ready();
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(screen.queryByTestId("office-lag-banner")).toBeNull();

    await frame.event("lag_detected", { reason: "longtask", worst_ms: 320, count: 3, window_ms: 0 });

    const banner = await screen.findByTestId("office-lag-banner");
    expect(banner).toHaveTextContent("Tệp lớn nên có thể chạy chậm trên trình duyệt. Mở bằng app UniWork Office cho trải nghiệm tốt hơn.");
    const openAppBtn = screen.getByRole("button", { name: "Mở bằng app" });
    expect(screen.getByRole("button", { name: "Tiếp tục trên web" })).toBeInTheDocument();

    fireEvent.click(openAppBtn);
    await waitFor(() => expect(launch).toHaveBeenCalledWith(expect.stringContaining("://open?ticket="), expect.anything()));
  });

  it("shows the lag banner at open by size fallback only when the browser lacks a lag PerformanceObserver", async () => {
    const storage = memoryStorage();
    const warnBytes = DEFAULT_DOCUMENT_LIMITS.web_open.xlsx.warn_bytes;

    // Under or at warn_bytes without observer -> no banner.
    const under = mountLagFrame("sheets", {
      desktopOpen: desktopWiring(),
      fileSizeBytes: warnBytes,
      hasLagObserver: () => false,
      lagStorage: storage,
    });
    await under.ready();
    await waitFor(() => expect(under.inits()).toHaveLength(1));
    expect(screen.queryByTestId("office-lag-banner")).toBeNull();
    under.unmount();
    cleanup();

    // Over warn_bytes without observer -> shows banner at open.
    const over = mountLagFrame("sheets", {
      desktopOpen: desktopWiring(),
      fileSizeBytes: warnBytes + 1,
      hasLagObserver: () => false,
      lagStorage: storage,
    });
    await over.ready();
    await waitFor(() => expect(over.inits()).toHaveLength(1));
    expect(await screen.findByTestId("office-lag-banner")).toHaveTextContent(
      "Tệp lớn nên có thể chạy chậm trên trình duyệt. Mở bằng app UniWork Office cho trải nghiệm tốt hơn.",
    );
  });

  it("does not show the size banner when a lag PerformanceObserver exists (relies only on lag_detected)", async () => {
    const storage = memoryStorage();
    const warnBytes = DEFAULT_DOCUMENT_LIMITS.web_open.docx.warn_bytes;
    const frame = mountLagFrame("docs", {
      desktopOpen: desktopWiring(),
      fileSizeBytes: warnBytes + 5_000_000,
      hasLagObserver: () => true,
      lagStorage: storage,
    });
    await frame.ready();
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(screen.queryByTestId("office-lag-banner")).toBeNull();

    await frame.event("lag_detected", { reason: "interactions", worst_ms: 260, count: 3, window_ms: 120_000 });
    expect(await screen.findByTestId("office-lag-banner")).toBeInTheDocument();
  });

  it("remembers dismissal per document through StorageAdapter (office.lagBanner.dismissed:<documentId>) across sessions", async () => {
    const storage = memoryStorage();
    const warnBytes = DEFAULT_DOCUMENT_LIMITS.web_open.pdf.warn_bytes;
    const first = mountLagFrame("pdf", {
      documentId: "doc-1",
      desktopOpen: desktopWiring(),
      hasLagObserver: () => true,
      lagStorage: storage,
    });
    await first.ready();
    await waitFor(() => expect(first.inits()).toHaveLength(1));
    await first.event("lag_detected", { reason: "longtask", worst_ms: 400, count: 4, window_ms: 0 });
    expect(await screen.findByTestId("office-lag-banner")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục trên web" }));
    expect(screen.queryByTestId("office-lag-banner")).toBeNull();
    expect(storage.getItem("office.lagBanner.dismissed:doc-1")).toBe("1");

    // Further lag_detected in the same session stays hidden.
    await first.event("lag_detected", { reason: "longtask", worst_ms: 500, count: 5, window_ms: 120_000 });
    expect(screen.queryByTestId("office-lag-banner")).toBeNull();
    first.unmount();
    cleanup();

    // New session on the same document (doc-1), even with size fallback or lag_detected -> stays dismissed.
    const second = mountLagFrame("pdf", {
      documentId: "doc-1",
      desktopOpen: desktopWiring(),
      fileSizeBytes: warnBytes + 1024,
      hasLagObserver: () => false,
      lagStorage: storage,
    });
    await second.ready();
    await waitFor(() => expect(second.inits()).toHaveLength(1));
    expect(screen.queryByTestId("office-lag-banner")).toBeNull();
    await second.event("lag_detected", { reason: "longtask", worst_ms: 350, count: 3, window_ms: 0 });
    expect(screen.queryByTestId("office-lag-banner")).toBeNull();
    second.unmount();
    cleanup();

    // Another document (doc-2) is not dismissed.
    const other = mountLagFrame("pdf", {
      documentId: "doc-2",
      desktopOpen: desktopWiring(),
      fileSizeBytes: warnBytes + 1024,
      hasLagObserver: () => false,
      lagStorage: storage,
    });
    await other.ready();
    await waitFor(() => expect(other.inits()).toHaveLength(1));
    expect(await screen.findByTestId("office-lag-banner")).toBeInTheDocument();
  });

  it("never blocks editing or saving while the lag banner is shown", async () => {
    const controlsRef: { current: OfficeModuleFrameControls | null } = { current: null };
    const frame = mountLagFrame("docs", {
      desktopOpen: desktopWiring(),
      hasLagObserver: () => true,
      lagStorage: memoryStorage(),
      controlsRef,
    });
    await frame.ready();
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    await frame.event("lag_detected", { reason: "longtask", worst_ms: 300, count: 3, window_ms: 0 });
    expect(await screen.findByTestId("office-lag-banner")).toBeInTheDocument();

    // Frame-initiated api.save goes through while the banner is visible.
    await frame.event("dirty", { dirty: true });
    const saveReqId = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4), etag: "1" });
    await waitFor(() => expect(frame.answerTo(saveReqId)?.payload).toMatchObject({ ok: true }));
    expect(frame.api.save).toHaveBeenCalledTimes(1);

    // Host-initiated save via controlsRef also succeeds while the banner stays up.
    await expect(controlsRef.current!.save()).resolves.toBe(true);
    expect(screen.getByTestId("office-lag-banner")).toBeInTheDocument();
  });

  it("hides 'Mở bằng app' when the app cannot be opened (no desktopOpen or view-only user)", async () => {
    // 1. No desktopOpen wired
    const noDesktop = mountLagFrame("docs", {
      hasLagObserver: () => true,
      lagStorage: memoryStorage(),
    });
    await noDesktop.ready();
    await waitFor(() => expect(noDesktop.inits()).toHaveLength(1));
    await noDesktop.event("lag_detected", { reason: "longtask", worst_ms: 250, count: 3, window_ms: 0 });
    expect(await screen.findByTestId("office-lag-banner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mở bằng app" })).toBeNull();
    expect(screen.getByRole("button", { name: "Tiếp tục trên web" })).toBeInTheDocument();
    noDesktop.unmount();
    cleanup();

    // 2. View-only user (canEdit: false) even with desktopOpen wired
    const viewOnly = mountLagFrame("sheets", {
      canEdit: false,
      desktopOpen: desktopWiring(),
      hasLagObserver: () => true,
      lagStorage: memoryStorage(),
    });
    await viewOnly.ready();
    await waitFor(() => expect(viewOnly.inits()).toHaveLength(1));
    await viewOnly.event("lag_detected", { reason: "longtask", worst_ms: 250, count: 3, window_ms: 0 });
    expect(await screen.findByTestId("office-lag-banner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mở bằng app" })).toBeNull();
    expect(screen.getByRole("button", { name: "Tiếp tục trên web" })).toBeInTheDocument();
  });

  it("replaces the frame with the refusal notice offering open-in-app and 'Tải xuống' on open_refused", async () => {
    const refuse = vi.fn();
    const onDownload = vi.fn(async () => undefined);
    const frame = mountLagFrame("sheets", {
      fileActions: true,
      refuse,
      onDownload,
      hasLagObserver: () => true,
      lagStorage: memoryStorage(),
    });
    await frame.ready();
    await waitFor(() => expect(frame.inits()).toHaveLength(1));

    await frame.event("open_refused", {
      reason: "too_complex",
      bytes: 600_000_000,
      measure: { kind: "worksheet_xml_bytes", value: 600_000_000, limit: 500_000_000 },
    });

    const notice = await screen.findByTestId("office-too-large");
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("office-docs-frame-iframe")).toBeNull();
    expect(notice).toHaveTextContent(viLocale.office.too_large.title);
    expect(screen.getByRole("button", { name: viLocale.office.desktop.action })).toBeInTheDocument();
    const downloadBtn = screen.getByRole("button", { name: "Tải xuống" });
    expect(downloadBtn).toBeInTheDocument();

    fireEvent.click(downloadBtn);
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
  });
});

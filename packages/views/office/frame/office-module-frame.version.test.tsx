import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { DocsProtocolError, PROTOCOL_NS, PROTOCOL_VERSION, type Envelope } from "@uniwork/core/office/docs-frame-protocol";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { requestMock } from "../../test/api-mock";
import type { FrameDesktopOpenProps } from "./frame-desktop-open";
import { OfficeModuleFrame } from "./office-module-frame";

// UNI-2033: the version view of a document in its module frame: the read-only banner, the way
// back, the unavailable state and the version API the session reads from.

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() } }));
const versionApi = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@uniwork/core/office/docs-frame-version-api", () => ({ createVersionFrameApi: versionApi.create }));

const MINT_PATH = "/api/v1/documents/doc-1/office/frame-token";
const minted = {
  token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: true, module: "docs",
};

function mount({ version, open, onBackToCurrent, desktopOpen, revealCommentId }: { version?: number; open?: DocsFrameApi["open"]; onBackToCurrent?: () => void; desktopOpen?: FrameDesktopOpenProps; revealCommentId?: string } = {}) {
  requestMock.mockImplementation((path: string) =>
    path === MINT_PATH ? Promise.resolve(minted) : String(path).startsWith("/api/v1/config") ? Promise.resolve({ flags: {} }) : Promise.reject(new Error(`unexpected ${path}`)));
  const api = { open: open ?? vi.fn(), save: vi.fn() } as unknown as DocsFrameApi;
  versionApi.create.mockReturnValue(api);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider defaultTheme="light" enableSystem={false}>
        <OfficeModuleFrame
          module="docs" wsId="ws-1" fileRef={{ kind: "document", id: "doc-1", ...(version ? { version } : {}) }} title="Plan" frameVersion="1.0.0"
          onBackToCurrent={onBackToCurrent} desktopOpen={desktopOpen} revealCommentId={revealCommentId}
        />
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
    api,
    inits: () => received.filter((m) => m.kind === "request" && m.type === "init"),
    ready: () => post(envelope("event", "ready", { protocolVersion: 1, capabilities: {}, module: "docs", instanceId: "i-1" })),
    request: (type: string, payload: unknown) => { void post(envelope("request", type, payload)); },
  };
}

afterEach(() => { versionApi.create.mockReset(); requestMock.mockReset(); resetAuthStoreForTests(); vi.restoreAllMocks(); });

describe("OfficeModuleFrame: a version view (UNI-2033)", () => {
  it("shows the read-only banner with the version number and a way back to the current one", async () => {
    const onBackToCurrent = vi.fn();
    mount({ version: 2, onBackToCurrent });
    expect(screen.getByTestId("office-version-view-banner")).toHaveTextContent("Bạn đang xem phiên bản 2 (chỉ đọc)");
    fireEvent.click(screen.getByRole("button", { name: "Về bản hiện tại" }));
    expect(onBackToCurrent).toHaveBeenCalledOnce();
  });

  it("has no banner on the current version", () => {
    mount({});
    expect(screen.queryByTestId("office-version-view-banner")).not.toBeInTheDocument();
    expect(versionApi.create).not.toHaveBeenCalled();
  });

  it("opens through the version API and inits the frame read-only", async () => {
    const frame = mount({ version: 2 });
    expect(versionApi.create).toHaveBeenCalledWith("docs", 2);
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === MINT_PATH)).toBe(true));
    await frame.ready();
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    expect(frame.inits()[0]?.payload).toMatchObject({ profile: "readOnly", capabilities: { save: false, saveAs: false, desktopOpen: false } });
  });

  it("answers an unknown version with the unavailable notice and the way back, not the generic failure", async () => {
    const onBackToCurrent = vi.fn();
    const open = vi.fn(async () => { throw new DocsProtocolError({ code: "not_found", message: "version 9 not found" }); });
    const frame = mount({ version: 9, open, onBackToCurrent });
    await frame.ready();
    await waitFor(() => expect(frame.inits()).toHaveLength(1));
    frame.request("api.open", { fileId: "doc-1" });
    await waitFor(() => expect(screen.getByTestId("office-version-view-unavailable")).toHaveTextContent("Không mở được phiên bản này"));
    fireEvent.click(screen.getByRole("button", { name: "Về bản hiện tại" }));
    expect(onBackToCurrent).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("office-version-view-banner")).not.toBeInTheDocument();
  });

  it("offers Open in UniWork Office from the banner for that version, with the comment", async () => {
    const createSession = vi.fn(async () => null);
    const desktopOpen = { deploymentId: "dep", savedVersion: 3, createSession } as unknown as FrameDesktopOpenProps;
    mount({ version: 2, desktopOpen: { ...desktopOpen, commentId: "c1" } });
    const banner = screen.getByTestId("office-version-view-banner");
    fireEvent.click(banner.querySelector("[data-office-desktop-action] button")!);
    await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
    expect(createSession).toHaveBeenCalledWith("doc-1", expect.objectContaining({ operation: "view", version: 2, comment_id: "c1" }));
  });
});

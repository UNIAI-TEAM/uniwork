import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { ApiError } from "@uniwork/core/api/http";
import { officeFrameKeys } from "@uniwork/core/documents/office-frame-hooks";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { DocsProtocolError, PROTOCOL_NS, PROTOCOL_VERSION, type Envelope } from "@uniwork/core/office/docs-frame-protocol";
import { ThemeProvider, useTheme } from "@uniwork/ui/components/common/theme-provider";
import { leaveGuardAllows } from "../../navigation/leave-guard";
import { requestMock } from "../../test/api-mock";
import { HeaderActionsSlot, HeaderActionsSlotProvider } from "../../layout/header-actions-slot";
import { DocsFrameRefusalContext } from "./docs-frame-refusal";
import { OfficeDocsFrame, type OfficeDocsFrameProps } from "./office-docs-frame";

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

const FILE = { fileId: "doc-1", name: "Plan.docx" };

const MINT_PATH = "/api/v1/documents/doc-1/office/frame-token";
const minted = (token: string) => ({
  token, token_type: "Bearer", expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600,
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: true,
});
const mintCalls = () => requestMock.mock.calls.filter(([path]) => path === MINT_PATH);

/** The frame token comes from W6's mint endpoint, through the mocked transport. */
function serveTokens(answer: (n: number) => Promise<unknown> = (n) => Promise.resolve(minted(`tok-${n}`))) {
  let n = 0;
  requestMock.mockImplementation((path: string) => (path === MINT_PATH ? answer((n += 1)) : Promise.reject(new Error(`unexpected ${path}`))));
}

function fakeApi(overrides: Partial<DocsFrameApi> = {}) {
  const api = {
    open: vi.fn(async () => ({ file: FILE, source: { kind: "url" as const, url: "https://files.test/signed" } })),
    save: vi.fn(async () => ({ ok: true as const, file: FILE, versionId: "v2" })),
    recents: vi.fn(async () => ({ files: [FILE] })),
    uploadImage: vi.fn(),
    ...overrides,
  };
  return api as unknown as DocsFrameApi & typeof api;
}

function ThemeFlip() {
  const { setTheme } = useTheme();
  return <button type="button" onClick={() => setTheme("dark")}>flip</button>;
}

function mount(props: Partial<OfficeDocsFrameProps> = {}, api = fakeApi(), tokens = true) {
  if (tokens) serveTokens();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (extra: Partial<OfficeDocsFrameProps> = {}): ReactElement => (
    <QueryClientProvider client={client}>
      <ThemeProvider defaultTheme="light" enableSystem={false}>
        <ThemeFlip />
        <OfficeDocsFrame wsId="ws-1" documentId="doc-1" title="Plan" frameVersion="1.0.0" api={api} {...props} {...extra} />
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(ui());
  return { api, client, view, rerender: (extra: Partial<OfficeDocsFrameProps>) => view.rerender(ui(extra)) };
}

/**
 * The frame's side of the wire: records what the host posts to the iframe
 * window and lets the test post back as that window, from the page's origin.
 */
function fakeFrame({ ackInit = true } = {}) {
  const iframe = screen.getByTestId("office-docs-frame-iframe") as HTMLIFrameElement;
  const win = iframe.contentWindow!;
  const received: Envelope[] = [];
  let seq = 0;
  const post = (data: unknown) => act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin: window.location.origin, source: win }));
  });
  const envelope = (kind: Envelope["kind"], type: string, payload: unknown, id = `f${(seq += 1)}`): Envelope =>
    ({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id, kind, type, payload });
  vi.spyOn(win, "postMessage").mockImplementation((message: unknown, origin?: unknown) => {
    expect(origin).toBe(window.location.origin);
    const m = message as Envelope;
    received.push(m);
    if (ackInit && m.kind === "request" && m.type === "init") {
      queueMicrotask(() => { void post(envelope("response", "init", { protocolVersion: 1, capabilities: {} }, m.id)); });
    }
  });
  return {
    win,
    received,
    event: (type: string, payload: unknown) => post(envelope("event", type, payload)),
    respond: (to: Envelope, payload: unknown) => post(envelope("response", to.type, payload, to.id)),
    request: (type: string, payload: unknown) => { const e = envelope("request", type, payload); void post(e); return e.id; },
    sent: (kind: Envelope["kind"], type: string) => received.filter((m) => m.kind === kind && m.type === type),
    answerTo: (id: string) => received.find((m) => m.kind === "response" && m.id === id),
  };
}

async function boot(frame: ReturnType<typeof fakeFrame>) {
  await frame.event("ready", { protocolVersion: 1, capabilities: {} });
  await waitFor(() => expect(screen.queryByTestId("office-docs-frame-loading")).toBeNull());
}

afterEach(() => { toastError.mockReset(); toastSuccess.mockReset(); requestMock.mockReset(); });

describe("OfficeDocsFrame", () => {
  it("serves the pinned build same-origin and hands the token over in init once the frame is ready", async () => {
    mount();
    const iframe = screen.getByTestId("office-docs-frame-iframe");
    expect(iframe.getAttribute("src")).toBe("/office-frame/docs/1.0.0/index.html");
    expect(iframe.getAttribute("title")).toBe("Trình soạn thảo tài liệu: Plan");
    const frame = fakeFrame();
    expect(screen.getByTestId("office-docs-frame-loading")).toBeTruthy();
    await waitFor(() => expect(mintCalls()).toHaveLength(1));
    expect(mintCalls()[0]?.[1]).toMatchObject({ method: "POST" });
    expect(frame.sent("request", "init")).toHaveLength(0);
    await boot(frame);
    const [init] = frame.sent("request", "init");
    expect(init?.payload).toMatchObject({
      protocolVersion: 1, token: "tok-1", documentId: "doc-1", workspaceId: "ws-1", apiMode: "host-proxy",
      locale: "vi", theme: "light", capabilities: { save: true, images: true, saveAs: false, exportPdf: false, attachments: false, ai: false },
    });
    expect(frame.sent("request", "init")).toHaveLength(1);
  });

  it("waits for the token before init", async () => {
    let mint!: (value: unknown) => void;
    serveTokens(() => new Promise((resolve) => { mint = resolve; }));
    mount({}, fakeApi(), false);
    const frame = fakeFrame();
    await frame.event("ready", { protocolVersion: 1, capabilities: {} });
    expect(frame.sent("request", "init")).toHaveLength(0);
    await act(async () => { mint(minted("late")); });
    await waitFor(() => expect(frame.sent("request", "init")[0]?.payload).toMatchObject({ token: "late" }));
  });

  it("proxies api requests with the frame token and scope, and answers with the API result", async () => {
    const { api } = mount();
    const frame = fakeFrame();
    await boot(frame);
    const openId = frame.request("api.open", { fileId: "doc-1" });
    const saveId = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(4), etag: "e1" });
    await waitFor(() => expect(frame.answerTo(saveId)).toBeTruthy());
    expect(frame.answerTo(openId)?.payload).toMatchObject({ file: FILE, source: { kind: "url" } });
    expect(frame.answerTo(saveId)?.payload).toMatchObject({ ok: true, versionId: "v2" });
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "doc-1", etag: "e1" }),
      expect.objectContaining({ token: "tok-1", workspaceId: "ws-1", documentId: "doc-1" }),
    );
  });

  it("answers requests with no UniWork route yet (export, save-as, file picker) as unsupported", async () => {
    mount();
    const frame = fakeFrame();
    await boot(frame);
    const ids = [
      frame.request("api.export", { format: "pdf" }),
      frame.request("api.saveAs", { name: "Copy.docx", data: new ArrayBuffer(1) }),
      frame.request("file.pick", { purpose: "open" }),
    ];
    await waitFor(() => expect(ids.map((id) => frame.answerTo(id)?.error?.code)).toEqual(["unsupported", "unsupported", "unsupported"]));
  });

  it("moves the frame to the copy after save-as: new token pushed, later calls scoped to the copy", async () => {
    const onSavedAs = vi.fn();
    const copy = { fileId: "doc-2", name: "Copy.docx" };
    const saveAs = vi.fn(async () => ({ save: { ok: true as const, file: copy, versionId: "v-c1" }, rebind: { documentId: "doc-2", token: minted("copy-tok") } }));
    const api = fakeApi({ saveAs });
    mount({ onSavedAs }, api);
    const frame = fakeFrame();
    await boot(frame);
    expect(frame.sent("request", "init")[0]?.payload).toMatchObject({ capabilities: { saveAs: true } });
    await frame.event("dirty", { dirty: true });
    const id = frame.request("api.saveAs", { name: "Copy", data: new ArrayBuffer(2) });
    await waitFor(() => expect(frame.answerTo(id)?.payload).toMatchObject({ ok: true, file: copy }));
    // The page follows the copy right away: the unsaved edits live in the copy, so no leave dialog.
    await waitFor(() => expect(document.querySelector("[data-office-docs-frame]")?.hasAttribute("data-dirty")).toBe(false));
    await expect(leaveGuardAllows("/documents/doc-2")).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(saveAs).toHaveBeenCalledWith(expect.objectContaining({ name: "Copy" }), expect.objectContaining({ documentId: "doc-1", token: "tok-1" }));
    expect(frame.sent("event", "token.update").at(-1)?.payload).toMatchObject({ token: "copy-tok" });
    expect(onSavedAs).toHaveBeenCalledWith("doc-2", "Copy");
    expect(toastSuccess).toHaveBeenCalledWith('Đã tạo bản sao "Copy"');
    frame.request("api.recents", {});
    await waitFor(() => expect(api.recents).toHaveBeenCalledWith({}, expect.objectContaining({ documentId: "doc-2", token: "copy-tok" })));
    expect(mintCalls()).toHaveLength(1);
  });

  it("passes an API error to the frame as a typed error", async () => {
    mount({}, fakeApi({ open: vi.fn(async () => { throw new DocsProtocolError({ code: "not_found", message: "gone", status: 404 }); }) }));
    const frame = fakeFrame();
    await boot(frame);
    const id = frame.request("api.open", { fileId: "doc-1" });
    await waitFor(() => expect(frame.answerTo(id)?.error).toMatchObject({ code: "not_found", status: 404 }));
  });

  it("grants a read-only viewer no write capability and refuses its writes", async () => {
    const { api } = mount({ readonly: true });
    const frame = fakeFrame();
    await boot(frame);
    expect(frame.sent("request", "init")[0]?.payload).toMatchObject({ capabilities: { save: false, saveAs: false, images: false } });
    const id = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(1) });
    await waitFor(() => expect(frame.answerTo(id)?.error?.code).toBe("forbidden"));
    expect(api.save).not.toHaveBeenCalled();
  });

  it("re-mints on token.refresh and rotates a re-minted token to the frame", async () => {
    const { client } = mount();
    const frame = fakeFrame();
    await boot(frame);
    const id = frame.request("token.refresh", { reason: "unauthorized" });
    await waitFor(() => expect(frame.answerTo(id)?.payload).toMatchObject({ token: "tok-2" }));
    expect(frame.sent("event", "token.update")).toHaveLength(0);
    await act(async () => { await client.refetchQueries({ queryKey: officeFrameKeys.token("ws-1", "doc-1") }); });
    await waitFor(() => expect(frame.sent("event", "token.update")[0]?.payload).toMatchObject({ token: "tok-3" }));
    expect(mintCalls()).toHaveLength(3);
  });

  it("follows the page's theme and language", async () => {
    mount();
    const frame = fakeFrame();
    await boot(frame);
    fireEvent.click(screen.getByRole("button", { name: "flip" }));
    await waitFor(() => expect(frame.sent("event", "theme")[0]?.payload).toEqual({ theme: "dark" }));
    await act(async () => { await setLocale("en"); });
    await waitFor(() => expect(frame.sent("event", "language")[0]?.payload).toEqual({ locale: "en" }));
  });

  it("reports the frame's title, and sizes to content when asked", async () => {
    const onTitleChange = vi.fn();
    mount({ onTitleChange, fitContent: true });
    const frame = fakeFrame();
    await boot(frame);
    await frame.event("title", { title: "Kế hoạch Q4" });
    await frame.event("resize", { height: 1200 });
    expect(onTitleChange).toHaveBeenCalledWith("Kế hoạch Q4");
    const iframe = screen.getByTestId("office-docs-frame-iframe");
    expect(iframe.getAttribute("title")).toBe("Trình soạn thảo tài liệu: Kế hoạch Q4");
    expect(iframe.style.height).toBe("1200px");
  });

  it("asks before leaving a dirty document: discard leaves, stay keeps, save leaves once the frame saved", async () => {
    mount();
    const frame = fakeFrame();
    await boot(frame);
    await expect(leaveGuardAllows("/elsewhere")).resolves.toBe(true);
    await frame.event("dirty", { dirty: true });

    let leaving = leaveGuardAllows("/elsewhere");
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Giữ bản nháp trên thiết bị này" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ thay đổi" }));
    await expect(leaving).resolves.toBe(true);

    leaving = leaveGuardAllows("/elsewhere");
    fireEvent.click(await screen.findByRole("button", { name: "Ở lại" }));
    await expect(leaving).resolves.toBe(false);

    leaving = leaveGuardAllows("/elsewhere");
    fireEvent.click(await screen.findByRole("button", { name: "Lưu lên UniWork" }));
    await waitFor(() => expect(frame.sent("request", "save")).toHaveLength(1));
    const save = frame.sent("request", "save")[0]!;
    expect(save.payload).toEqual({ reason: "navigate" });
    await frame.respond(save, { ok: true, file: FILE, versionId: "v3" });
    await expect(leaving).resolves.toBe(true);

    await frame.event("dirty", { dirty: false });
    await expect(leaveGuardAllows("/elsewhere")).resolves.toBe(true);
  });

  it("prints the document on Ctrl+P from the page", async () => {
    mount();
    const frame = fakeFrame();
    await boot(frame);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(frame.sent("request", "print")[0]?.payload).toEqual({ mode: "dialog" }));
  });

  it("toasts a non-fatal error, and replaces the editor with a retry on a fatal one", async () => {
    mount();
    let frame = fakeFrame();
    await boot(frame);
    await frame.event("error", { error: { code: "busy", message: "save in flight" }, fatal: false });
    expect(toastError).toHaveBeenCalledWith("Một lần lưu khác của tài liệu này vẫn đang chạy. Hãy thử lại sau giây lát.");
    // A save conflict is answered by the frame's own dialog: the host does not say it again.
    toastError.mockClear();
    await frame.event("error", { error: { code: "conflict", message: "412" }, fatal: false });
    expect(toastError).not.toHaveBeenCalled();
    await frame.event("error", { error: { code: "malformed", message: "x" }, fatal: true });
    const failed = screen.getByTestId("office-docs-frame-failed");
    expect(failed.getAttribute("data-failure-kind")).toBe("failed");
    expect(failed.textContent).toContain("Không mở được tài liệu");
    expect(failed.textContent).toContain("UniWork gặp sự cố khi mở tài liệu này. Hãy thử lại sau giây lát.");

    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    frame = fakeFrame();
    await boot(frame);
    expect(frame.sent("request", "init")).toHaveLength(1);
    expect(mintCalls()).toHaveLength(1);
  });

  it("shows a retry when no token can be minted", async () => {
    serveTokens((n) => (n === 1 ? Promise.reject(new ApiError("no", "forbidden", 403)) : Promise.resolve(minted("tok-ok"))));
    mount({}, fakeApi(), false);
    const alert = await screen.findByTestId("office-docs-frame-failed");
    expect(alert.getAttribute("data-failure-kind")).toBe("denied");
    expect(alert.textContent).toContain("Bạn không có quyền truy cập tài liệu này.");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    const frame = fakeFrame();
    await boot(frame);
    expect(frame.sent("request", "init")[0]?.payload).toMatchObject({ token: "tok-ok" });
  });

  it.each([[403], [404]])("says the editor is not turned on (not that the document is gone) when the mint is refused with feature_disabled (HTTP %i)", async (status) => {
    serveTokens(() => Promise.reject(new ApiError("feature is disabled", "feature_disabled", status)));
    mount({}, fakeApi(), false);
    const alert = await screen.findByTestId("office-docs-frame-failed");
    expect(alert.textContent).toContain("Trình soạn thảo tài liệu mới chưa được bật cho tổ chức của bạn.");
    expect(alert.textContent).not.toContain("không còn tồn tại");
  });

  it("tells the switch around it to fall back when the mint is refused with feature_disabled", async () => {
    serveTokens(() => Promise.reject(new ApiError("feature is disabled", "feature_disabled", 403)));
    const refuse = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DocsFrameRefusalContext.Provider value={refuse}>
          <OfficeDocsFrame wsId="ws-1" documentId="doc-1" title="Plan" frameVersion="1.0.0" api={fakeApi()} />
        </DocsFrameRefusalContext.Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(refuse).toHaveBeenCalledTimes(1));
  });

  it("exposes save and print controls to the hosting page", async () => {
    const controlsRef = { current: null as { save: () => Promise<boolean>; print: () => Promise<boolean> } | null };
    mount({ controlsRef });
    const frame = fakeFrame();
    await boot(frame);
    const saving = controlsRef.current!.save();
    await waitFor(() => expect(frame.sent("request", "save")).toHaveLength(1));
    await frame.respond(frame.sent("request", "save")[0]!, { ok: false, error: { code: "conflict", message: "412" } });
    await expect(saving).resolves.toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("names a save-as copy of the source the way UniWork names a copy", async () => {
    const saveAs = vi.fn(async () => ({ save: { ok: true as const, file: FILE, versionId: "v-c1" }, rebind: { documentId: "doc-2", token: minted("copy-tok") } }));
    const onSavedAs = vi.fn();
    mount({ onSavedAs, title: "Plan.docx" }, fakeApi({ saveAs }));
    const frame = fakeFrame();
    await boot(frame);
    const id = frame.request("api.saveAs", { name: "plan.docx", data: new ArrayBuffer(2) });
    await waitFor(() => expect(frame.answerTo(id)?.payload).toMatchObject({ ok: true }));
    expect(saveAs).toHaveBeenCalledWith(expect.objectContaining({ name: "plan (bản sao).docx" }), expect.anything());
    expect(onSavedAs).toHaveBeenCalledWith("doc-2", "plan (bản sao).docx");
    expect(toastSuccess).toHaveBeenCalledWith('Đã tạo bản sao "plan (bản sao)"');
  });

  it("shows the frame's save state in the page header: clean, unsaved, saving, saved", async () => {
    let finish!: (value: { ok: true; file: typeof FILE; versionId: string }) => void;
    const save = vi.fn(() => new Promise<{ ok: true; file: typeof FILE; versionId: string }>((resolve) => { finish = resolve; }));
    serveTokens();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <HeaderActionsSlotProvider>
          <header data-testid="page-header"><HeaderActionsSlot /></header>
          <OfficeDocsFrame wsId="ws-1" documentId="doc-1" title="Plan" frameVersion="1.0.0" api={fakeApi({ save })} />
        </HeaderActionsSlotProvider>
      </QueryClientProvider>,
    );
    const header = screen.getByTestId("page-header");
    expect(header.textContent).toBe("");
    const frame = fakeFrame();
    await boot(frame);
    await waitFor(() => expect(header.textContent).toBe("Chưa có thay đổi"));
    await frame.event("dirty", { dirty: true });
    await waitFor(() => expect(header.textContent).toBe("Chưa lưu"));
    const id = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(1) });
    await waitFor(() => expect(header.textContent).toBe("Đang lưu…"));
    await act(async () => { finish({ ok: true, file: FILE, versionId: "v2" }); });
    await waitFor(() => expect(frame.answerTo(id)).toBeTruthy());
    // The answer came back before the frame's dirty:false: still unsaved until the frame says clean.
    expect(header.textContent).toBe("Chưa lưu");
    await frame.event("dirty", { dirty: false });
    await frame.event("saved", { file: FILE, versionId: "v2" });
    await waitFor(() => expect(header.textContent).toBe("Đã lưu"));
    await frame.event("dirty", { dirty: true });
    await waitFor(() => expect(header.textContent).toBe("Chưa lưu"));
  });

  it("says the editor is unavailable on this server (no retry) and offers the standard editor", async () => {
    serveTokens(() => Promise.reject(new ApiError("office frame is not configured", "storage_unavailable", 501)));
    const refuse = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DocsFrameRefusalContext.Provider value={refuse}>
          <OfficeDocsFrame wsId="ws-1" documentId="doc-1" title="Plan" frameVersion="1.0.0" api={fakeApi()} />
        </DocsFrameRefusalContext.Provider>
      </QueryClientProvider>,
    );
    const alert = await screen.findByTestId("office-docs-frame-failed");
    expect(alert.getAttribute("data-failure-kind")).toBe("unavailable");
    expect(alert.textContent).toContain("Chưa dùng được trình soạn thảo tài liệu mới");
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
    expect(refuse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mở bằng trình soạn thảo tiêu chuẩn" }));
    expect(refuse).toHaveBeenCalledTimes(1);
  });

  it("tells a dropped connection apart from a failure, with a retry", async () => {
    serveTokens(() => Promise.reject(new TypeError("Failed to fetch")));
    mount({}, fakeApi(), false);
    const alert = await screen.findByTestId("office-docs-frame-failed");
    expect(alert.getAttribute("data-failure-kind")).toBe("network");
    expect(alert.textContent).toContain("Không kết nối được tới UniWork");
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeTruthy();
  });

  it("reads a 503 from the mint as a failure worth retrying, not as an unavailable editor", async () => {
    serveTokens(() => Promise.reject(new ApiError("down", "internal", 503)));
    mount({}, fakeApi(), false);
    const alert = await screen.findByTestId("office-docs-frame-failed");
    expect(alert.getAttribute("data-failure-kind")).toBe("failed");
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeTruthy();
  });
});

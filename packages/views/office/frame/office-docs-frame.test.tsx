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
import { OfficeTooLargeProvider } from "../too-large-notice";
import { OfficeModuleFrame, type OfficeModuleFrameProps } from "./office-module-frame";

type OfficeDocsFrameProps = Omit<OfficeModuleFrameProps, "module">;

/** The docs module of OfficeModuleFrame, the way the web host mounts it. */
function OfficeDocsFrame(props: OfficeDocsFrameProps) {
  return <OfficeModuleFrame module="docs" {...props} />;
}
import { NavigationProvider, type NavigationAdapter } from "../../navigation";

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

/** jsdom has no window.focus: the frame's focus hand-back lands on spies instead of a "not implemented" error. */
function spyFrameFocus() {
  const iframe = screen.getByTestId("office-docs-frame-iframe") as HTMLIFrameElement;
  return {
    iframe,
    focusIframe: vi.spyOn(iframe, "focus"),
    focusWindow: vi.spyOn(iframe.contentWindow!, "focus").mockImplementation(() => undefined),
  };
}

function ThemeFlip() {
  const { setTheme } = useTheme();
  return <button type="button" onClick={() => setTheme("dark")}>flip</button>;
}

const navigation: NavigationAdapter = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/", searchParams: new URLSearchParams(), getShareableUrl: (path) => path };

function mount(props: Partial<OfficeDocsFrameProps> = {}, api = fakeApi(), tokens = true) {
  if (tokens) serveTokens();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (extra: Partial<OfficeDocsFrameProps> = {}): ReactElement => (
    <QueryClientProvider client={client}>
      <NavigationProvider value={navigation}>
        <ThemeProvider defaultTheme="light" enableSystem={false}>
          <ThemeFlip />
          <OfficeDocsFrame wsId="ws-1" documentId="doc-1" title="Plan" frameVersion="1.0.0" api={api} {...props} {...extra} />
        </ThemeProvider>
      </NavigationProvider>
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
    spyFrameFocus();
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

  it("hands keyboard focus back to the editor frame when the leave dialog closes with Stay or Escape", async () => {
    mount();
    const frame = fakeFrame();
    await boot(frame);
    await frame.event("dirty", { dirty: true });
    const { focusIframe, focusWindow } = spyFrameFocus();

    let leaving = leaveGuardAllows("/elsewhere");
    fireEvent.click(await screen.findByRole("button", { name: "Ở lại" }));
    await expect(leaving).resolves.toBe(false);
    await waitFor(() => expect(focusWindow).toHaveBeenCalledTimes(1));
    expect(focusIframe).toHaveBeenCalledTimes(1);

    leaving = leaveGuardAllows("/elsewhere");
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await expect(leaving).resolves.toBe(false);
    await waitFor(() => expect(focusWindow).toHaveBeenCalledTimes(2));
    // Not on the page element that held focus before the dialog opened.
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "flip" }));
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

  it("gives a denied reader the reason and the way back to the list, never a retry", async () => {
    serveTokens(() => Promise.reject(new ApiError("no", "forbidden", 403)));
    mount({ libraryHref: "/acme/ops/documents" }, fakeApi(), false);
    const alert = await screen.findByTestId("office-docs-frame-failed");
    expect(alert.getAttribute("data-failure-kind")).toBe("denied");
    expect(alert.textContent).toContain("Bạn không có quyền truy cập tài liệu này.");
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
    expect(screen.getByRole("link", { name: "Về thư viện tài liệu" })).toHaveAttribute("href", "/acme/ops/documents");
  });

  it("shows a retry when the token mint failed for a reason a retry can fix", async () => {
    serveTokens((n) => (n === 1 ? Promise.reject(new ApiError("down", "internal", 500)) : Promise.resolve(minted("tok-ok"))));
    mount({}, fakeApi(), false);
    const alert = await screen.findByTestId("office-docs-frame-failed");
    expect(alert.getAttribute("data-failure-kind")).toBe("failed");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    const frame = fakeFrame();
    await boot(frame);
    expect(frame.sent("request", "init")[0]?.payload).toMatchObject({ token: "tok-ok" });
  });

  it.each([[403], [404]])("says the editor is not turned on (not that the document is gone) when the mint is refused with feature_disabled (HTTP %i)", async (status) => {
    serveTokens(() => Promise.reject(new ApiError("feature is disabled", "feature_disabled", status)));
    mount({}, fakeApi(), false);
    const alert = await screen.findByTestId("office-docs-frame-failed");
    expect(alert.textContent).toContain("Tổ chức của bạn chưa bật mở loại tệp này trên web.");
    expect(alert.textContent).not.toContain("không còn tồn tại");
  });

  it("shows its own unavailable notice on feature_disabled, and asks the switch for nothing", async () => {
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
    const alert = await screen.findByTestId("office-docs-frame-failed");
    expect(alert.getAttribute("data-failure-kind")).toBe("unavailable");
    expect(refuse).not.toHaveBeenCalled();
  });

  it("exposes save and print controls to the hosting page", async () => {
    const controlsRef = { current: null as { save: () => Promise<boolean>; print: () => Promise<boolean> } | null };
    mount({ controlsRef });
    const frame = fakeFrame();
    await boot(frame);
    const saving = controlsRef.current!.save();
    await waitFor(() => expect(frame.sent("request", "save")).toHaveLength(1));
    await frame.respond(frame.sent("request", "save")[0]!, { ok: false, error: { code: "forbidden", message: "403" } });
    await expect(saving).resolves.toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  describe("a page Save that meets a newer version: the frame's conflict dialog answers it", () => {
    const flip = () => screen.getByRole("button", { name: "flip" });

    it("shows no dialog of its own, makes the page inert while the frame's is open, and reads Cancel as unsaved", async () => {
      const controlsRef = { current: null as { save: () => Promise<boolean>; print: () => Promise<boolean> } | null };
      mount({ controlsRef });
      const frame = fakeFrame();
      await boot(frame);
      await frame.event("dirty", { dirty: true });
      const { focusWindow } = spyFrameFocus();
      const saving = controlsRef.current!.save();
      await waitFor(() => expect(frame.sent("request", "save")).toHaveLength(1));
      expect(frame.sent("request", "save")[0]!.payload).toEqual({ reason: "user" });
      await frame.event("modal", { open: true });
      expect(flip()).toHaveAttribute("inert");
      expect(screen.queryByRole("dialog")).toBeNull();
      await frame.event("modal", { open: false });
      expect(flip()).not.toHaveAttribute("inert");
      // The keyboard goes back into the frame, where the user was.
      await waitFor(() => expect(focusWindow).toHaveBeenCalled());
      await frame.respond(frame.sent("request", "save")[0]!, { ok: false, error: { code: "cancelled", message: "user cancelled" } });
      await expect(saving).resolves.toBe(false);
      expect(document.querySelector("[data-office-docs-frame]")).toHaveAttribute("data-save-state", "dirty");
      expect(toastError).not.toHaveBeenCalled();
    });

    it("suspends the page's Ctrl+P while the frame's dialog is open", async () => {
      mount();
      const frame = fakeFrame();
      await boot(frame);
      await frame.event("modal", { open: true });
      fireEvent.keyDown(window, { key: "p", ctrlKey: true });
      expect(frame.sent("request", "print")).toHaveLength(0);
      await frame.event("modal", { open: false });
      fireEvent.keyDown(window, { key: "p", ctrlKey: true });
      await waitFor(() => expect(frame.sent("request", "print")).toHaveLength(1));
    });

    async function leavingWithSave() {
      mount();
      const frame = fakeFrame();
      await boot(frame);
      await frame.event("dirty", { dirty: true });
      spyFrameFocus();
      const leaving = leaveGuardAllows("/elsewhere");
      fireEvent.click(await screen.findByRole("button", { name: "Lưu lên UniWork" }));
      await waitFor(() => expect(frame.sent("request", "save")).toHaveLength(1));
      const save = frame.sent("request", "save")[0]!;
      expect(save.payload).toEqual({ reason: "navigate" });
      return { frame, save, leaving };
    }

    it("holds the leave until the frame answers, stepping the leave dialog aside while the frame's is open", async () => {
      const { frame, save, leaving } = await leavingWithSave();
      let settled = false;
      void leaving.then(() => { settled = true; });
      await frame.event("modal", { open: true });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(settled).toBe(false);
      await frame.event("modal", { open: false });
      await frame.respond(save, { ok: true, file: FILE, versionId: "v9" });
      await expect(leaving).resolves.toBe(true);
    });

    describe("when the frame's dialog closes before its answer", () => {
      async function closedBeforeAnswer() {
        const held = await leavingWithSave();
        await held.frame.event("modal", { open: true });
        await held.frame.event("modal", { open: false });
        // The answer is still on its way: the leave controls must not come back meanwhile.
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByRole("button", { name: "Lưu lên UniWork" })).toBeNull();
        return held;
      }

      it("keeps the leave dialog closed, then leaves on saved", async () => {
        const { frame, save, leaving } = await closedBeforeAnswer();
        await frame.respond(save, { ok: true, file: FILE, versionId: "v10" });
        await expect(leaving).resolves.toBe(true);
        expect(screen.queryByRole("dialog")).toBeNull();
      });

      it("keeps the leave dialog closed, then stays on cancelled without reopening it", async () => {
        const { frame, save, leaving } = await closedBeforeAnswer();
        await frame.respond(save, { ok: false, error: { code: "cancelled", message: "user cancelled" } });
        await expect(leaving).resolves.toBe(false);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(toastError).not.toHaveBeenCalled();
      });

      it("reopens the leave dialog with its failure line only on a failed answer", async () => {
        const { frame, save, leaving } = await closedBeforeAnswer();
        await frame.respond(save, { ok: false, error: { code: "internal", message: "refused", status: 500 } });
        expect(await screen.findByRole("dialog")).toHaveTextContent("Không thể xác nhận thao tác");
        expect(screen.getByRole("button", { name: "Lưu lên UniWork" })).not.toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Ở lại" }));
        await expect(leaving).resolves.toBe(false);
      });
    });

    it("leaves once Reload latest answered", async () => {
      const { frame, save, leaving } = await leavingWithSave();
      await frame.event("modal", { open: true });
      await frame.event("modal", { open: false });
      await frame.respond(save, { ok: true, file: FILE });
      await expect(leaving).resolves.toBe(true);
    });

    it("stays on the page when the user cancels the frame's dialog, without an error", async () => {
      const { frame, save, leaving } = await leavingWithSave();
      await frame.event("modal", { open: true });
      await frame.respond(save, { ok: false, error: { code: "cancelled", message: "user cancelled" } });
      await frame.event("modal", { open: false });
      await expect(leaving).resolves.toBe(false);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(toastError).not.toHaveBeenCalled();
      // A later leave starts clean: no failure line left over.
      const again = leaveGuardAllows("/elsewhere");
      expect(await screen.findByRole("dialog")).not.toHaveTextContent("Không thể xác nhận thao tác");
      fireEvent.click(screen.getByRole("button", { name: "Ở lại" }));
      await expect(again).resolves.toBe(false);
    });

    it.each([["unauthorized", 401], ["forbidden", 403], ["not_found", 410], ["internal", 500]] as const)(
      "says %s (HTTP %i) and keeps the leave dialog open",
      async (code, status) => {
        const { frame, save, leaving } = await leavingWithSave();
        await frame.respond(save, { ok: false, error: { code, message: "refused", status } });
        await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
        expect(await screen.findByRole("dialog")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Ở lại" }));
        await expect(leaving).resolves.toBe(false);
      },
    );

    it("lifts the inert page and gives up the save when the frame document unloads", async () => {
      const controlsRef = { current: null as { save: () => Promise<boolean>; print: () => Promise<boolean> } | null };
      mount({ controlsRef });
      const frame = fakeFrame();
      await boot(frame);
      await frame.event("dirty", { dirty: true });
      const saving = controlsRef.current!.save();
      await waitFor(() => expect(frame.sent("request", "save")).toHaveLength(1));
      await frame.event("modal", { open: true });
      expect(flip()).toHaveAttribute("inert");
      const iframe = screen.getByTestId("office-docs-frame-iframe");
      act(() => { iframe.dispatchEvent(new Event("load")); iframe.dispatchEvent(new Event("load")); });
      await expect(saving).resolves.toBe(false);
      expect(flip()).not.toHaveAttribute("inert");
      expect(toastError).toHaveBeenCalledTimes(1);
    });

    it("lifts the inert page and gives up a leave save when the frame document goes away with nothing loaded after it", async () => {
      const { frame, save, leaving } = await leavingWithSave();
      await frame.event("modal", { open: true });
      expect(flip()).toHaveAttribute("inert");
      act(() => { frame.win.dispatchEvent(new Event("pagehide")); });
      await waitFor(() => expect(flip()).not.toHaveAttribute("inert"));
      await waitFor(() => expect(frame.received.some((m) => m.kind === "event" && m.type === "cancel" && (m.payload as { id?: string }).id === save.id)).toBe(true));
      // The leave is not decided behind the user's back: the leave dialog comes back with its failure line.
      expect(await screen.findByRole("dialog")).toHaveTextContent("Không thể xác nhận thao tác");
      fireEvent.click(screen.getByRole("button", { name: "Ở lại" }));
      await expect(leaving).resolves.toBe(false);
    });
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
    // The status text without the Save button that sits beside it.
    const statusText = () => {
      const copy = header.cloneNode(true) as HTMLElement;
      copy.querySelector("[data-office-frame-save]")?.remove();
      return copy.textContent;
    };
    const saveButton = () => header.querySelector("[data-office-frame-save]");
    expect(header.textContent).toBe("");
    const frame = fakeFrame();
    await boot(frame);
    await waitFor(() => expect(statusText()).toBe("Chưa có thay đổi"));
    // Nothing to save: the button stays in the tab order but is quiet, named in full for assistive tech.
    expect(saveButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(saveButton()?.getAttribute("aria-label")).toBe("Lưu vào UniWork");
    await frame.event("dirty", { dirty: true });
    await waitFor(() => expect(saveButton()?.getAttribute("aria-disabled")).toBeNull());
    await waitFor(() => expect(statusText()).toBe("Chưa lưu"));
    const id = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(1) });
    await waitFor(() => expect(statusText()).toBe("Đang lưu…"));
    await act(async () => { finish({ ok: true, file: FILE, versionId: "v2" }); });
    await waitFor(() => expect(frame.answerTo(id)).toBeTruthy());
    // The answer came back before the frame's dirty:false: still unsaved until the frame says clean.
    expect(statusText()).toBe("Chưa lưu");
    await frame.event("dirty", { dirty: false });
    await frame.event("saved", { file: FILE, versionId: "v2" });
    await waitFor(() => expect(statusText()).toBe("Đã lưu"));
    await frame.event("dirty", { dirty: true });
    await waitFor(() => expect(statusText()).toBe("Chưa lưu"));
  });

  it("leaves the failed-save state when the next edit reports dirty", async () => {
    const save = vi.fn(async () => { throw new DocsProtocolError({ code: "network", message: "offline" }); });
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
    // The status text without the Save button that sits beside it.
    const statusText = () => {
      const copy = header.cloneNode(true) as HTMLElement;
      copy.querySelector("[data-office-frame-save]")?.remove();
      return copy.textContent;
    };
    const frame = fakeFrame();
    await boot(frame);
    await frame.event("dirty", { dirty: true });
    const id = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(1) });
    await waitFor(() => expect(frame.answerTo(id)?.error).toBeTruthy());
    // The failure holds although the frame still reports dirty.
    await waitFor(() => expect(statusText()).toContain("Chưa xác nhận được việc lưu"));
    // The next edit reports dirty again: the header goes back to "Unsaved".
    await frame.event("dirty", { dirty: true });
    await waitFor(() => expect(statusText()).toBe("Chưa lưu"));
  });

  it("says the editor is unavailable on this server (no retry) and offers the host's open-in-app and download", async () => {
    serveTokens(() => Promise.reject(new ApiError("office frame is not configured", "storage_unavailable", 501)));
    const onDownload = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <OfficeTooLargeProvider value={{ desktopAction: <button type="button">Mở trong UniWork Office</button>, onDownload }}>
          <OfficeDocsFrame wsId="ws-1" documentId="doc-1" title="Plan" frameVersion="1.0.0" api={fakeApi()} />
        </OfficeTooLargeProvider>
      </QueryClientProvider>,
    );
    const alert = await screen.findByTestId("office-docs-frame-failed");
    expect(alert.getAttribute("data-failure-kind")).toBe("unavailable");
    expect(alert.textContent).toContain("Chưa mở được tài liệu trên web");
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mở trong UniWork Office" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tải xuống" }));
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
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

  describe("a leave that is pending when the frame fails for good", () => {
    const flip = () => screen.getByRole("button", { name: "flip" });
    const FATAL = { error: { code: "internal", message: "editor crashed" }, fatal: true };

    async function dirtyFrame() {
      mount();
      const frame = fakeFrame();
      await boot(frame);
      await frame.event("dirty", { dirty: true });
      spyFrameFocus();
      return frame;
    }

    async function leavingWithSave() {
      const frame = await dirtyFrame();
      const leaving = leaveGuardAllows("/elsewhere");
      fireEvent.click(await screen.findByRole("button", { name: "Lưu lên UniWork" }));
      await waitFor(() => expect(frame.sent("request", "save")).toHaveLength(1));
      await frame.event("modal", { open: true });
      return { frame, leaving };
    }

    it("refuses the leave when a fatal error ends its Save under the frame's dialog", async () => {
      const { frame, leaving } = await leavingWithSave();
      await frame.event("error", FATAL);
      expect(screen.getByTestId("office-docs-frame-failed")).toBeInTheDocument();
      await expect(leaving).resolves.toBe(false);
      expect(flip()).not.toHaveAttribute("inert");
      expect(toastError).toHaveBeenCalledTimes(1);
    });

    it("refuses the leave when a new frame instance fails its handshake during the Save", async () => {
      const { frame, leaving } = await leavingWithSave();
      await frame.event("ready", { protocolVersion: 99, capabilities: {}, module: "docs", instanceId: "i-2" });
      expect(await screen.findByTestId("office-docs-frame-failed")).toBeInTheDocument();
      await expect(leaving).resolves.toBe(false);
      expect(flip()).not.toHaveAttribute("inert");
    });

    it("refuses the leave a user is still reading when the frame fails", async () => {
      const frame = await dirtyFrame();
      const leaving = leaveGuardAllows("/elsewhere");
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      await frame.event("error", FATAL);
      expect(screen.getByTestId("office-docs-frame-failed")).toBeInTheDocument();
      await expect(leaving).resolves.toBe(false);
    });

    it("does not hold a later leave behind a failure screen that has no editor to save", async () => {
      const frame = await dirtyFrame();
      await frame.event("error", FATAL);
      await expect(leaveGuardAllows("/elsewhere")).resolves.toBe(true);
    });

    it("keeps the page usable when the frame reports a dialog after its document went away", async () => {
      const frame = await dirtyFrame();
      await frame.event("modal", { open: true });
      expect(flip()).toHaveAttribute("inert");
      act(() => { frame.win.dispatchEvent(new Event("pagehide")); });
      await waitFor(() => expect(flip()).not.toHaveAttribute("inert"));
      await frame.event("modal", { open: true });
      expect(flip()).not.toHaveAttribute("inert");
      expect(document.querySelector("[data-office-docs-frame]")).not.toHaveAttribute("data-frame-modal");
      // A replacement load lifts nothing and leaves the page as usable as it was.
      const iframe = screen.getByTestId("office-docs-frame-iframe");
      act(() => { iframe.dispatchEvent(new Event("load")); });
      expect(flip()).not.toHaveAttribute("inert");
      expect(document.querySelector("[data-office-docs-frame]")).not.toHaveAttribute("data-frame-modal");
    });
  });

  it("dims the page chrome while the frame shows a modal dialog of its own", async () => {
    serveTokens();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <nav data-testid="chrome">sidebar</nav>
        <OfficeDocsFrame wsId="ws-1" documentId="doc-1" title="Plan" frameVersion="1.0.0" api={fakeApi()} />
      </QueryClientProvider>,
    );
    const frame = fakeFrame();
    await boot(frame);
    const chrome = screen.getByTestId("chrome");
    expect(chrome.hasAttribute("inert")).toBe(false);
    await frame.event("modal", { open: true });
    await waitFor(() => expect(chrome.hasAttribute("inert")).toBe(true));
    expect(chrome.hasAttribute("data-office-frame-modal-dimmed")).toBe(true);
    expect(screen.getByTestId("office-docs-frame-iframe").closest("[inert]")).toBeNull();
    await frame.event("modal", { open: false });
    await waitFor(() => expect(chrome.hasAttribute("inert")).toBe(false));
    expect(chrome.style.filter).toBe("");
  });

  describe("SIZE-W1b: size_warning chip and save_blocked dialog", () => {
    const MIB = 1024 * 1024;

    it("grants capabilities.sizeUi: true and passes limits in init and api.open", async () => {
      mount();
      const frame = fakeFrame();
      await boot(frame);
      expect(frame.sent("request", "init")[0]?.payload).toMatchObject({
        capabilities: { sizeUi: true },
        limits: { max_bytes: 200 * MIB, warn_ratio: 0.9 },
      });
      const openId = frame.request("api.open", { fileId: "doc-1" });
      await waitFor(() => expect(frame.answerTo(openId)?.payload).toBeDefined());
      expect(frame.answerTo(openId)?.payload).toMatchObject({
        file: FILE,
        limits: { max_bytes: 200 * MIB, warn_ratio: 0.9 },
      });
    });

    it("shows the size_warning status-bar chip once per document session with formatted {{max}} and {{size}}", async () => {
      const { rerender } = mount();
      const frame = fakeFrame();
      await boot(frame);
      expect(screen.queryByTestId("office-size-warning-chip")).toBeNull();

      await frame.event("size_warning", { bytes: Math.round(185.4 * MIB), max_bytes: 200 * MIB, warn_ratio: 0.9 });
      const chip = await screen.findByTestId("office-size-warning-chip");
      expect(chip).toHaveTextContent("Sắp chạm giới hạn 200 MB (đang 185,4 MB).");

      // A second size_warning in the same document session stays latched to the first chip.
      await frame.event("size_warning", { bytes: Math.round(195 * MIB), max_bytes: 200 * MIB, warn_ratio: 0.9 });
      expect(screen.getByTestId("office-size-warning-chip")).toHaveTextContent("Sắp chạm giới hạn 200 MB (đang 185,4 MB).");

      // Switching to another document resets the latch.
      requestMock.mockImplementation((path: string) =>
        path === "/api/v1/documents/doc-2/office/frame-token"
          ? Promise.resolve({ ...minted("tok-doc-2"), document_id: "doc-2" })
          : Promise.reject(new Error(`unexpected ${path}`)),
      );
      rerender({ documentId: "doc-2" });
      await waitFor(() => expect(screen.queryByTestId("office-size-warning-chip")).toBeNull());
    });

    it("opens the save_blocked dialog without closing or reloading the frame or clearing the draft, and Tải bản của tôi triggers doc.download -> api.download", async () => {
      mount();
      const frame = fakeFrame();
      await boot(frame);
      await frame.event("dirty", { dirty: true });
      const iframeBefore = screen.getByTestId("office-docs-frame-iframe");

      const clicks: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this.download);
      });
      Object.assign(URL, { createObjectURL: vi.fn(() => "blob:my-copy"), revokeObjectURL: vi.fn() });

      await frame.event("save_blocked", { bytes: 205 * MIB, max_bytes: 200 * MIB, reason: "over_max_bytes" });
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("Chưa lưu được lên UniWork");
      expect(dialog).toHaveTextContent(
        "Tài liệu đã vượt 200 MB. Thay đổi của bạn vẫn ở đây. Tải bản của bạn về máy rồi giảm dung lượng ảnh hoặc chia nhỏ tài liệu.",
      );

      // Frame stays ready, same iframe instance, draft stays dirty.
      const container = document.querySelector("[data-office-docs-frame]")!;
      expect(container).toHaveAttribute("data-state", "ready");
      expect(container).toHaveAttribute("data-dirty", "true");
      expect(screen.getByTestId("office-docs-frame-iframe")).toBe(iframeBefore);

      // Clicking "Tải bản của tôi" sends doc.download to the frame; the frame then calls api.download.
      fireEvent.click(screen.getByRole("button", { name: "Tải bản của tôi" }));
      await waitFor(() => expect(frame.sent("request", "doc.download")).toHaveLength(1));
      const dlReq = frame.sent("request", "doc.download")[0]!;
      expect(dlReq.payload).toEqual({});

      const apiDlId = frame.request("api.download", { data: new ArrayBuffer(16) });
      await frame.respond(dlReq, { delivered: true });
      await waitFor(() => expect(frame.answerTo(apiDlId)?.payload).toEqual({ delivered: true }));
      expect(clicks).toEqual(["Plan (bản của tôi).docx"]);

      // Closing the dialog leaves the frame open and dirty.
      fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(container).toHaveAttribute("data-state", "ready");
      expect(container).toHaveAttribute("data-dirty", "true");
      expect(screen.getByTestId("office-docs-frame-iframe")).toBe(iframeBefore);
    });

    it("opens the same save_blocked dialog with {{max}} from fields.max_bytes when api.save or api.saveAs returns 413 file_too_large", async () => {
      const save = vi.fn(async () => {
        throw new ApiError("file exceeds limit", "file_too_large", 413, undefined, { max_bytes: 150 * MIB });
      });
      const saveAs = vi.fn(async () => {
        throw new ApiError("copy exceeds limit", "file_too_large", 413, undefined, { max_bytes: 120 * MIB });
      });
      mount({}, fakeApi({ save, saveAs }));
      const frame = fakeFrame();
      await boot(frame);
      await frame.event("dirty", { dirty: true });

      const saveId = frame.request("api.save", { fileId: "doc-1", data: new ArrayBuffer(8), etag: "e1" });
      await waitFor(() => expect(frame.answerTo(saveId)?.error?.code).toBe("too_large"));
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("Chưa lưu được lên UniWork");
      expect(dialog).toHaveTextContent("Tài liệu đã vượt 150 MB.");
      expect(toastError).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      const saveAsId = frame.request("api.saveAs", { name: "Copy.docx", data: new ArrayBuffer(8) });
      await waitFor(() => expect(frame.answerTo(saveAsId)?.error?.code).toBe("too_large"));
      const dialog2 = await screen.findByRole("dialog");
      expect(dialog2).toHaveTextContent("Tài liệu đã vượt 120 MB.");
      expect(toastError).not.toHaveBeenCalled();
    });
  });
});

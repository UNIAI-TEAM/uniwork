import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { officeDocsFrameKeys, type DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import { DocsProtocolError, PROTOCOL_NS, PROTOCOL_VERSION, type Envelope } from "@uniwork/core/office/docs-frame-protocol";
import { ThemeProvider, useTheme } from "@uniwork/ui/components/common/theme-provider";
import { leaveGuardAllows } from "../../navigation/leave-guard";
import { OfficeDocsFrame, type OfficeDocsFrameProps } from "./office-docs-frame";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const FILE = { fileId: "doc-1", name: "Plan.docx" };

function fakeApi(overrides: Partial<DocsFrameApi> = {}) {
  let n = 0;
  const api = {
    mintToken: vi.fn(async () => ({ token: `tok-${(n += 1)}`, tokenExpiresAt: Date.now() + 10 * 60_000 })),
    open: vi.fn(async () => ({ file: FILE, source: { kind: "url" as const, url: "https://files.test/signed" } })),
    save: vi.fn(async () => ({ ok: true as const, file: FILE, versionId: "v2" })),
    saveAs: vi.fn(),
    recents: vi.fn(async () => ({ files: [FILE] })),
    export: vi.fn(),
    addAttachments: vi.fn(),
    uploadImage: vi.fn(),
    ...overrides,
  };
  return api as unknown as DocsFrameApi & typeof api;
}

function ThemeFlip() {
  const { setTheme } = useTheme();
  return <button type="button" onClick={() => setTheme("dark")}>flip</button>;
}

function mount(props: Partial<OfficeDocsFrameProps> = {}, api = fakeApi()) {
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

afterEach(() => { toastError.mockReset(); });

describe("OfficeDocsFrame", () => {
  it("serves the pinned build same-origin and hands the token over in init once the frame is ready", async () => {
    const { api } = mount();
    const iframe = screen.getByTestId("office-docs-frame-iframe");
    expect(iframe.getAttribute("src")).toBe("/office-frame/docs/1.0.0/index.html");
    expect(iframe.getAttribute("title")).toBe("Trình soạn thảo tài liệu: Plan");
    const frame = fakeFrame();
    expect(screen.getByTestId("office-docs-frame-loading")).toBeTruthy();
    await waitFor(() => expect(api.mintToken).toHaveBeenCalledWith({ workspaceId: "ws-1", documentId: "doc-1" }));
    expect(frame.sent("request", "init")).toHaveLength(0);
    await boot(frame);
    const [init] = frame.sent("request", "init");
    expect(init?.payload).toMatchObject({
      protocolVersion: 1, token: "tok-1", documentId: "doc-1", workspaceId: "ws-1", apiMode: "host-proxy",
      locale: "vi", theme: "light", capabilities: { save: true, ai: false },
    });
    expect(frame.sent("request", "init")).toHaveLength(1);
  });

  it("waits for the token before init", async () => {
    let mint!: (value: { token: string; tokenExpiresAt: number }) => void;
    const api = fakeApi({ mintToken: vi.fn(() => new Promise<{ token: string; tokenExpiresAt: number }>((resolve) => { mint = resolve; })) });
    mount({}, api);
    const frame = fakeFrame();
    await frame.event("ready", { protocolVersion: 1, capabilities: {} });
    expect(frame.sent("request", "init")).toHaveLength(0);
    await act(async () => { mint({ token: "late", tokenExpiresAt: Date.now() + 600_000 }); });
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
    const { api, client } = mount();
    const frame = fakeFrame();
    await boot(frame);
    const id = frame.request("token.refresh", { reason: "unauthorized" });
    await waitFor(() => expect(frame.answerTo(id)?.payload).toMatchObject({ token: "tok-2" }));
    expect(frame.sent("event", "token.update")).toHaveLength(0);
    await act(async () => { await client.refetchQueries({ queryKey: officeDocsFrameKeys.token("ws-1", "doc-1") }); });
    await waitFor(() => expect(frame.sent("event", "token.update")[0]?.payload).toMatchObject({ token: "tok-3" }));
    expect(api.mintToken).toHaveBeenCalledTimes(3);
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
    expect(frame.sent("request", "print")[0]?.payload).toEqual({ mode: "dialog" });
  });

  it("toasts a non-fatal error, and replaces the editor with a retry on a fatal one", async () => {
    const { api } = mount();
    let frame = fakeFrame();
    await boot(frame);
    await frame.event("error", { error: { code: "conflict", message: "412" }, fatal: false });
    expect(toastError).toHaveBeenCalledWith("Đã có người lưu phiên bản mới hơn. Hãy mở lại tài liệu để xem trước khi lưu.");
    await frame.event("error", { error: { code: "malformed", message: "x" }, fatal: true });
    expect(screen.getByTestId("office-docs-frame-failed").textContent).toContain("Trình soạn thảo tài liệu gặp lỗi.");

    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    frame = fakeFrame();
    await boot(frame);
    expect(frame.sent("request", "init")).toHaveLength(1);
    expect(api.mintToken).toHaveBeenCalledTimes(1);
  });

  it("shows a retry when no token can be minted", async () => {
    mount({}, fakeApi({ mintToken: vi.fn(async () => { throw new DocsProtocolError({ code: "forbidden", message: "no" }); }) }));
    const alert = await screen.findByTestId("office-docs-frame-failed", undefined, { timeout: 4_000 });
    expect(alert.textContent).toContain("Bạn không có quyền thực hiện thao tác này trong tài liệu.");
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
});

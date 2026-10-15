import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { defaultEditLockRoute, editLockRoute, lockState } from "../test/edit-lock-fake";
import { DocumentWorkspace } from "./document-workspace";

// UNI-1645 (addendum §9, §11.3): the document page with the edit lock wired in.

const { t } = initI18n();
type RouteOpts = Parameters<typeof editLockRoute>[1];

function pageDocument(over: Record<string, unknown> = {}): Document {
  const parsed = DocumentSchema.parse({
    id: "d1", workspace_id: "ws1", kind: "page", title: "Kế hoạch Q3",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Nội dung A" }] }] },
    content_text: "Nội dung A", revision: "3", current_version: 1, my_level: "edit",
    created_at: "2026-09-28T03:00:00Z", updated_at: "2026-09-28T03:00:00Z", ...over,
  });
  return { ...parsed, kind: "page", visibility: "workspace", my_level: parsed.my_level as Document["my_level"], via: undefined, owner_kind: undefined } as Document;
}

const today = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const SINCE = today(0, 12);
const holder = { holder_id: "u2", holder_name: "An", since: SINCE, expires_at: today(0, 14), reserved: false, held_by_me: false };
const locked = () => new ApiError("locked", "document_locked", 423, undefined, { ...holder, held_by_me: false, current_revision: "3" });

function renderPage({ search = "", refetch = vi.fn(async () => ({ data: pageDocument() })) } = {}) {
  const adapter: NavigationAdapter = {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/acme/doi/documents/d1",
    searchParams: new URLSearchParams(search), getShareableUrl: (path) => path,
  };
  render(wrap(
    <NavigationProvider value={adapter}>
      <DocumentWorkspace wsId="ws1" doc={pageDocument()} libraryHref="/acme/doi/documents" refetch={refetch} />
    </NavigationProvider>,
  ));
  return { refetch };
}

const findEditor = () => screen.findByRole("textbox", { name: t("documents.editor.aria_label") }, { timeout: 15_000 });
const lockCalls = (method: string, suffix = "") =>
  editLockRoute.mock.calls.filter(([path, opts]) => (opts?.method ?? "GET") === method && String(path).endsWith(`/documents/d1/edit-lock${suffix}`));

function pasteText(text: string) {
  const surface = screen.getByRole("textbox", { name: t("documents.editor.aria_label") });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [], getData: (type: string) => (type === "text/plain" ? text : "") } });
  fireEvent(surface, event);
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
});
afterEach(() => vi.restoreAllMocks());

describe("DocumentWorkspace edit lock", () => {
  it("while R2 is in flight: content shows, input waits, and nothing says read-only", async () => {
    editLockRoute.mockImplementation((path: string, opts: RouteOpts) =>
      opts?.method === "POST" && path.endsWith("/edit-lock") ? new Promise(() => undefined) : defaultEditLockRoute(path, opts));
    renderPage();
    const editor = await findEditor();
    expect(editor).toHaveTextContent("Nội dung A");
    expect(editor).toHaveAttribute("contenteditable", "false");
    expect(screen.queryByText(t("documents.save.readonly"))).toBeNull();
    expect(screen.getByTestId("edit-lock-banner")).toBeEmptyDOMElement();
  });

  it("holding the lock: editable, and autosave sends edit_lock_id", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      Promise.resolve(path === "/api/v1/documents/d1" && opts?.method === "PATCH" ? { document: pageDocument({ revision: "4" }) } : {}));
    renderPage();
    const editor = await findEditor();
    await waitFor(() => expect(editor).toHaveAttribute("contenteditable", "true"));
    expect(lockCalls("POST")[0]?.[1]?.body).toMatchObject({ client: "web_page" });
    pasteText("Xin chào");
    await waitFor(() => expect(requestMock.mock.calls.some(([path, opts]) => path === "/api/v1/documents/d1" && (opts as { method?: string }).method === "PATCH")).toBe(true), { timeout: 8_000 });
    const patch = requestMock.mock.calls.find(([path, opts]) => path === "/api/v1/documents/d1" && (opts as { method?: string }).method === "PATCH");
    expect((patch?.[1] as { body: Record<string, unknown> }).body).toMatchObject({ edit_lock_id: "lock-d1", revision: "3" });
  });

  it("someone else holds it: read-only with their name and avatar, a request goes to them, nothing is written", async () => {
    editLockRoute.mockImplementation((path: string, opts: RouteOpts) => {
      if (opts?.method === "POST" && path.endsWith("/edit-lock")) return Promise.reject(locked());
      if (opts?.method === "POST" && path.endsWith("/edit-requests")) return Promise.resolve({ request_id: "r1", document_id: "d1", requester_id: "me", requester_name: "Bình", holder_id: "u2", status: "pending", created_at: SINCE, expires_at: today(23, 59) });
      if ((opts?.method ?? "GET") === "GET") return Promise.resolve(lockState({ lock: holder, can_request: true }));
      return defaultEditLockRoute(path, opts);
    });
    renderPage();
    const editor = await findEditor();
    const banner = screen.getByTestId("edit-lock-banner");
    await waitFor(() => expect(banner).toHaveTextContent("An đang sửa từ"));
    expect(editor).toHaveAttribute("contenteditable", "false");
    expect(screen.getByRole("img", { name: "An đang sửa" })).toBeTruthy();
    fireEvent.click(within(banner).getByRole("button", { name: "Yêu cầu quyền sửa" }));
    await waitFor(() => expect(editLockRoute.mock.calls.some(([path, opts]) => String(path).endsWith("/edit-requests") && opts?.method === "POST")).toBe(true));
    expect(requestMock.mock.calls.some(([, opts]) => (opts as { method?: string } | undefined)?.method === "PATCH")).toBe(false);
  });

  it("a save answered 423: read-only, the lost dialog (no conflict dialog), and the copy downloads as .html", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      path === "/api/v1/documents/d1" && opts?.method === "PATCH" ? Promise.reject(locked()) : Promise.resolve({}));
    const clicked: HTMLAnchorElement[] = [];
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:copy"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    renderPage();
    const editor = await findEditor();
    await waitFor(() => expect(editor).toHaveAttribute("contenteditable", "true"));
    pasteText("chưa lưu");
    const dialog = await screen.findByRole("alertdialog", { name: "Bạn không còn quyền sửa" }, { timeout: 8_000 });
    expect(dialog).toHaveTextContent("An đã lấy quyền sửa. Thay đổi chưa lưu của bạn vẫn ở đây.");
    expect(screen.queryByText(t("documents.conflict.title"))).toBeNull();
    expect(editor).toHaveAttribute("contenteditable", "false");
    expect(editor).toHaveTextContent("chưa lưu");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tải bản của tôi" }));
    expect(clicked.at(-1)?.download).toBe("Kế hoạch Q3 (bản của tôi).html");
  });

  it("'Edit now' once the lock came free acquires again without reloading the page", async () => {
    // A was editing when this tab opened (423) and has since closed: R1 reads no holder.
    let refused = false;
    editLockRoute.mockImplementation((path: string, opts: RouteOpts) => {
      if (opts?.method === "POST" && path.endsWith("/edit-lock") && !refused) { refused = true; return Promise.reject(locked()); }
      return defaultEditLockRoute(path, opts);
    });
    const { refetch } = renderPage();
    const editor = await findEditor();
    const banner = screen.getByTestId("edit-lock-banner");
    await waitFor(() => expect(banner).toHaveTextContent("Không còn ai sửa tài liệu này."));
    expect(editor).toHaveAttribute("contenteditable", "false");
    fireEvent.click(within(banner).getByRole("button", { name: "Sửa ngay" }));
    await waitFor(() => expect(editor).toHaveAttribute("contenteditable", "true"));
    expect(refetch).toHaveBeenCalled();
    expect(lockCalls("POST")).toHaveLength(2);
    await waitFor(() => expect(banner).toBeEmptyDOMElement());
  });

  it("?edit_request=<id> opens the holder's prompt; Decline answers with the held lock id", async () => {
    const request = { request_id: "r1", document_id: "d1", requester_id: "u3", requester_name: "Chi", holder_id: "me", status: "pending", created_at: SINCE, expires_at: today(23, 59) };
    editLockRoute.mockImplementation((path: string, opts: RouteOpts) => {
      if ((opts?.method ?? "GET") === "GET") return Promise.resolve(lockState({ lock: { ...holder, holder_id: "me", holder_name: "Tôi", held_by_me: true }, pending_requests: [request] }));
      if (path.endsWith("/answer")) return Promise.resolve({ ...request, status: "declined" });
      return defaultEditLockRoute(path, opts);
    });
    renderPage({ search: "edit_request=r1" });
    await findEditor();
    const prompt = await screen.findByRole("region", { name: "Chi muốn sửa tài liệu này" });
    await waitFor(() => expect(prompt).toHaveFocus());
    fireEvent.click(within(prompt).getByRole("button", { name: "Từ chối" }));
    await waitFor(() => expect(editLockRoute.mock.calls.some(([path]) => String(path).endsWith("/edit-requests/r1/answer"))).toBe(true));
    const answer = editLockRoute.mock.calls.find(([path]) => String(path).endsWith("/answer"));
    expect(answer?.[1]?.body).toEqual({ decision: "decline", lock_id: "lock-d1" });
  });
});

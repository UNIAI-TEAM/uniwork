import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import "../test/lazy-document-editor";
import { defaultEditLockRoute, editLockRoute, grantedLock, lockState } from "../test/edit-lock-fake";
import { DocumentWorkspace } from "./document-workspace";
import { reportWriteRefused } from "./edit-lock-refusal";

// UNI-1645 CFE-1-1: a 423 that was answered for an older lock id must not end the hold on a regained lock.

const { t } = initI18n();
type RouteOpts = Parameters<typeof editLockRoute>[1];

function pageDocument(): Document {
  const parsed = DocumentSchema.parse({
    id: "d1", workspace_id: "ws1", kind: "page", title: "Kế hoạch Q3",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Nội dung A" }] }] },
    content_text: "Nội dung A", revision: "3", current_version: 1, my_level: "edit",
    created_at: "2026-09-28T03:00:00Z", updated_at: "2026-09-28T03:00:00Z",
  });
  return { ...parsed, kind: "page", visibility: "workspace", my_level: parsed.my_level as Document["my_level"], via: undefined, owner_kind: undefined } as Document;
}

const SINCE = "2026-10-15T03:12:00Z";
const elsewhere = { holder_id: "me", holder_name: "Tôi", since: SINCE, expires_at: "2026-10-15T03:14:00Z", reserved: false, held_by_me: true };

function renderPage() {
  const adapter: NavigationAdapter = {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/acme/doi/documents/d1",
    searchParams: new URLSearchParams(), getShareableUrl: (path) => path,
  };
  render(wrap(
    <NavigationProvider value={adapter}>
      <DocumentWorkspace wsId="ws1" doc={pageDocument()} libraryHref="/acme/doi/documents" refetch={vi.fn(async () => ({ data: pageDocument() }))} />
    </NavigationProvider>,
  ));
}

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

describe("DocumentWorkspace edit lock: regaining after a 423", () => {
  it("423 -> lost -> Edit here -> still mine, and the kept draft PATCH carries the new lock id and lands", async () => {
    let moved = false;
    let refused = false;
    editLockRoute.mockImplementation((path: string, opts: RouteOpts) => {
      if (opts?.method === "POST" && path.endsWith("/edit-lock")) {
        const body = opts.body as { move_from_self?: boolean } | undefined;
        if (refused) moved = true;
        return Promise.resolve(grantedLock("d1", { lock_id: refused ? "lock-new" : "lock-d1", granted_via: refused ? "move" : "acquire", ...(body ? {} : {}) }));
      }
      if ((opts?.method ?? "GET") === "GET") return Promise.resolve(refused && !moved ? lockState({ lock: elsewhere }) : lockState());
      return defaultEditLockRoute(path, opts);
    });
    const patches: Array<Record<string, unknown>> = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/api/v1/documents/d1" && opts?.method === "PATCH") {
        patches.push(opts.body ?? {});
        // Only the id the server granted last is valid: lock-d1 until it was taken, lock-new after "Edit here".
        const valid = moved ? "lock-new" : "none"; // the first write finds the lock already taken
        if (opts.body?.edit_lock_id !== valid) {
          refused = true;
          return Promise.reject(new ApiError("locked", "document_locked", 423, undefined, { ...elsewhere, held_by_me: true, current_revision: "3" }));
        }
        return Promise.resolve({ document: { ...pageDocument(), revision: "4" } });
      }
      return Promise.resolve({});
    });
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:copy"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    renderPage();
    const editor = await screen.findByRole("textbox", { name: t("documents.editor.aria_label") }, { timeout: 15_000 });
    await waitFor(() => expect(editor).toHaveAttribute("contenteditable", "true"));
    pasteText("chưa lưu");
    const dialog = await screen.findByRole("alertdialog", { name: "Bạn không còn quyền sửa" }, { timeout: 8_000 });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tải bản của tôi" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(editor).toHaveAttribute("contenteditable", "false");
    // Past the quiet window: a kept draft must not go out while the lock is gone (nor mark the new lock lost later).
    await new Promise((resolve) => setTimeout(resolve, 2_600));

    fireEvent.click(screen.getByRole("button", { name: "Sửa ở đây" }));
    await waitFor(() => expect(editor).toHaveAttribute("contenteditable", "true"));
    // The regained lock stays held, and the kept draft goes out under the NEW id.
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ edit_lock_id: "lock-new" }), { timeout: 8_000 });
    expect(patches[0]).toMatchObject({ edit_lock_id: "lock-d1" });
    await waitFor(() => expect(patches.filter((b) => b.edit_lock_id === "lock-new")).toHaveLength(1));
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("two 423s without holder fields around a regain: the second ends the hold too (CFE-2-1)", async () => {
    let regained = false;
    editLockRoute.mockImplementation((path: string, opts: RouteOpts) => {
      if (opts?.method === "POST" && path.endsWith("/edit-lock")) {
        return Promise.resolve(grantedLock("d1", { lock_id: regained ? "lock-new" : "lock-d1", granted_via: "acquire" }));
      }
      if ((opts?.method ?? "GET") === "GET") return Promise.resolve(lockState());
      return defaultEditLockRoute(path, opts);
    });
    const patches: Array<Record<string, unknown>> = [];
    // Every write is refused, and the refusal carries no fields (a proxy, a body that does not parse).
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/api/v1/documents/d1" && opts?.method === "PATCH") {
        patches.push(opts.body ?? {});
        return Promise.reject(new ApiError("locked", "document_locked", 423));
      }
      return Promise.resolve({});
    });
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:copy"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    renderPage();
    const editor = await screen.findByRole("textbox", { name: t("documents.editor.aria_label") }, { timeout: 15_000 });
    await waitFor(() => expect(editor).toHaveAttribute("contenteditable", "true"));
    pasteText("chưa lưu");
    const dialog = await screen.findByRole("alertdialog", { name: "Bạn không còn quyền sửa" }, { timeout: 8_000 });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tải bản của tôi" }));
    await waitFor(() => expect(editor).toHaveAttribute("contenteditable", "false"));
    expect(patches).toHaveLength(1);

    regained = true;
    fireEvent.click(await screen.findByRole("button", { name: "Sửa ngay" }));
    await waitFor(() => expect(editor).toHaveAttribute("contenteditable", "true"));
    // The kept draft goes out under the new id and is refused again: that is a second loss, not a no-op.
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ edit_lock_id: "lock-new" }), { timeout: 8_000 });
    await waitFor(() => expect(editor).toHaveAttribute("contenteditable", "false"), { timeout: 8_000 });
    await screen.findByRole("alertdialog", { name: "Bạn không còn quyền sửa" });
  });

  it("a restore / file commit refused 423 under the held id ends the hold; one under an older id does not (CFE-1-12)", async () => {
    renderPage();
    const editor = await screen.findByRole("textbox", { name: t("documents.editor.aria_label") }, { timeout: 15_000 });
    await waitFor(() => expect(editor).toHaveAttribute("contenteditable", "true"));
    act(() => reportWriteRefused("d1", { ...elsewhere, held_by_me: false, holder_id: "u2", holder_name: "An" }, "lock-older"));
    expect(editor).toHaveAttribute("contenteditable", "true");
    act(() => reportWriteRefused("d1", { ...elsewhere, held_by_me: false, holder_id: "u2", holder_name: "An" }, "lock-d1"));
    await waitFor(() => expect(editor).toHaveAttribute("contenteditable", "false"));
  });
});

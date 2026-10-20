import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import "../test/lazy-document-editor";
import { DocumentWorkspace } from "./document-workspace";

vi.mock("sonner", async (orig) => {
  const mod = await orig<typeof import("sonner")>();
  return { ...mod, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

// UNI-1645 CFE-1-13: "Reload latest" in the lost dialog must not drop the draft when the reread fails.

const { t } = initI18n();

function pageDocument(): Document {
  const parsed = DocumentSchema.parse({
    id: "d1", workspace_id: "ws1", kind: "page", title: "Kế hoạch Q3",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Nội dung A" }] }] },
    content_text: "Nội dung A", revision: "3", current_version: 1, my_level: "edit",
    created_at: "2026-09-28T03:00:00Z", updated_at: "2026-09-28T03:00:00Z",
  });
  return { ...parsed, kind: "page", visibility: "workspace", my_level: parsed.my_level as Document["my_level"], via: undefined, owner_kind: undefined } as Document;
}

function pasteText(text: string) {
  const surface = screen.getByRole("textbox", { name: t("documents.editor.aria_label") });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [], getData: (type: string) => (type === "text/plain" ? text : "") } });
  fireEvent(surface, event);
}

async function loseTheLockWithADraft(refetch: () => Promise<{ data?: Document | null; isError?: boolean }>) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
    path === "/api/v1/documents/d1" && opts?.method === "PATCH"
      ? Promise.reject(new ApiError("locked", "document_locked", 423, undefined, { holder_id: "u2", holder_name: "An", held_by_me: false }))
      : Promise.resolve({}));
  const adapter: NavigationAdapter = {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/acme/doi/documents/d1",
    searchParams: new URLSearchParams(), getShareableUrl: (path) => path,
  };
  render(wrap(
    <NavigationProvider value={adapter}>
      <DocumentWorkspace wsId="ws1" doc={pageDocument()} libraryHref="/acme/doi/documents" refetch={refetch} />
    </NavigationProvider>,
  ));
  const editor = await screen.findByRole("textbox", { name: t("documents.editor.aria_label") }, { timeout: 15_000 });
  await waitFor(() => expect(editor).toHaveAttribute("contenteditable", "true"));
  pasteText("chưa lưu");
  const dialog = await screen.findByRole("alertdialog", { name: "Bạn không còn quyền sửa" }, { timeout: 8_000 });
  return { editor, dialog };
}

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("DocumentWorkspace: reload latest after losing the lock", () => {
  it("keeps the unsaved draft and says so when the reread fails", async () => {
    const refetch = vi.fn(async () => ({ data: null, isError: true }));
    const { editor, dialog } = await loseTheLockWithADraft(refetch);
    fireEvent.click(within(dialog).getByRole("button", { name: "Tải lại bản mới nhất" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Tải lại bản mới nhất" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Tải lại bản mới nhất" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.editLock.reloadFailed")));
    expect(refetch).toHaveBeenCalled();
    expect(editor).toHaveTextContent("chưa lưu");
    // The draft is still the page's own: leaving would ask about it.
  });
});

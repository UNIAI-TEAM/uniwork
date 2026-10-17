import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { DOCUMENT_TITLE_MAX, FOLDER_TITLE_MAX, TREE_MAX_LEVEL } from "@uniwork/core/documents/folder-limits";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";
import type { DocumentSummaryRow } from "./library-rows";
import { useLibraryRowDialogs } from "./use-library-row-dialogs";

// The dialogs behind the row menu and header "New -> Folder", driven through
// the hook and DocumentsPageView: create folder, create subfolder, rename,
// save a file from another module, move a document, archive one.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

const WS = "ws1";
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const TREE_URL = `${LIST_BASE}/tree`;
const tree: DocumentTreeNode[] = [
  { id: "fa", title: "Hợp đồng", kind: "folder", parent_id: null, position: 0, children: [{ id: "fb", title: "Quý 4", kind: "folder", parent_id: "fa", position: 0, children: [] }] },
  { id: "d1", title: "Kế hoạch", kind: "page", parent_id: null, position: 1, children: [] },
];
const doc = { id: "d1", workspace_id: WS, kind: "page", title: "Kế hoạch", revision: "1", parent_id: null, updated_at: "2026-09-28T03:00:00Z" } as unknown as DocumentSummaryRow;
const folderDoc = { id: "fa", workspace_id: WS, kind: "folder", title: "Hợp đồng", revision: "3", parent_id: null, my_level: "manage", breadcrumbs: [], updated_at: "2026-09-28T03:00:00Z" } as unknown as DocumentSummaryRow;
const source = { id: "chat:m1", name: "Đề xuất.pdf" } as DocumentSourceFile;
const sourceRow = { type: "source" as const, id: "source:chat:m1", source };

function Harness({ folderId = null, item = doc }: { folderId?: string | null; item?: DocumentSummaryRow }) {
  const row = useLibraryRowDialogs({ wsId: WS, tree, folderId });
  return (
    <>
      <button type="button" onClick={() => row.onCreateFolder?.()}>cmd-create-folder</button>
      <button type="button" onClick={() => row.onNewSubfolder?.(folderDoc)}>cmd-new-subfolder</button>
      <button type="button" onClick={() => row.onRename?.(item)}>cmd-rename</button>
      <button type="button" onClick={() => row.onMove(item)}>cmd-move</button>
      <button type="button" onClick={() => row.onSaveSource(sourceRow)}>cmd-save</button>
      <button type="button" onClick={() => row.onArchive(doc)}>cmd-archive</button>
      {row.dialogs}
    </>
  );
}

function document(over: Record<string, unknown> = {}) {
  return { id: "d1", workspace_id: WS, kind: "page", title: "Kế hoạch", revision: "7", my_level: "manage", updated_at: "2026-09-28T03:00:00Z", ...over };
}

const testWorkspace = { id: WS, slug: WS, organization_id: "org1", organization_slug: "acme", name: "Team" } as unknown as Workspace;
const testUser = { id: "u1", email: "an@example.com", display_name: "An" } as unknown as User;

function renderPageView(search = "") {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  const adapter: NavigationAdapter = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: `/acme/${WS}/documents`,
    searchParams: new URLSearchParams(search),
    getShareableUrl: (p) => p,
  };
  return render(
    wrap(
      <NavigationProvider value={adapter}>
        <WorkspaceProvider workspace={testWorkspace} user={testUser}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>
      </NavigationProvider>,
    ),
  );
}

const posts = () => requestMock.mock.calls.filter(([, opts]) => (opts as { method?: string } | undefined)?.method === "POST");
const patches = () => requestMock.mock.calls.filter(([, opts]) => (opts as { method?: string } | undefined)?.method === "PATCH");

beforeEach(async () => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  await setLocale("vi");
});

describe("move", () => {
  it("offers the folders in a tree, marks the current location disabled, and toasts 'Đã chuyển tới …' on move without rename", async () => {
    requestMock.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") return Promise.resolve({ document: document({ parent_id: "fb", revision: "8" }) });
      return Promise.resolve({ document: document() });
    });
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: t("documents.home.move.picker_title") })).toBeInTheDocument();
    expect(within(dialog).getByRole("treeitem", { name: "Quý 4" })).toBeInTheDocument();
    // A page is not a target.
    expect(within(dialog).queryByRole("treeitem", { name: "Kế hoạch" })).toBeNull();

    // Root is doc's current location (parent_id: null), so it is aria-disabled with reason_current and cannot be picked.
    const rootItem = within(dialog).getByRole("treeitem", { name: t("documents.home.move.root") });
    expect(rootItem).toHaveAttribute("aria-disabled", "true");
    expect(rootItem).toHaveAccessibleDescription(t("documents.home.move.reason_current"));
    fireEvent.click(rootItem);
    expect(rootItem).toHaveAttribute("aria-selected", "false");

    fireEvent.click(within(dialog).getByRole("treeitem", { name: "Quý 4" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(t("documents.home.move.moved_to", { folder: "Quý 4" })),
    );
    const [path, opts] = posts()[0]!;
    expect(path).toBe("/api/v1/documents/d1/move");
    expect((opts as { body: unknown }).body).toEqual({ parent_id: "fb", revision: "7" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("toasts 'Đã chuyển và đổi tên thành …' with the server-returned title when a move hits a name clash (FD-D5)", async () => {
    requestMock.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          document: document({ title: "Kế hoạch (2)", parent_id: "fa", revision: "8" }),
        });
      }
      return Promise.resolve({ document: document({ title: "Kế hoạch", revision: "7" }) });
    });
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("treeitem", { name: "Hợp đồng" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        t("documents.home.move.moved_renamed", { title: "Kế hoạch (2)" }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("allows picking Tài liệu (gốc) root when moving an item out of a folder and toasts the root destination", async () => {
    const nestedDoc = { ...doc, parent_id: "fa" } as unknown as DocumentSummaryRow;
    requestMock.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") {
        return Promise.resolve({ document: document({ parent_id: null, revision: "8" }) });
      }
      return Promise.resolve({ document: document({ parent_id: "fa", revision: "7" }) });
    });
    render(wrap(<Harness item={nestedDoc} />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");

    // Current folder "Hợp đồng" ("fa") is aria-disabled with reason_current and focusable
    const currentFolder = within(dialog).getByRole("treeitem", { name: "Hợp đồng" });
    expect(currentFolder).toHaveAttribute("aria-disabled", "true");
    expect(currentFolder).toHaveAccessibleDescription(t("documents.home.move.reason_current"));
    currentFolder.focus();
    expect(currentFolder).toHaveFocus();
    fireEvent.click(currentFolder);
    expect(currentFolder).toHaveAttribute("aria-selected", "false");

    // Tài liệu (gốc) root is enabled and pickable
    const rootItem = within(dialog).getByRole("treeitem", { name: t("documents.home.move.root") });
    expect(rootItem).not.toHaveAttribute("aria-disabled");
    fireEvent.click(rootItem);
    expect(rootItem).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        t("documents.home.move.moved_to", { folder: t("documents.home.move.root") }),
      ),
    );
    expect((posts()[0]?.[1] as { body: unknown }).body).toEqual({ parent_id: null, revision: "7" });
  });

  it("shows the moved folder itself and its subtree as aria-disabled with reason_self (focusable, not selectable)", async () => {
    render(wrap(<Harness item={folderDoc} />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");

    const selfRow = within(dialog).getByRole("treeitem", { name: "Hợp đồng" });
    const childRow = within(dialog).getByRole("treeitem", { name: "Quý 4" });
    for (const row of [selfRow, childRow]) {
      expect(row).toHaveAttribute("aria-disabled", "true");
      expect(row).toHaveAccessibleDescription(t("documents.home.move.reason_self"));
      expect(row).toHaveTextContent(t("documents.home.move.reason_self"));
      row.focus();
      expect(row).toHaveFocus();
      fireEvent.click(row);
      expect(row).toHaveAttribute("aria-selected", "false");
    }
  });

  it("keeps the dialog open with the generic reason when the revision cannot be read", async () => {
    requestMock.mockResolvedValue({});
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("treeitem", { name: "Hợp đồng" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.tree.move_failed"));
    expect(posts()).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("explains a refused move in the dialog and lets the person try again", async () => {
    let attempts = 0;
    requestMock.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method !== "POST") return Promise.resolve({ document: document() });
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new ApiError("server text", "document_too_deep", 422))
        : Promise.resolve({ document: document({ parent_id: "fa", revision: "8" }) });
    });
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("treeitem", { name: "Hợp đồng" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));
    expect(await within(dialog).findByText(t("documents.errors.document_too_deep", { max: TREE_MAX_LEVEL }))).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce());
    expect(within(dialog).queryByText(t("documents.errors.document_too_deep", { max: TREE_MAX_LEVEL }))).toBeNull();
  });

  it.each([
    ["a file", "file", "Báo cáo.pdf"],
    ["a page", "page", "Kế hoạch"],
  ])("moves %s alone: the dialog does not say the contents move too", async (_label, kind, name) => {
    const item = { ...doc, id: "x1", kind, title: name } as unknown as DocumentSummaryRow;
    render(wrap(<Harness item={item} />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(t("documents.home.move.description", { name }))).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(t("documents.home.move.folder_description", { name }));
  });

  it("says the contents move too when the item moved is a folder", async () => {
    const item = { ...doc, id: "f9", kind: "folder", title: "Dự án mới" } as unknown as DocumentSummaryRow;
    render(wrap(<Harness item={item} />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(t("documents.home.move.folder_description", { name: "Dự án mới" }))).toBeInTheDocument();
  });

  it("closes without moving when cancelled", async () => {
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.upload.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe("save a file from another module", () => {
  it("preselects the open folder and replays one idempotency key for the same target", async () => {
    let attempts = 0;
    requestMock.mockImplementation(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new ApiError("Hết giờ", "timeout", 504)) : Promise.resolve({ document: document({ id: "n1", kind: "file" }) });
    });
    render(wrap(<Harness folderId="fa" />));
    fireEvent.click(screen.getByText("cmd-save"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("treeitem", { name: "Hợp đồng" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.save_source.submit") }));
    expect(await within(dialog).findByText("Hết giờ")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.save_source.submit") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.home.save_source.saved")));

    const keys = posts().map(([, opts]) => (opts as { headers?: Record<string, string> }).headers?.["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    // The retry after a timeout is the same save, not a second copy.
    expect(keys[1]).toBe(keys[0]);
    expect(posts()[0]?.[0]).toBe(`/api/v1/workspaces/${WS}/documents/sources/chat%3Am1/save`);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("uses a new key when the target changes", async () => {
    requestMock.mockRejectedValue(new ApiError("Lỗi", "internal", 500));
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-save"));
    const dialog = await screen.findByRole("dialog");
    const submit = () => fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.save_source.submit") }));

    submit();
    await within(dialog).findByText("Lỗi");
    fireEvent.click(within(dialog).getByRole("treeitem", { name: "Hợp đồng" }));
    submit();
    await waitFor(() => expect(posts()).toHaveLength(2));
    const keys = posts().map(([, opts]) => (opts as { headers?: Record<string, string> }).headers?.["Idempotency-Key"]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("closes from Cancel and shows nothing stale when reopened", async () => {
    requestMock.mockRejectedValue(new ApiError("Lỗi", "internal", 500));
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-save"));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.save_source.submit") }));
    await within(dialog).findByText("Lỗi");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.upload.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByText("cmd-save"));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Lỗi")).toBeNull();
  });
});

describe("archive", () => {
  it("opens the archive confirmation for the row and closes it on cancel", async () => {
    requestMock.mockResolvedValue({ documents: [] });
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-archive"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: t("documents.archive.archive_confirm") })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.upload.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });
});

describe("FD-08 W-B create folder, row menu, and rename", () => {
  it("create duplicate → error at the field, dialog keeps the content", async () => {
    requestMock.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") {
        return Promise.reject(new ApiError("taken", "folder_name_taken", 409));
      }
      return Promise.resolve({});
    });
    render(wrap(<Harness folderId="fa" />));
    fireEvent.click(screen.getByText("cmd-create-folder"));

    const dialog = await screen.findByRole("dialog", { name: t("documents.home.folders.create_title") });
    const input = within(dialog).getByLabelText(t("documents.home.folders.rename_label"));
    fireEvent.change(input, { target: { value: "Quý 4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.errors.folder_name_taken"));
    expect(screen.getByRole("dialog", { name: t("documents.home.folders.create_title") })).toBeInTheDocument();
    expect(input).toHaveValue("Quý 4");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("enforces 255 max on folders and 500 max on documents with document rename copy (vi + en) and FD-D10 error handling", async () => {
    requestMock.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({ document: document({ title: "b".repeat(DOCUMENT_TITLE_MAX), revision: "8" }) });
      }
      return Promise.resolve({ document: document() });
    });

    // Folder rename unchanged: folder copy, 255 max, maps folder_name_taken.
    const folderRender = render(wrap(<Harness item={folderDoc} />));
    fireEvent.click(screen.getByText("cmd-rename"));
    const folderDialog = await screen.findByRole("dialog", { name: t("documents.home.folders.rename") });
    const folderInput = within(folderDialog).getByLabelText(t("documents.home.folders.rename_label"));
    expect(folderInput).toHaveAttribute("placeholder", t("documents.home.folders.name_placeholder"));
    fireEvent.change(folderInput, { target: { value: "a".repeat(FOLDER_TITLE_MAX + 1) } });
    fireEvent.click(within(folderDialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    expect(await within(folderDialog).findByRole("alert")).toHaveTextContent(
      t("documents.home.folders.name_too_long", { max: FOLDER_TITLE_MAX }),
    );
    expect(patches()).toHaveLength(0);
    folderRender.unmount();

    // FD-D3 + F1/V-F2: document rename (page) shows document copy in vi, rejects 501 chars without sending, sends 500 chars.
    const docRender = render(wrap(<Harness item={doc} />));
    fireEvent.click(screen.getByText("cmd-rename"));
    const renameDialog = await screen.findByRole("dialog", { name: "Đổi tên" });
    expect(renameDialog).toHaveAccessibleName(t("documents.home.rename.title"));
    const renameInput = within(renameDialog).getByLabelText("Tên tài liệu");
    expect(renameInput).toHaveAttribute("placeholder", t("documents.home.rename.name_placeholder"));

    fireEvent.change(renameInput, { target: { value: "b".repeat(DOCUMENT_TITLE_MAX + 1) } });
    fireEvent.click(within(renameDialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    expect(await within(renameDialog).findByRole("alert")).toHaveTextContent("Tên tài liệu tối đa 500 ký tự.");
    expect(patches()).toHaveLength(0);

    fireEvent.change(renameInput, { target: { value: "b".repeat(DOCUMENT_TITLE_MAX) } });
    fireEvent.click(within(renameDialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    docRender.unmount();

    // Document rename (file) in English + FD-D10 (never maps folder_name_taken) + failure fallback.
    await setLocale("en");
    let patchCalls = 0;
    requestMock.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "PATCH") {
        patchCalls += 1;
        return patchCalls === 1
          ? Promise.reject(new ApiError("", "folder_name_taken", 409))
          : Promise.reject(new Error("network"));
      }
      return Promise.resolve({ document: document({ kind: "file", title: "Spec.pdf" }) });
    });
    const fileItem = { ...doc, id: "f-doc", kind: "file", title: "Spec.pdf" } as unknown as DocumentSummaryRow;
    render(wrap(<Harness item={fileItem} />));
    fireEvent.click(screen.getByText("cmd-rename"));
    const enDialog = await screen.findByRole("dialog", { name: "Rename" });
    const enInput = within(enDialog).getByLabelText("Document name");
    expect(enInput).toHaveAttribute("placeholder", t("documents.home.rename.name_placeholder"));

    fireEvent.change(enInput, { target: { value: "   " } });
    fireEvent.click(within(enDialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    expect(await within(enDialog).findByRole("alert")).toHaveTextContent("Enter a document name.");

    fireEvent.change(enInput, { target: { value: "c".repeat(DOCUMENT_TITLE_MAX + 1) } });
    fireEvent.click(within(enDialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    expect(await within(enDialog).findByRole("alert")).toHaveTextContent("A document name is at most 500 characters.");

    fireEvent.change(enInput, { target: { value: "Spec v2.pdf" } });
    fireEvent.click(within(enDialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    const alert = await within(enDialog).findByRole("alert");
    expect(alert).not.toHaveTextContent(t("documents.errors.folder_name_taken"));
    expect(alert).toHaveTextContent("Could not rename the document. Try again.");
  });

  it('"Mới → Thư mục" inside an open folder titles the dialog with the folder name, creates with parent_id, and gives menu items 44px coarse targets', async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: tree });
      if (path === "/api/v1/documents/fa" && method === "GET") {
        return Promise.resolve({ document: folderDoc });
      }
      if (path === LIST_BASE && method === "POST") {
        return Promise.resolve({
          document: { ...folderDoc, id: "fc", title: "Biên bản 2026", parent_id: "fa", revision: "1" },
        });
      }
      if (path.startsWith(LIST_BASE) && method === "GET") {
        return Promise.resolve({ documents: [], next_cursor: null });
      }
      return Promise.resolve({});
    });

    // At the root page (FD-D9), the New menu does not offer "Thư mục".
    const rootRender = renderPageView("");
    const rootMenuBtn = await screen.findByRole("button", { name: new RegExp(t("documents.home.create.menu")) });
    fireEvent.click(rootMenuBtn);
    expect(await screen.findByRole("menuitem", { name: new RegExp(t("documents.home.create.page.menu")) })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.create.folder.menu") })).toBeNull();
    rootRender.unmount();

    // Inside an open folder (?folder=fa), "Mới → Thư mục" has 44px coarse targets and titles the dialog with parent folder name.
    renderPageView("folder=fa");
    await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    const createMenuItems = await screen.findAllByRole("menuitem");
    for (const item of createMenuItems) expect(item).toHaveClass("pointer-coarse:min-h-11");
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.home.create.folder.menu") }));

    const dialog = await screen.findByRole("dialog", {
      name: t("documents.home.folders.create_sub_title", { parent: "Hợp đồng" }),
    });
    const input = within(dialog).getByLabelText(t("documents.home.folders.rename_label"));
    fireEvent.change(input, { target: { value: "Biên bản 2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        t("documents.home.folders.toast.created", { title: "Biên bản 2026" }),
      ),
    );
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.[0]).toBe(LIST_BASE);
    expect((posts()[0]?.[1] as { body?: unknown }).body).toEqual({
      kind: "folder",
      title: "Biên bản 2026",
      parent_id: "fa",
    });
  });

  it('folder card menu shows "Thư mục con mới" + "Đổi tên", document row menu "Đổi tên" only, view-only member sees neither, with 44px coarse targets', async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) {
        return Promise.resolve({
          documents: [
            ...tree,
            { id: "fo-edit", title: "Thư mục sửa", kind: "folder", parent_id: null, position: 1, children: [] },
            { id: "fo-view", title: "Thư mục chỉ xem", kind: "folder", parent_id: null, position: 2, children: [] },
          ],
        });
      }
      if (path.startsWith(LIST_BASE)) {
        return Promise.resolve({
          documents: [
            document({ id: "fo-edit", kind: "folder", title: "Thư mục sửa", my_level: "edit" }),
            document({ id: "doc-edit", kind: "page", title: "Tài liệu sửa", my_level: "edit" }),
            document({ id: "fo-view", kind: "folder", title: "Thư mục chỉ xem", my_level: "view" }),
            document({ id: "doc-unknown", kind: "page", title: "Tài liệu chưa rõ", my_level: undefined }),
          ],
          next_cursor: null,
        });
      }
      return Promise.resolve({});
    });

    renderPageView("");
    const table = await screen.findByRole("table");
    // Since A3 a folder is a card with its own ⋯ menu, not a row of the table.
    const section = await screen.findByRole("region", { name: new RegExp(`^${t("documents.home.sections.folders")} [0-9]+$`) });

    const readMenu = async (firstItemKey: string) => {
      const firstItem = await screen.findByRole("menuitem", { name: t(firstItemKey) });
      for (const item of screen.getAllByRole("menuitem")) {
        expect(item).toHaveClass("pointer-coarse:min-h-11");
      }
      const items = {
        newSubfolder: screen.queryByRole("menuitem", { name: t("documents.home.row.new_subfolder") }) !== null,
        rename: screen.queryByRole("menuitem", { name: t("documents.home.row.rename") }) !== null,
      };
      fireEvent.keyDown(firstItem, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menuitem", { name: t(firstItemKey) })).toBeNull());
      return items;
    };
    const checkRowMenu = async (title: string, firstItemKey: string) => {
      const row = (await within(table).findByText(title)).closest("tr")!;
      fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
      return readMenu(firstItemKey);
    };
    const checkCardMenu = async (title: string, firstItemKey: string) => {
      fireEvent.click(within(section).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
      return readMenu(firstItemKey);
    };

    expect(await checkCardMenu("Thư mục sửa", "documents.home.row.open_folder")).toEqual({
      newSubfolder: true,
      rename: true,
    });
    expect(await checkRowMenu("Tài liệu sửa", "documents.home.row.open_web")).toEqual({
      newSubfolder: false,
      rename: true,
    });
    expect(await checkCardMenu("Thư mục chỉ xem", "documents.home.row.open_folder")).toEqual({
      newSubfolder: false,
      rename: false,
    });
    expect(await checkRowMenu("Tài liệu chưa rõ", "documents.home.row.open_web")).toEqual({
      newSubfolder: false,
      rename: false,
    });
  });

  it("rename from the row → toast; empty name → field error", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: tree });
      if (path === "/api/v1/documents/d1" && method === "GET") {
        return Promise.resolve({ document: document({ id: "d1", title: "Kế hoạch", revision: "7" }) });
      }
      if (path === "/api/v1/documents/d1" && method === "PATCH") {
        return Promise.resolve({ document: document({ id: "d1", title: "Kế hoạch 2027", revision: "8" }) });
      }
      if (path.startsWith(LIST_BASE) && method === "GET") {
        return Promise.resolve({
          documents: [document({ id: "d1", kind: "page", title: "Kế hoạch", revision: "7", my_level: "edit" })],
          next_cursor: null,
        });
      }
      return Promise.resolve({});
    });

    renderPageView("");
    const table = await screen.findByRole("table");
    const row = (await within(table).findByText("Kế hoạch")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.rename") }));

    const dialog = await screen.findByRole("dialog", { name: t("documents.home.rename.title") });
    const input = within(dialog).getByLabelText(t("documents.home.rename.label"));
    expect(input).toHaveValue("Kế hoạch");

    // Empty name -> field error, no PATCH sent.
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.home.rename.name_empty"));
    expect(patches()).toHaveLength(0);

    // Valid name -> PATCH sent, toast shown, dialog closed.
    fireEvent.change(input, { target: { value: "Kế hoạch 2027" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        t("documents.home.folders.toast.renamed", { title: "Kế hoạch 2027" }),
      ),
    );
    expect(patches()).toHaveLength(1);
    expect(patches()[0]?.[0]).toBe("/api/v1/documents/d1");
    expect((patches()[0]?.[1] as { body?: unknown }).body).toEqual({
      revision: "7",
      title: "Kế hoạch 2027",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});


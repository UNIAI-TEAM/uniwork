import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { DOCUMENT_TITLE_MAX, FOLDER_TITLE_MAX, TREE_MAX_LEVEL } from "@uniwork/core/documents/folder-limits";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
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

beforeEach(() => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("move", () => {
  it("offers the folders but not the moved item, and moves on a fresh revision", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") return Promise.resolve({ document: document({ parent_id: "fb", revision: "8" }) });
      return Promise.resolve({ document: document() });
    });
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: t("documents.home.move.title") })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Quý 4" })).toBeInTheDocument();
    // A page is not a target.
    expect(within(dialog).queryByRole("button", { name: "Kế hoạch" })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Quý 4" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.home.move.moved")));
    const [path, opts] = posts()[0]!;
    expect(path).toBe("/api/v1/documents/d1/move");
    expect((opts as { body: unknown }).body).toEqual({ parent_id: "fb", revision: "7" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the dialog open with the generic reason when the revision cannot be read", async () => {
    requestMock.mockResolvedValue({});
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText("cmd-move"));
    const dialog = await screen.findByRole("dialog");
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Hợp đồng" }));
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
    expect(within(dialog).getByRole("button", { name: "Hợp đồng" })).toHaveAttribute("aria-pressed", "true");

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Hợp đồng" }));
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

  it("256 characters → nothing sent", async () => {
    requestMock.mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({ document: document({ title: "b".repeat(256), revision: "8" }) });
      }
      return Promise.resolve({ document: document() });
    });

    const { unmount } = render(wrap(<Harness folderId="fa" />));
    fireEvent.click(screen.getByText("cmd-create-folder"));

    const createDialog = await screen.findByRole("dialog", { name: t("documents.home.folders.create_title") });
    const createInput = within(createDialog).getByLabelText(t("documents.home.folders.rename_label"));
    fireEvent.change(createInput, { target: { value: "a".repeat(FOLDER_TITLE_MAX + 1) } });
    fireEvent.click(within(createDialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    expect(await within(createDialog).findByRole("alert")).toHaveTextContent(
      t("documents.home.folders.name_too_long", { max: FOLDER_TITLE_MAX }),
    );
    expect(posts()).toHaveLength(0);
    unmount();

    // FD-D3: document rename keeps 500 cap (256 chars allowed on a document, 501 rejected without sending).
    render(wrap(<Harness item={doc} />));
    fireEvent.click(screen.getByText("cmd-rename"));
    const renameDialog = await screen.findByRole("dialog", { name: t("documents.home.folders.rename") });
    const renameInput = within(renameDialog).getByLabelText(t("documents.home.folders.rename_label"));

    fireEvent.change(renameInput, { target: { value: "b".repeat(DOCUMENT_TITLE_MAX + 1) } });
    fireEvent.click(within(renameDialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    expect(await within(renameDialog).findByRole("alert")).toHaveTextContent(
      t("documents.home.folders.name_too_long", { max: DOCUMENT_TITLE_MAX }),
    );
    expect(patches()).toHaveLength(0);

    fireEvent.change(renameInput, { target: { value: "b".repeat(FOLDER_TITLE_MAX + 1) } });
    fireEvent.click(within(renameDialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    await waitFor(() => expect(patches()).toHaveLength(1));
  });

  it('"Mới → Thư mục" inside an open folder creates with parent_id = that folder, toast shown', async () => {
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

    // Inside an open folder (?folder=fa), "Mới → Thư mục" opens the dialog and creates with parent_id = "fa".
    renderPageView("folder=fa");
    await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.create.folder.menu") }));

    const dialog = await screen.findByRole("dialog", { name: t("documents.home.folders.create_title") });
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

  it('row menu: folder row shows "Thư mục con mới" + "Đổi tên", document row "Đổi tên" only, view-only member sees neither', async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: tree });
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

    const checkRowMenu = async (title: string, firstItemKey: string) => {
      const row = (await within(table).findByText(title)).closest("tr")!;
      fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
      const firstItem = await screen.findByRole("menuitem", { name: t(firstItemKey) });
      const items = {
        newSubfolder: screen.queryByRole("menuitem", { name: t("documents.home.row.new_subfolder") }) !== null,
        rename: screen.queryByRole("menuitem", { name: t("documents.home.row.rename") }) !== null,
      };
      fireEvent.keyDown(firstItem, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menuitem", { name: t(firstItemKey) })).toBeNull());
      return items;
    };

    expect(await checkRowMenu("Thư mục sửa", "documents.home.row.open_folder")).toEqual({
      newSubfolder: true,
      rename: true,
    });
    expect(await checkRowMenu("Tài liệu sửa", "documents.home.row.open_web")).toEqual({
      newSubfolder: false,
      rename: true,
    });
    expect(await checkRowMenu("Thư mục chỉ xem", "documents.home.row.open_folder")).toEqual({
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

    const dialog = await screen.findByRole("dialog", { name: t("documents.home.folders.rename") });
    const input = within(dialog).getByLabelText(t("documents.home.folders.rename_label"));
    expect(input).toHaveValue("Kế hoạch");

    // Empty name -> field error, no PATCH sent.
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.home.folders.name_empty"));
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


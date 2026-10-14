import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { FOLDER_TITLE_MAX } from "@uniwork/core/documents/folder-limits";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { useCreateOfType } from "./documents-create";
import { DocumentsSidebar, DocumentsSidebarSheet } from "./documents-sidebar";
import { FolderNameDialog } from "./folder-name-dialog";
import { DocumentTree } from "./document-tree";
import { DocumentTreeRowMenu, toSummaryRow } from "./document-tree-row-menu";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;

const folderNode: DocumentTreeNode = {
  id: "f1",
  title: "Hợp đồng",
  kind: "folder",
  parent_id: null,
  position: 0,
  children: [],
};

const forest: DocumentTreeNode[] = [
  folderNode,
  { id: "f2", title: "Tài chính", kind: "folder", parent_id: null, position: 1, children: [] },
];

function detailRow(over: Record<string, unknown> = {}) {
  return {
    id: "f1",
    workspace_id: WS,
    kind: "folder",
    title: "Hợp đồng",
    revision: "4",
    my_level: "manage",
    ...over,
  };
}

beforeEach(() => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("DocumentTreeRowMenu permissions", () => {
  it("shows all 5 items with manage permission, 4 edit items with edit permission, and only 'Mở' with view permission", async () => {
    const { unmount } = render(
      wrap(<DocumentTreeRowMenu wsId={WS} node={folderNode} myLevel="manage" />),
    );
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeInTheDocument();
    unmount();

    const editRender = render(
      wrap(<DocumentTreeRowMenu wsId={WS} node={folderNode} myLevel="edit" />),
    );
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeNull();
    editRender.unmount();

    render(wrap(<DocumentTreeRowMenu wsId={WS} node={folderNode} myLevel="view" />));
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeNull();
  });

  it("falls back to least privilege ('Mở' only) while detail is pending or forbidden, then shows 4 items for edit and 5 for manage", async () => {
    // 1. Detail pending -> only "Mở"
    requestMock.mockImplementation(() => new Promise(() => {}));
    const pendingRender = render(wrap(<DocumentTreeRowMenu wsId={WS} node={folderNode} />));
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeNull();
    pendingRender.unmount();

    // 2. Detail forbidden (403) -> only "Mở"
    requestMock.mockImplementation(() => Promise.reject(new ApiError("forbidden", "forbidden", 403)));
    const forbiddenRender = render(wrap(<DocumentTreeRowMenu wsId={WS} node={folderNode} />));
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeInTheDocument();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/documents/f1", expect.anything()));
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeNull();
    forbiddenRender.unmount();

    // 3. Detail resolves with edit -> 4 items
    requestMock.mockImplementation(() => Promise.resolve({ document: detailRow({ my_level: "edit" }) }));
    const editRender = render(wrap(<DocumentTreeRowMenu wsId={WS} node={folderNode} />));
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeNull();
    editRender.unmount();

    // 4. Detail resolves with manage -> 5 items
    requestMock.mockImplementation(() => Promise.resolve({ document: detailRow({ my_level: "manage" }) }));
    const manageRender = render(wrap(<DocumentTreeRowMenu wsId={WS} node={folderNode} />));
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeInTheDocument();
    manageRender.unmount();
  });

  it("uses cached my_level=edit from list cache when detail query errors, and falls back to 'Mở' only when nothing is known (N1)", async () => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { documentKeys } = await import("@uniwork/core/documents/keys");

    requestMock.mockImplementation(() => Promise.reject(new ApiError("boom", "internal", 500)));

    // 1. List cache knows my_level="edit" while detail errors -> 4 edit items shown
    const cachedClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    cachedClient.setQueryData(documentKeys.list(WS), {
      pages: [
        {
          documents: [
            {
              ...detailRow({ my_level: "edit" }),
              updated_at: "2026-10-14T00:00:00Z",
            },
          ],
          next_cursor: null,
        },
      ],
      pageParams: [undefined],
    });

    const cachedRender = render(
      <QueryClientProvider client={cachedClient}>
        <DocumentTreeRowMenu wsId={WS} node={folderNode} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/documents/f1", expect.anything()));
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeNull();
    cachedRender.unmount();

    // 2. Nothing known in cache + detail errors -> only "Mở"
    requestMock.mockClear();
    const emptyClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={emptyClient}>
        <DocumentTreeRowMenu wsId={WS} node={folderNode} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/documents/f1", expect.anything()));
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeNull();
  });

  it("does not retry 4xx detail errors when opening the row menu for the current folder (N2)", async () => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

    let detailCalls = 0;
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: forest });
      if (path === "/api/v1/documents/f1") {
        detailCalls += 1;
        return Promise.reject(new ApiError("not found", "not_found", 404));
      }
      return Promise.resolve({});
    });

    const queryClientWithRetries = new QueryClient({
      defaultOptions: {
        queries: { retry: 3, retryDelay: 0 },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClientWithRetries}>
        <DocumentTree wsId={WS} folders currentId="f1" />
      </QueryClientProvider>,
    );

    const row = await screen.findByRole("treeitem", { name: /Hợp đồng/ });
    await waitFor(() => expect(detailCalls).toBe(1));

    // Opening the row menu for the current folder triggers its detail observer; it must skip 4xx retries too.
    detailCalls = 0;
    fireEvent.contextMenu(row);
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeInTheDocument();
    await waitFor(() => expect(detailCalls).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(detailCalls).toBe(1);
  });
});

describe("DocumentTree row menu triggers and keyboard", () => {
  it("shows the (...) button on focus and opens the same menu on Shift+F10, ContextMenu key, and right-click", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: forest });
      if (path === "/api/v1/documents/f1") return Promise.resolve({ document: detailRow() });
      return Promise.resolve({});
    });
    render(wrap(<DocumentTree wsId={WS} folders />));

    const row = await screen.findByRole("treeitem", { name: /Hợp đồng/ });
    expect(row.getAttribute("aria-keyshortcuts")).toContain("Shift+F10");
    expect(row.getAttribute("aria-keyshortcuts")).toContain("ContextMenu");

    const trigger = within(row).getByRole("button", {
      name: t("documents.home.row.menu", { title: "Hợp đồng" }),
    });
    expect(trigger).toHaveClass("opacity-0");
    expect(trigger).toHaveClass("pointer-coarse:opacity-100");
    expect(trigger).toHaveClass("pointer-coarse:min-h-11");

    // Focusing the row reveals the (...) button.
    fireEvent.focus(row);
    expect(trigger).toHaveClass("opacity-100");

    // Shift+F10 opens the menu.
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeInTheDocument();

    // Close and open via right-click (onContextMenu).
    fireEvent.keyDown(document.activeElement ?? row, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeNull(),
    );

    fireEvent.contextMenu(row);
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeInTheDocument();
  });
});

describe("DocumentTree row menu dialogs and toasts", () => {
  it("renames a folder with a toast, and shows folder_name_taken at the field when taken", async () => {
    let attempts = 0;
    const patches: unknown[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: forest });
      if (path === "/api/v1/documents/f1" && !opts?.method) {
        return Promise.resolve({ document: detailRow() });
      }
      if (path === "/api/v1/documents/f1" && opts?.method === "PATCH") {
        attempts += 1;
        patches.push(opts.body);
        if (attempts === 1) {
          return Promise.reject(new ApiError("taken", "folder_name_taken", 409));
        }
        return Promise.resolve({
          document: detailRow({ title: "Hợp đồng 2026", revision: "5" }),
        });
      }
      return Promise.resolve({});
    });

    render(wrap(<DocumentTree wsId={WS} folders />));
    const row = await screen.findByRole("treeitem", { name: /Hợp đồng/ });
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.rename") }));

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText(t("documents.home.folders.rename_label"));
    expect(input).toHaveValue("Hợp đồng");

    // Validation: empty and > 255 characters do not send a request.
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.home.folders.name_empty"));
    expect(patches).toHaveLength(0);

    fireEvent.change(input, { target: { value: "a".repeat(FOLDER_TITLE_MAX + 1) } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      t("documents.home.folders.name_too_long", { max: FOLDER_TITLE_MAX }),
    );
    expect(patches).toHaveLength(0);

    // Server 409 folder_name_taken shows at the field and keeps the dialog open.
    fireEvent.change(input, { target: { value: "Tài chính" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.errors.folder_name_taken"));
    expect(toast.success).not.toHaveBeenCalled();

    // Valid rename succeeds, closes the dialog, and shows the rename toast.
    fireEvent.change(input, { target: { value: "Hợp đồng 2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        t("documents.home.folders.toast.renamed", { title: "Hợp đồng 2026" }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("creates a subfolder from the row menu and shows the created toast", async () => {
    const creates: unknown[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: forest });
      if (path === "/api/v1/documents/f1" && !opts?.method) {
        return Promise.resolve({ document: detailRow() });
      }
      if (path === `/api/v1/workspaces/${WS}/documents` && opts?.method === "POST") {
        creates.push(opts.body);
        return Promise.resolve({
          document: detailRow({ id: "sub1", title: "Phụ lục", parent_id: "f1" }),
        });
      }
      return Promise.resolve({});
    });

    render(wrap(<DocumentTree wsId={WS} folders />));
    const row = await screen.findByRole("treeitem", { name: /Hợp đồng/ });
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: t("documents.home.folders.create_sub_title", { parent: "Hợp đồng" }),
      }),
    ).toBeInTheDocument();

    const input = within(dialog).getByLabelText(t("documents.home.folders.rename_label"));
    fireEvent.change(input, { target: { value: "Phụ lục" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        t("documents.home.folders.toast.created", { title: "Phụ lục" }),
      ),
    );
    expect(creates[0]).toEqual({ kind: "folder", title: "Phụ lục", parent_id: "f1" });
  });

  it("opens the existing move picker and archive confirmation dialogs and sends the real revision on move and archive", async () => {
    const moves: unknown[] = [];
    const archives: string[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: forest });
      if (path === "/api/v1/documents/f1" && !opts?.method) {
        return Promise.resolve({ document: detailRow({ revision: "4" }) });
      }
      if (path === "/api/v1/documents/f1/move" && opts?.method === "POST") {
        moves.push(opts.body);
        return Promise.resolve({
          document: detailRow({ parent_id: "f2", revision: "5" }),
        });
      }
      if (path === "/api/v1/documents/f1/archive" && opts?.method === "POST") {
        archives.push(path);
        return Promise.resolve({
          document: detailRow({ revision: "5", archived_at: "2026-10-14T00:00:00Z" }),
          affected: ["f1"],
        });
      }
      return Promise.resolve({ documents: [] });
    });

    render(wrap(<DocumentTree wsId={WS} folders />));
    const row = await screen.findByRole("treeitem", { name: /Hợp đồng/ });

    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.move_to") }));
    const moveDialog = await screen.findByRole("dialog");
    expect(within(moveDialog).getByRole("heading", { name: t("documents.home.move.picker_title") })).toBeInTheDocument();
    fireEvent.click(within(moveDialog).getByRole("treeitem", { name: "Tài chính" }));
    fireEvent.click(within(moveDialog).getByRole("button", { name: t("documents.home.move.submit") }));
    await waitFor(() => expect(moves).toEqual([{ parent_id: "f2", revision: "4" }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const prev = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) =>
      path === "/api/v1/documents/f1/archive-impact"
        ? Promise.resolve({ folders: 0, documents: 0, total: 1, max_nodes: 1000, too_large: false })
        : prev(path, opts),
    );
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.delete") }));
    const archiveDialog = await screen.findByRole("alertdialog");
    expect(
      within(archiveDialog).getByRole("heading", { name: t("documents.archive.delete_title") }),
    ).toBeInTheDocument();
    const confirmBtn = within(archiveDialog).getByRole("button", { name: t("documents.archive.delete_confirm") });
    await waitFor(() => expect(confirmBtn).toBeEnabled());
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(archives).toEqual(["/api/v1/documents/f1/archive"]));
    expect(toSummaryRow(WS, folderNode, detailRow({ revision: "4" })).revision).toBe("4");
  });

  it("aborts rename with rename_failed field error when no revision can be loaded instead of sending revision '1'", async () => {
    const patches: unknown[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/api/v1/documents/f1" && !opts?.method) {
        return Promise.reject(new ApiError("boom", "internal", 500));
      }
      if (path === "/api/v1/documents/f1" && opts?.method === "PATCH") {
        patches.push(opts.body);
        return Promise.resolve({ document: detailRow({ title: "Hợp đồng 2026" }) });
      }
      return Promise.resolve({});
    });

    const onOpenChange = vi.fn();
    render(
      wrap(
        <FolderNameDialog
          open
          onOpenChange={onOpenChange}
          mode="rename"
          wsId={WS}
          folderId="f1"
          initialName="Hợp đồng"
        />,
      ),
    );

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText(t("documents.home.folders.rename_label"));
    fireEvent.change(input, { target: { value: "Hợp đồng 2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.rename_submit") }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.home.folders.rename_failed"));
    expect(patches).toHaveLength(0);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("shows folder_name_taken and network errors at the field in the sidebar root (+) dialog and keeps it open", async () => {
    let attempts = 0;
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path === `/api/v1/workspaces/${WS}/documents` && opts?.method === "POST") {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(new ApiError("taken", "folder_name_taken", 409));
        }
        return Promise.reject(new Error(""));
      }
      return Promise.resolve({});
    });

    function SidebarWithCreator() {
      const creator = useCreateOfType(WS, vi.fn());
      return (
        <DocumentsSidebar
          wsId={WS}
          view={{ kind: "home" }}
          folderId={null}
          starredCount={null}
          sourcesAvailable={false}
          canCreate
          newFolderPending={creator.folderPending}
          onView={vi.fn()}
          onFolder={vi.fn()}
          onNewFolder={async (title) => Boolean(await creator.newFolder(null, title))}
        />
      );
    }

    render(wrap(<SidebarWithCreator />));
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.folders.new") }));

    const dialog = await screen.findByRole("dialog", { name: t("documents.home.folders.create_title_root") });
    const input = within(dialog).getByLabelText(t("documents.home.folders.rename_label"));
    fireEvent.change(input, { target: { value: "Hợp đồng" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.errors.folder_name_taken"));
    expect(screen.getByRole("dialog", { name: t("documents.home.folders.create_title_root") })).toBeInTheDocument();

    // Network/server failure also reaches the field error and keeps the dialog open.
    fireEvent.change(input, { target: { value: "Thư mục khác" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.home.folders.create_failed"));
    expect(screen.getByRole("dialog", { name: t("documents.home.folders.create_title_root") })).toBeInTheDocument();
  });

  it("generates unique input and error ids via useId() across FolderNameDialog instances", async () => {
    render(
      wrap(
        <>
          <FolderNameDialog
            open
            onOpenChange={vi.fn()}
            mode="create"
            title="Dialog A"
            error="Error A"
          />
          <FolderNameDialog
            open
            onOpenChange={vi.fn()}
            mode="rename"
            title="Dialog B"
            error="Error B"
          />
        </>,
      ),
    );

    const dialogs = await screen.findAllByRole("dialog", { hidden: true });
    expect(dialogs).toHaveLength(2);
    const inputA = within(dialogs[0]!).getByLabelText(t("documents.home.folders.rename_label"));
    const inputB = within(dialogs[1]!).getByLabelText(t("documents.home.folders.rename_label"));
    const alertA = within(dialogs[0]!).getByRole("alert", { hidden: true });
    const alertB = within(dialogs[1]!).getByRole("alert", { hidden: true });

    expect(inputA.id).toBeTruthy();
    expect(inputB.id).toBeTruthy();
    expect(inputA.id).not.toBe("folder-name-input");
    expect(inputA.id).not.toBe(inputB.id);
    expect(alertA.id).toBeTruthy();
    expect(alertB.id).toBeTruthy();
    expect(alertA.id).not.toBe("folder-name-error");
    expect(alertA.id).not.toBe(alertB.id);
    expect(inputA.getAttribute("aria-describedby")).toBe(alertA.id);
    expect(inputB.getAttribute("aria-describedby")).toBe(alertB.id);
    const footerA = dialogs[0]!.querySelector('[data-slot="dialog-footer"]');
    expect(footerA).toHaveClass("p-4");
    expect(footerA).not.toHaveClass("px-0");
    expect(footerA).not.toHaveClass("pb-0");
  });

  it("keeps the sidebar tree shrink-0 inside a scrolling nav on desktop and phone sheet, and gives row menu items 44px coarse targets", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: forest });
      return Promise.resolve({});
    });

    const sidebarProps = {
      wsId: WS,
      view: { kind: "home" as const },
      folderId: null,
      starredCount: null,
      sourcesAvailable: true,
      canCreate: true,
      onView: vi.fn(),
      onFolder: vi.fn(),
      onNewFolder: vi.fn(),
    };

    const { unmount } = render(
      wrap(
        <>
          <DocumentsSidebar {...sidebarProps} />
          <DocumentTreeRowMenu wsId={WS} node={folderNode} myLevel="manage" open />
        </>,
      ),
    );

    const desktopTree = await screen.findByRole("tree");
    const desktopTreeWrapper = desktopTree.closest("nav")?.querySelector('[role="tree"]')?.parentElement;
    expect(desktopTree.closest("nav")).toHaveClass("min-h-0", "overflow-y-auto");
    expect(desktopTreeWrapper).toHaveClass("shrink-0");
    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(5);
    for (const item of items) expect(item).toHaveClass("pointer-coarse:min-h-11");
    unmount();

    render(wrap(<DocumentsSidebarSheet {...sidebarProps} open onOpenChange={vi.fn()} />));
    const sheetTree = await screen.findByRole("tree");
    expect(sheetTree.closest("nav")).toHaveClass("flex-1", "min-h-0", "overflow-y-auto");
    expect(sheetTree.parentElement).toHaveClass("shrink-0");
  });
});

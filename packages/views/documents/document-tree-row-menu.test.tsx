import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { FOLDER_TITLE_MAX } from "@uniwork/core/documents/folder-limits";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentTree } from "./document-tree";
import { DocumentTreeRowMenu } from "./document-tree-row-menu";

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

  it("opens the existing move picker and archive confirmation dialogs", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: forest });
      if (path === "/api/v1/documents/f1") return Promise.resolve({ document: detailRow() });
      return Promise.resolve({ documents: [] });
    });

    render(wrap(<DocumentTree wsId={WS} folders />));
    const row = await screen.findByRole("treeitem", { name: /Hợp đồng/ });

    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.move_to") }));
    const moveDialog = await screen.findByRole("dialog");
    expect(within(moveDialog).getByRole("heading", { name: t("documents.home.move.title") })).toBeInTheDocument();
    fireEvent.click(within(moveDialog).getByRole("button", { name: t("documents.upload.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.delete") }));
    const archiveDialog = await screen.findByRole("alertdialog");
    expect(
      within(archiveDialog).getByRole("heading", { name: t("documents.archive.archive_folder_title") }),
    ).toBeInTheDocument();
  });
});

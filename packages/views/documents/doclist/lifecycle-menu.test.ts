import { describe, expect, it, vi } from "vitest";
import { documentRow, type DocumentSummaryRow } from "../library-rows";
import { docRowMenu, type RowMenuContext, type RowMenuItem } from "./row-menu";

// The Thùng rác and Lưu trữ menus come from the same builder as the live rows
// (UNI-2045 W2/W3). Contract: trash `Khôi phục` · `Xem chi tiết` │ `Xóa vĩnh
// viễn`; shelved `Mở` · `Bỏ lưu trữ` · `Tải xuống` │ `Chuyển vào thùng rác`.
// The removing item is last and red; an item the viewer may not use is hidden.

function doc(over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id: "d1",
    organization_id: "org1",
    workspace_id: "ws1",
    kind: "file",
    title: "Báo cáo.docx",
    format: "docx",
    visibility: "workspace",
    revision: "1",
    current_version: 1,
    position: 0,
    my_level: "manage",
    created_by: "",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  } as DocumentSummaryRow;
}

const trashed = (over: Partial<DocumentSummaryRow> = {}) =>
  doc({ archived_at: "2026-10-10T03:00:00Z", archived_by: "u2", purge_after: "2026-11-09T03:00:00Z", ...over });
const shelved = (over: Partial<DocumentSummaryRow> = {}) =>
  doc({ shelved_at: "2026-10-10T03:00:00Z", shelved_by: "u2", ...over } as Partial<DocumentSummaryRow>);

function ctx(screen: "trash" | "shelved", over: Partial<RowMenuContext> = {}): RowMenuContext {
  return {
    handlers: {
      onToggleStar: vi.fn(),
      onShare: vi.fn(),
      onRename: vi.fn(),
      onMove: vi.fn(),
      onShelve: vi.fn(),
      onArchive: vi.fn(),
      onCopyLink: vi.fn(),
      onDuplicate: vi.fn(),
      onDownload: vi.fn(),
      onRestore: vi.fn(),
      onViewDetails: vi.fn(),
      onPurge: vi.fn(),
      onUnshelve: vi.fn(),
    },
    starred: false,
    open: vi.fn(),
    openApp: vi.fn(),
    screen,
    ...over,
  };
}

const ids = (groups: RowMenuItem[][]) => groups.map((group) => group.map((item) => item.id));

describe("docRowMenu on Thùng rác", () => {
  it("gives a manager Khôi phục · Xem chi tiết | Xóa vĩnh viễn, the purge last and red", () => {
    const groups = docRowMenu(documentRow(trashed()), ctx("trash"));
    expect(ids(groups)).toEqual([["restore", "view-details"], ["purge"]]);
    expect(groups.flat().map((item) => item.labelKey)).toEqual([
      "documents.trash.restore",
      "documents.trash.view_details",
      "documents.trash.purge",
    ]);
    expect(groups.flat().filter((item) => item.destructive).map((item) => item.id)).toEqual(["purge"]);
  });

  it("keeps the menu for a workspace admin on a restricted row (admin_scope, no my_level)", () => {
    const row = trashed({ my_level: undefined, admin_scope: true } as Partial<DocumentSummaryRow>);
    expect(ids(docRowMenu(documentRow(row), ctx("trash")))).toEqual([["restore", "view-details"], ["purge"]]);
  });

  it("hides every item from a viewer who only edits the row", () => {
    expect(docRowMenu(documentRow(trashed({ my_level: "edit" })), ctx("trash"))).toEqual([]);
    expect(docRowMenu(documentRow(trashed({ my_level: "view" })), ctx("trash"))).toEqual([]);
  });

  it("offers no Xem chi tiết on a trashed folder: a folder is never opened", () => {
    expect(ids(docRowMenu(documentRow(trashed({ kind: "folder" })), ctx("trash")))).toEqual([["restore"], ["purge"]]);
  });

  it("never shows a live command on a trashed row", () => {
    const flat = ids(docRowMenu(documentRow(trashed()), ctx("trash"))).flat();
    for (const id of ["open", "share", "copy-link", "star", "rename", "move", "duplicate", "download", "shelve", "trash"]) {
      expect(flat).not.toContain(id);
    }
  });

  it("runs the wired handlers with the row", () => {
    const c = ctx("trash");
    const row = trashed();
    const flat = docRowMenu(documentRow(row), c).flat();
    for (const item of flat) item.run();
    expect(c.handlers.onRestore).toHaveBeenCalledWith(row);
    expect(c.handlers.onViewDetails).toHaveBeenCalledWith(row);
    expect(c.handlers.onPurge).toHaveBeenCalledWith(row);
  });

  it("hides an item whose handler the host did not wire", () => {
    const c = ctx("trash");
    c.handlers.onViewDetails = undefined;
    c.handlers.onPurge = undefined;
    expect(ids(docRowMenu(documentRow(trashed()), c))).toEqual([["restore"]]);
  });
});

describe("docRowMenu on Lưu trữ", () => {
  it("gives a manager Mở · Bỏ lưu trữ · Tải xuống | Chuyển vào thùng rác, the trash last and red", () => {
    const groups = docRowMenu(documentRow(shelved()), ctx("shelved"));
    expect(ids(groups)).toEqual([["open", "unshelve", "download"], ["trash"]]);
    expect(groups.flat().map((item) => item.labelKey)).toEqual([
      "documents.tree.menu.open",
      "documents.shelved_list.unshelve",
      "documents.home.row.download",
      "documents.home.row.archive",
    ]);
    expect(groups.flat().filter((item) => item.destructive).map((item) => item.id)).toEqual(["trash"]);
  });

  it("gives a viewer only Mở and Tải xuống", () => {
    expect(ids(docRowMenu(documentRow(shelved({ my_level: "view" })), ctx("shelved")))).toEqual([["open", "download"]]);
  });

  it("gives a workspace admin the manage items (admin_scope, no my_level)", () => {
    const row = shelved({ my_level: undefined, admin_scope: true } as Partial<DocumentSummaryRow>);
    expect(ids(docRowMenu(documentRow(row), ctx("shelved")))).toEqual([["open", "unshelve", "download"], ["trash"]]);
  });

  it("offers no download on a page or a folder, and the folder's trash item says Xóa", () => {
    expect(ids(docRowMenu(documentRow(shelved({ kind: "page" })), ctx("shelved")))).toEqual([["open", "unshelve"], ["trash"]]);
    const folder = docRowMenu(documentRow(shelved({ kind: "folder" })), ctx("shelved"));
    expect(ids(folder)).toEqual([["open", "unshelve"], ["trash"]]);
    expect(folder[1]?.[0]?.labelKey).toBe("documents.tree.menu.delete");
  });

  it("never offers rename, move, share, star, copy or Lưu trữ on a shelved row", () => {
    const flat = ids(docRowMenu(documentRow(shelved()), ctx("shelved"))).flat();
    for (const id of ["open-app", "share", "copy-link", "star", "rename", "move", "duplicate", "shelve"]) {
      expect(flat).not.toContain(id);
    }
  });

  it("opens through the row's primary click and runs unshelve and trash with the row", () => {
    const c = ctx("shelved");
    const row = shelved();
    for (const item of docRowMenu(documentRow(row), c).flat()) item.run();
    expect(c.open).toHaveBeenCalledTimes(1);
    expect(c.handlers.onUnshelve).toHaveBeenCalledWith(row);
    expect(c.handlers.onDownload).toHaveBeenCalledWith(row);
    expect(c.handlers.onArchive).toHaveBeenCalledWith(row);
  });
});

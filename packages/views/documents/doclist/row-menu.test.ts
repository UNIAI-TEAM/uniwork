import { describe, expect, it, vi } from "vitest";
import { documentRow, sourceRow, type DocumentSummaryRow } from "../library-rows";
import { docRowMenu, type RowMenuContext, type RowMenuItem } from "./row-menu";

// One ordered row menu for every live document list (UNI-2045 W8). Contract:
// Mở · Mở bằng UniWork Office │ Chia sẻ · Sao chép link │ Gắn sao · Đổi tên ·
// Di chuyển · Tạo bản sao · Tải xuống │ Lưu trữ · Chuyển vào thùng rác. An item
// the viewer may not use is hidden, never disabled; an empty group leaves no
// separator behind.

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
    size_bytes: 2500,
    ...over,
  } as DocumentSummaryRow;
}

function ctx(over: Partial<RowMenuContext> = {}): RowMenuContext {
  return {
    handlers: {
      onToggleStar: vi.fn(),
      onShare: vi.fn(),
      onRename: vi.fn(),
      onMove: vi.fn(),
      onShelve: vi.fn(),
      onArchive: vi.fn(),
      onNewSubfolder: vi.fn(),
      onCopyLink: vi.fn(),
      onDuplicate: vi.fn(),
      onDownload: vi.fn(),
      onGoToSource: vi.fn(),
      onSaveSource: vi.fn(),
      onDownloadSource: vi.fn(),
    },
    starred: false,
    open: vi.fn(),
    openApp: vi.fn(),
    ...over,
  };
}

const ids = (groups: RowMenuItem[][]) => groups.map((group) => group.map((item) => item.id));

describe("docRowMenu: order and grouping", () => {
  it("lists the file menu in the contract order, five groups", () => {
    expect(ids(docRowMenu(documentRow(doc()), ctx()))).toEqual([
      ["open", "open-app"],
      ["share", "copy-link"],
      ["star", "rename", "move", "duplicate", "download"],
      ["shelve", "trash"],
    ]);
  });

  it("names every item with a documents.list.menu / existing key", () => {
    const labels = docRowMenu(documentRow(doc()), ctx()).flat().map((item) => item.labelKey);
    expect(labels).toEqual([
      "documents.tree.menu.open",
      "documents.home.row.open_app",
      "documents.actions.share",
      "documents.list.menu.copy_link",
      "documents.home.row.star",
      "documents.home.row.rename",
      "documents.home.row.move",
      "documents.actions.copy",
      "documents.home.row.download",
      "documents.shelved_list.shelve",
      "documents.home.row.archive",
    ]);
  });

  it("flips Gắn sao to Bỏ gắn sao on a starred row", () => {
    const star = docRowMenu(documentRow(doc()), ctx({ starred: true })).flat().find((item) => item.id === "star");
    expect(star?.labelKey).toBe("documents.home.row.unstar");
  });

  it("puts the destructive item last, alone with Lưu trữ, and marks only it", () => {
    const groups = docRowMenu(documentRow(doc()), ctx());
    const last = groups[groups.length - 1]!;
    expect(last.map((item) => item.id)).toEqual(["shelve", "trash"]);
    expect(groups.flat().filter((item) => item.destructive).map((item) => item.id)).toEqual(["trash"]);
  });

  it("runs the handler of each item with the row's document", () => {
    const c = ctx();
    const d = doc();
    const items = Object.fromEntries(docRowMenu(documentRow(d), c).flat().map((item) => [item.id, item]));
    for (const id of ["share", "copy-link", "rename", "move", "duplicate", "download", "shelve", "trash"]) items[id]!.run();
    items.star!.run();
    items.open!.run();
    items["open-app"]!.run();
    expect(c.handlers.onShare).toHaveBeenCalledWith(d);
    expect(c.handlers.onCopyLink).toHaveBeenCalledWith(d);
    expect(c.handlers.onRename).toHaveBeenCalledWith(d);
    expect(c.handlers.onMove).toHaveBeenCalledWith(d);
    expect(c.handlers.onDuplicate).toHaveBeenCalledWith(d);
    expect(c.handlers.onDownload).toHaveBeenCalledWith(d);
    expect(c.handlers.onShelve).toHaveBeenCalledWith(d);
    expect(c.handlers.onArchive).toHaveBeenCalledWith(d);
    expect(c.handlers.onToggleStar).toHaveBeenCalledWith("d1", false);
    expect(c.open).toHaveBeenCalled();
    expect(c.openApp).toHaveBeenCalled();
  });
});

describe("docRowMenu: hidden, never disabled", () => {
  it("drops Mở bằng UniWork Office when the host offers no app action", () => {
    const groups = docRowMenu(documentRow(doc()), ctx({ openApp: undefined }));
    expect(ids(groups)[0]).toEqual(["open"]);
  });

  it("gives an edit-level viewer no Lưu trữ and no trash", () => {
    const groups = docRowMenu(documentRow(doc({ my_level: "edit" })), ctx());
    expect(ids(groups)).toEqual([
      ["open", "open-app"],
      ["share", "copy-link"],
      ["star", "rename", "move", "duplicate", "download"],
    ]);
  });

  it("gives a view-level viewer only the read commands, and no empty group", () => {
    const groups = docRowMenu(documentRow(doc({ my_level: "view" })), ctx());
    expect(ids(groups)).toEqual([
      ["open", "open-app"],
      ["share", "copy-link"],
      ["star", "download"],
    ]);
  });

  it("treats a row with no level as view", () => {
    const groups = docRowMenu(documentRow(doc({ my_level: undefined })), ctx());
    expect(ids(groups).flat()).not.toContain("rename");
    expect(ids(groups).flat()).not.toContain("trash");
  });

  it("applies the manage rule on Shared with me: edit shows no Lưu trữ / trash, manage shows both", () => {
    const shared = { via: "share" } as Partial<DocumentSummaryRow>;
    expect(ids(docRowMenu(documentRow(doc({ ...shared, my_level: "edit" })), ctx())).flat()).not.toContain("trash");
    expect(ids(docRowMenu(documentRow(doc({ ...shared, my_level: "edit" })), ctx())).flat()).not.toContain("shelve");
    const manage = ids(docRowMenu(documentRow(doc({ ...shared, my_level: "manage" })), ctx())).flat();
    expect(manage).toContain("shelve");
    expect(manage).toContain("trash");
  });

  it("hides every item whose handler the host did not wire", () => {
    const c = ctx();
    c.handlers = { onToggleStar: c.handlers.onToggleStar, onShare: c.handlers.onShare };
    expect(ids(docRowMenu(documentRow(doc()), c)).flat()).toEqual(["open", "open-app", "share", "star"]);
  });

  it("hides Gắn sao where the host passes no star handler (outside an organization)", () => {
    const c = ctx();
    c.handlers = { ...c.handlers, onToggleStar: undefined };
    expect(ids(docRowMenu(documentRow(doc()), c)).flat()).not.toContain("star");
  });

  it("never offers Tạo bản sao or Tải xuống on a page (UniNote)", () => {
    const flat = ids(docRowMenu(documentRow(doc({ kind: "page", format: undefined, title: "Kế hoạch" })), ctx())).flat();
    expect(flat).not.toContain("duplicate");
    expect(flat).not.toContain("download");
    expect(flat).toContain("copy-link");
  });

  it("hides Chia sẻ on an owned (work-product) document, keeps the link", () => {
    const flat = ids(docRowMenu(documentRow(doc({ owner_kind: "task" } as Partial<DocumentSummaryRow>)), ctx())).flat();
    expect(flat).not.toContain("share");
    expect(flat).not.toContain("duplicate");
    expect(flat).toContain("copy-link");
  });

  it("hides Tạo bản sao when the host wires no copy command, keeps Tải xuống", () => {
    const c = ctx();
    c.handlers = { ...c.handlers, onDuplicate: undefined };
    const flat = ids(docRowMenu(documentRow(doc()), c)).flat();
    expect(flat).not.toContain("duplicate");
    expect(flat).toContain("download");
  });

  it("gives a trashed row nothing at all", () => {
    expect(docRowMenu(documentRow(doc({ archived_at: "2026-09-01T00:00:00Z" })), ctx())).toEqual([]);
  });

  it("offers no Lưu trữ on an already archived (shelved) row, but the trash is still there", () => {
    const flat = ids(docRowMenu(documentRow(doc({ shelved_at: "2026-09-01T00:00:00Z" } as Partial<DocumentSummaryRow>)), ctx())).flat();
    expect(flat).not.toContain("shelve");
    expect(flat).toContain("trash");
  });

  it("gives the My Folder root no rename, move, Lưu trữ, trash, share or link", () => {
    const root = doc({ kind: "folder", title: "My Folder", system_kind: "my_folder" } as Partial<DocumentSummaryRow>);
    expect(ids(docRowMenu(documentRow(root), ctx()))).toEqual([["open-folder"], ["star", "new-subfolder"]]);
  });
});

describe("docRowMenu: folder rows", () => {
  const folder = doc({ kind: "folder", title: "Hợp đồng", format: undefined });

  it("keeps their own items in the same group order, no file-only items", () => {
    expect(ids(docRowMenu(documentRow(folder), ctx()))).toEqual([
      ["open-folder"],
      ["copy-link"],
      ["star", "new-subfolder", "rename", "move"],
      ["shelve", "trash"],
    ]);
  });

  it("says Delete on the folder's trash item, like its dialog", () => {
    const trash = docRowMenu(documentRow(folder), ctx()).flat().find((item) => item.id === "trash");
    expect(trash?.labelKey).toBe("documents.tree.menu.delete");
    expect(trash?.destructive).toBe(true);
  });

  it("hides Tạo thư mục con and the edit commands from a view-level viewer", () => {
    expect(ids(docRowMenu(documentRow({ ...folder, my_level: "view" }), ctx())).flat()).toEqual(["open-folder", "copy-link", "star"]);
  });

  // UNI-2244: the bulk command is the folder's only sharing item; a document has the single Share instead.
  it("offers Chia sẻ on a folder of any level, and runs it with the folder", () => {
    const onShareContents = vi.fn();
    for (const level of ["view", "edit", "manage"] as const) {
      const c = ctx();
      c.handlers.onShareContents = onShareContents;
      const groups = docRowMenu(documentRow({ ...folder, my_level: level }), c);
      expect(ids(groups)[1]).toContain("share-contents");
      expect(ids(groups).flat()).not.toContain("share");
    }
    const c = ctx();
    c.handlers.onShareContents = onShareContents;
    docRowMenu(documentRow(folder), c).flat().find((item) => item.id === "share-contents")!.run();
    expect(onShareContents).toHaveBeenLastCalledWith(folder);
    expect(docRowMenu(documentRow(folder), c).flat().find((item) => item.id === "share-contents")?.labelKey).toBe("documents.folderAccess.menu");
  });

  it("never offers it on a document, nor where the host wires no dialog", () => {
    const wired = ctx();
    wired.handlers.onShareContents = vi.fn();
    expect(ids(docRowMenu(documentRow(doc()), wired)).flat()).not.toContain("share-contents");
    expect(ids(docRowMenu(documentRow(folder), ctx())).flat()).not.toContain("share-contents");
  });
});

describe("docRowMenu: source rows keep today's items", () => {
  const src = sourceRow({
    id: "chat:m1",
    source: "chat",
    parent: { kind: "chat_channel", id: "c1", title: "Kênh chung", message_id: "msg1" },
    name: "Đề xuất.pdf",
    mime_type: "application/pdf",
    extension: "pdf",
    size_bytes: 10,
    updated_at: "2026-10-09T03:00:00Z",
    owner: { id: "u2", kind: "human", name: "Dũng" },
    can_open_in_app: true,
    can_save: true,
  } as never);

  it("lists go-to-source, download and save in one group", () => {
    expect(ids(docRowMenu(src, ctx()))).toEqual([["go-to-source", "download", "save"]]);
  });
});

import { describe, expect, it } from "vitest";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import {
  byUpdatedDesc,
  DEFAULT_FOLDER_SORT,
  documentRow,
  FOLDER_SORT_STORAGE_KEY,
  folderPath,
  folderSortStorageKey,
  formatBytes,
  groupRows,
  indexTree,
  matchesAccess,
  matchesChip,
  mergeNewestFirst,
  readFolderSort,
  rowAccessLabelKey,
  rowFormat,
  rowOrigin,
  rowSizeBytes,
  rowTypeKey,
  rowVisibilityLabelKey,
  sortFolderRows,
  sourceRow,
  writeFolderSort,
  type DocumentSummaryRow,
} from "./library-rows";

function doc(over: Partial<DocumentSummaryRow>): DocumentSummaryRow {
  return {
    id: "d",
    organization_id: "",
    workspace_id: "ws",
    kind: "page",
    title: "",
    visibility: "workspace",
    revision: "1",
    current_version: 0,
    position: 0,
    created_by: "",
    created_by_kind: "human",
    updated_by: "",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function node(id: string, kind: string, children: DocumentTreeNode[] = [], parent: string | null = null): DocumentTreeNode {
  return { id, title: id.toUpperCase(), kind: kind as DocumentTreeNode["kind"], parent_id: parent, position: 0, children };
}

const src = (over: Partial<DocumentSourceFile> = {}) =>
  sourceRow({
    id: "chat:1",
    source: "chat",
    parent: { kind: "chat_channel", id: "c", title: "C" },
    name: "a.pdf",
    mime_type: "application/pdf",
    extension: "pdf",
    size_bytes: 1,
    updated_at: "2026-10-02T00:00:00Z",
    owner: null,
    can_open_in_app: false,
    ...over,
  } as DocumentSourceFile);

describe("library rows", () => {
  const tree = [node("f1", "folder", [node("p1", "page", [node("f2", "folder", [], "p1")], "f1")])];
  const index = indexTree(tree);

  it("walks up to the folders only, outermost first, skipping pages", () => {
    expect(folderPath(index, "f2").map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(folderPath(index, "p1").map((f) => f.id)).toEqual(["f1"]);
    expect(folderPath(index, null)).toEqual([]);
  });

  it("keeps folders under every chip but Pages, and files by extension", () => {
    const folder = documentRow(doc({ kind: "folder", title: "F" }));
    const sheet = documentRow(doc({ kind: "file", title: "Q4.XLSX" }));
    expect(matchesChip(folder, "docx")).toBe(true);
    expect(matchesChip(folder, "page")).toBe(false);
    expect(matchesChip(sheet, "xlsx")).toBe(true);
    expect(matchesChip(sheet, "docx")).toBe(false);
    expect(matchesChip(src(), "pdf")).toBe(true);
  });

  it("groups by folder path, putting source files under their module", () => {
    const rows = [
      documentRow(doc({ id: "a", parent_id: "f2" })),
      documentRow(doc({ id: "b" })),
      src(),
    ];
    const groups = groupRows(rows, "folder", index);
    expect(groups.map((g) => [g.key, g.title, g.rows.length])).toEqual([
      ["folder:f2", "F1 / F2", 1],
      ["unfiled", "", 1],
      ["origin:chat", "", 1],
    ]);
    expect(groupRows(rows, "source", index).map((g) => g.key)).toEqual(["origin:documents", "origin:chat"]);
    expect(groupRows(rows, "none", index)).toHaveLength(1);
  });

  it("puts root folder rows in their own first group under group-by-folder, keeps nested folders in their parent group, keeps empty root folders visible, and leaves only root documents in unfiled", () => {
    const rootDoc = documentRow(doc({ id: "root-doc", kind: "page", title: "Root page" }));
    const childDoc = documentRow(doc({ id: "child-doc", kind: "file", title: "Spec.docx", parent_id: "f1" }));
    const nonEmptyFolder = documentRow(doc({ id: "f1", kind: "folder", title: "F1" }));
    const emptyRootFolder = documentRow(doc({ id: "f-empty", kind: "folder", title: "Empty" }));
    const nestedFolder = documentRow(doc({ id: "f2", kind: "folder", title: "F2", parent_id: "p1" }));
    const rows = [rootDoc, childDoc, nonEmptyFolder, emptyRootFolder, nestedFolder];

    const groups = groupRows(rows, "folder", index);
    expect(groups.map((g) => [g.key, g.title, g.rows.map((r) => r.id)])).toEqual([
      ["folders", "", ["f1", "f-empty"]],
      ["unfiled", "", ["root-doc"]],
      ["folder:f1", "F1", ["child-doc", "f2"]],
    ]);
  });

  it("tells uploads from created documents and sizes only files", () => {
    const upload = documentRow(doc({ kind: "file", origin: "upload", size_bytes: 2048 }));
    const blank = documentRow(doc({ kind: "file", origin: "created", size_bytes: 0 }));
    const page = documentRow(doc({ origin: "created", size_bytes: 0 }));
    const older = documentRow(doc({ kind: "file" }));
    expect([upload, blank, page, older].map(rowOrigin)).toEqual(["upload", "created", "created", "documents"]);
    expect([upload, blank, page, older, src()].map(rowSizeBytes)).toEqual([2048, null, null, null, 1]);
    expect(groupRows([upload, page], "source", index).map((g) => g.key)).toEqual(["origin:upload", "origin:created"]);
  });

  it("sorts newest first and sinks rows without a date", () => {
    const rows = [
      documentRow(doc({ id: "old", updated_at: "2026-01-01T00:00:00Z" })),
      documentRow(doc({ id: "none" })),
      documentRow(doc({ id: "new", updated_at: "2026-10-01T00:00:00Z" })),
    ];
    expect([...rows].sort(byUpdatedDesc).map((r) => r.id)).toEqual(["new", "old", "none"]);
  });

  it("merges the two paged lists so the next page only adds rows below the ones shown", () => {
    const d = (id: string, at: string) => documentRow(doc({ id, updated_at: at }));
    const docs = [d("d1", "2026-10-09T00:00:00Z"), d("d2", "2026-10-05T00:00:00Z")];
    const sources = [src({ id: "chat:a", updated_at: "2026-10-08T00:00:00Z" }), src({ id: "chat:b", updated_at: "2026-10-01T00:00:00Z" })];
    const ids = (rows: ReturnType<typeof mergeNewestFirst>) => rows.map((r) => r.id);

    // Both lists have more: nothing older than the newer of the two oldest rows is shown yet.
    expect(ids(mergeNewestFirst(docs, sources, { docs: true, sources: true }))).toEqual(["d1", "source:chat:a", "d2"]);
    // Only the sources have more: documents below the sources' oldest row wait for them.
    expect(ids(mergeNewestFirst(docs, sources, { docs: false, sources: true }))).toEqual(["d1", "source:chat:a", "d2", "source:chat:b"]);
    // Exhausted lists set no bound.
    expect(ids(mergeNewestFirst(docs, sources, { docs: false, sources: false }))).toEqual(["d1", "source:chat:a", "d2", "source:chat:b"]);

    // The next documents page lands below what was shown, never above it.
    const next = [...docs, d("d3", "2026-10-03T00:00:00Z"), d("d4", "2026-09-30T00:00:00Z")];
    const shown = ids(mergeNewestFirst(docs, sources, { docs: true, sources: true }));
    const after = ids(mergeNewestFirst(next, sources, { docs: false, sources: true }));
    expect(after.slice(0, shown.length)).toEqual(shown);
    // d4 is older than the sources' oldest loaded row, so it waits for their next page.
    expect(after).toEqual(["d1", "source:chat:a", "d2", "d3", "source:chat:b"]);
  });

  it("formats sizes and says nothing for an unusable one", () => {
    expect(formatBytes(318 * 1024, "en")).toBe("318 KB");
    expect(formatBytes(1.2 * 1024 * 1024, "en")).toBe("1.2 MB");
    expect(formatBytes(-1, "en")).toBe("");
  });

  it("places folders before documents in both sorts", () => {
    const rows = [
      documentRow(doc({ id: "doc-new", kind: "page", title: "An", updated_at: "2026-10-10T00:00:00Z" })),
      documentRow(doc({ id: "fol-old", kind: "folder", title: "Zebra", updated_at: "2026-01-01T00:00:00Z" })),
      documentRow(doc({ id: "doc-old", kind: "file", title: "Báo cáo.docx", updated_at: "2026-02-01T00:00:00Z" })),
      documentRow(doc({ id: "fol-new", kind: "folder", title: "Alpha", updated_at: "2026-09-01T00:00:00Z" })),
    ];
    expect(sortFolderRows(rows, "updated").map((r) => r.id)).toEqual([
      "fol-new",
      "fol-old",
      "doc-new",
      "doc-old",
    ]);
    expect(sortFolderRows(rows, "name").map((r) => r.id)).toEqual([
      "fol-new",
      "fol-old",
      "doc-new",
      "doc-old",
    ]);
  });

  it("sorts by Name using Vietnamese collation ('Ă' after 'A')", () => {
    const rows = [
      documentRow(doc({ id: "binh", kind: "page", title: "Bình" })),
      documentRow(doc({ id: "an-circumflex", kind: "page", title: "Ân" })),
      documentRow(doc({ id: "an-breve", kind: "page", title: "Ăn" })),
      documentRow(doc({ id: "an-plain", kind: "page", title: "An" })),
      documentRow(doc({ id: "fol-breve", kind: "folder", title: "Ăn uống" })),
      documentRow(doc({ id: "fol-plain", kind: "folder", title: "An toàn" })),
    ];
    expect(sortFolderRows(rows, "name").map((r) => r.id)).toEqual([
      "fol-plain",
      "fol-breve",
      "an-plain",
      "an-breve",
      "an-circumflex",
      "binh",
    ]);
  });

  it("maps each row kind and extension to its Type column translation key", () => {
    expect(rowTypeKey(documentRow(doc({ kind: "folder", title: "Hợp đồng" })))).toBe("documents.file_types.folder");
    expect(rowTypeKey(documentRow(doc({ kind: "page", title: "Ghi chú" })))).toBe("documents.file_types.page");
    expect(rowTypeKey(documentRow(doc({ kind: "file", title: "Báo giá.docx" })))).toBe("documents.file_types.docx");
    expect(rowTypeKey(documentRow(doc({ kind: "file", title: "Số liệu.xlsx" })))).toBe("documents.file_types.xlsx");
    expect(rowTypeKey(documentRow(doc({ kind: "file", title: "archive.zip" })))).toBe("documents.file_types.file");
  });

  it("reads the server's format over the title's extension, and an unknown one as a generic file (UNI-1868)", () => {
    // kind stays the authority for pages and folders; only files read `format`.
    expect(rowFormat(documentRow(doc({ kind: "file", title: "Báo giá.docx", format: "xlsx" })))).toBe("xlsx");
    expect(rowFormat(documentRow(doc({ kind: "file", title: "Số liệu.xlsx" })))).toBe("xlsx");
    // An unknown server value is not trusted: the extension, then the generic file.
    const odd = (title: string) => documentRow(doc({ kind: "file", title, format: "odd" as DocumentSummaryRow["format"] }));
    expect(rowFormat(odd("Ghi chú.docx"))).toBe("docx");
    expect(rowFormat(odd("Ghi chú"))).toBe("file");
    expect(rowFormat(documentRow(doc({ kind: "page", title: "Trang.md", format: "md" as DocumentSummaryRow["format"] })))).toBe("page");
    expect(rowTypeKey(documentRow(doc({ kind: "file", title: "Báo giá.docx", format: "xlsx" })))).toBe("documents.file_types.xlsx");
    expect(rowTypeKey(odd("Ghi chú"))).toBe("documents.file_types.file");
    // ...and it groups under the generic file, not under a group of its own.
    expect(groupRows([odd("Ghi chú")], "type", new Map()).map((g) => g.key)).toEqual(["type:file"]);
  });

  it("persists folder sort per viewer under uniwork_documents_folder_sort:<userId> and neither reads nor writes without a user", () => {
    const map = new Map<string, string>();
    const adapter = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
    expect(folderSortStorageKey("u1")).toBe(`${FOLDER_SORT_STORAGE_KEY}:u1`);
    expect(readFolderSort("u1", adapter)).toBe(DEFAULT_FOLDER_SORT);
    writeFolderSort("u1", "name", adapter);
    expect(map.get(`${FOLDER_SORT_STORAGE_KEY}:u1`)).toBe("name");
    expect(readFolderSort("u1", adapter)).toBe("name");

    // A second viewer on the same browser does not share u1's choice.
    expect(readFolderSort("u2", adapter)).toBe(DEFAULT_FOLDER_SORT);
    writeFolderSort("u2", "updated", adapter);
    expect(map.get(`${FOLDER_SORT_STORAGE_KEY}:u2`)).toBe("updated");
    expect(readFolderSort("u1", adapter)).toBe("name");

    // Without a session user, default is returned and nothing is written.
    expect(readFolderSort(null, adapter)).toBe(DEFAULT_FOLDER_SORT);
    expect(readFolderSort(undefined, adapter)).toBe(DEFAULT_FOLDER_SORT);
    expect(readFolderSort("", adapter)).toBe(DEFAULT_FOLDER_SORT);
    const sizeBefore = map.size;
    writeFolderSort(null, "name", adapter);
    writeFolderSort(undefined, "name", adapter);
    writeFolderSort("", "name", adapter);
    expect(map.size).toBe(sizeBefore);

    const throwing = {
      getItem: (): string | null => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readFolderSort("u1", throwing)).toBe(DEFAULT_FOLDER_SORT);
    expect(readFolderSort("u1", null)).toBe(DEFAULT_FOLDER_SORT);
    expect(() => writeFolderSort("u1", "name", throwing)).not.toThrow();
    expect(() => writeFolderSort("u1", "name", null)).not.toThrow();
  });
});


describe("access columns and filter (UNI-1642)", () => {
  const lvl = (my_level: string | null | undefined, visibility = "workspace") =>
    documentRow(doc({ my_level: my_level as DocumentSummaryRow["my_level"], visibility: visibility as DocumentSummaryRow["visibility"] }));

  it("maps the viewer's level to the share dialog's words, comment included, and an unknown level to nothing", () => {
    expect(rowAccessLabelKey(lvl("view"))).toBe("documents.home.access.view");
    expect(rowAccessLabelKey(lvl("edit"))).toBe("documents.home.access.edit");
    expect(rowAccessLabelKey(lvl("comment"))).toBe("documents.home.access.comment");
    expect(rowAccessLabelKey(lvl("manage"))).toBe("documents.home.access.manage");
    expect(rowAccessLabelKey(lvl("owner"))).toBeNull();
    expect(rowAccessLabelKey(lvl(null))).toBeNull();
    expect(rowAccessLabelKey(lvl(undefined))).toBeNull();
    expect(rowAccessLabelKey(src())).toBeNull();
  });

  it("maps visibility and leaves an unknown value or a source row blank", () => {
    expect(rowVisibilityLabelKey(lvl("view", "workspace"))).toBe("documents.home.visibility.workspace");
    expect(rowVisibilityLabelKey(lvl("view", "restricted"))).toBe("documents.home.visibility.restricted");
    expect(rowVisibilityLabelKey(lvl("view", "public"))).toBeNull();
    expect(rowVisibilityLabelKey(lvl("view", ""))).toBeNull();
    expect(rowVisibilityLabelKey(src())).toBeNull();
  });

  it("filters: manage = manage, edit = edit or manage, restricted = restricted, all = everything", () => {
    const rows = [lvl("view"), lvl("edit"), lvl("manage"), lvl("comment"), lvl(undefined), lvl("manage", "restricted"), lvl("view", "restricted"), src()];
    const pick = (f: Parameters<typeof matchesAccess>[1]) => rows.map((r) => matchesAccess(r, f));
    expect(pick("all")).toEqual([true, true, true, true, true, true, true, true]);
    expect(pick("manage")).toEqual([false, false, true, false, false, true, false, false]);
    expect(pick("edit")).toEqual([false, true, true, false, false, true, false, false]);
    expect(pick("restricted")).toEqual([false, false, false, false, false, true, true, false]);
  });
});

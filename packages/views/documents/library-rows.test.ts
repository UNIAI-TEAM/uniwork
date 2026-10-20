import { describe, expect, it } from "vitest";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import {
  documentRow,
  folderPath,
  groupRows,
  indexTree,
  matchesAccess,
  matchesChip,
  rowFormat,
  rowOrigin,
  rowSizeBytes,
  rowTypeKey,
  rowVisibilityLabelKey,
  sourceRow,
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

  it("drops the lone 'Not in a folder' header: when every row is unfiled the list is one flat group (UNI-1994)", () => {
    const rows = [documentRow(doc({ id: "a" })), documentRow(doc({ id: "b", kind: "page" }))];
    const groups = groupRows(rows, "folder", index);
    expect(groups.map((g) => [g.key, g.title, g.rows.map((r) => r.id)])).toEqual([["all", "", ["a", "b"]]]);
  });

  it("keeps the 'Not in a folder' header next to another group", () => {
    const rows = [documentRow(doc({ id: "a" })), documentRow(doc({ id: "b", parent_id: "f2" }))];
    expect(groupRows(rows, "folder", index).map((g) => g.key)).toEqual(["unfiled", "folder:f2"]);
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
});

describe("access columns and filter (UNI-1642)", () => {
  const lvl = (my_level: string | null | undefined, visibility = "workspace") =>
    documentRow(doc({ my_level: my_level as DocumentSummaryRow["my_level"], visibility: visibility as DocumentSummaryRow["visibility"] }));

  it("maps visibility and leaves an unknown value or a source row blank", () => {
    expect(rowVisibilityLabelKey(lvl("view", "workspace"))).toBe("documents.scope.workspace");
    expect(rowVisibilityLabelKey(lvl("view", "restricted"))).toBe("documents.scope.private");
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

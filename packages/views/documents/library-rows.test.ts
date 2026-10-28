import { describe, expect, it } from "vitest";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import {
  documentRow,
  rowFormat,
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
  it("sizes only files", () => {
    const upload = documentRow(doc({ kind: "file", origin: "upload", size_bytes: 2048 }));
    const blank = documentRow(doc({ kind: "file", origin: "created", size_bytes: 0 }));
    const page = documentRow(doc({ origin: "created", size_bytes: 0 }));
    const older = documentRow(doc({ kind: "file" }));
    expect([upload, blank, page, older, src()].map(rowSizeBytes)).toEqual([2048, null, null, null, 1]);
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
  });

  it("reads txt as a file format of its own and (UNI-2045 SV-7)", () => {
    const notes = documentRow(doc({ kind: "file", title: "Ghi chú.txt", format: "txt" }));
    expect(rowFormat(notes)).toBe("txt");
  });
});

describe("access column (UNI-1642)", () => {
  const lvl = (my_level: string | null | undefined, visibility = "workspace") =>
    documentRow(doc({ my_level: my_level as DocumentSummaryRow["my_level"], visibility: visibility as DocumentSummaryRow["visibility"] }));

  it("maps visibility and leaves an unknown value or a source row blank", () => {
    expect(rowVisibilityLabelKey(lvl("view", "workspace"))).toBe("documents.scope.workspace");
    expect(rowVisibilityLabelKey(lvl("view", "restricted"))).toBe("documents.scope.private");
    expect(rowVisibilityLabelKey(lvl("view", "public"))).toBeNull();
    expect(rowVisibilityLabelKey(lvl("view", ""))).toBeNull();
    expect(rowVisibilityLabelKey(src())).toBeNull();
  });
});

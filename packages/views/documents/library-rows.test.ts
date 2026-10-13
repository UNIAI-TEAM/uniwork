import { describe, expect, it } from "vitest";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { greetingPart } from "./documents-home-create";
import {
  byUpdatedDesc,
  documentRow,
  folderPath,
  formatBytes,
  groupRows,
  indexTree,
  matchesChip,
  mergeNewestFirst,
  rowOrigin,
  rowSizeBytes,
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

  it("greets by the time of day", () => {
    expect(greetingPart(8)).toBe("morning");
    expect(greetingPart(14)).toBe("afternoon");
    expect(greetingPart(21)).toBe("evening");
    expect(greetingPart(2)).toBe("evening");
  });
});

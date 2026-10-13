import { describe, expect, it } from "vitest";
import { favoriteRow, knownDocuments } from "./starred-rows";

const fav = { document_id: "d1", workspace_id: "ws", title: "Q4.xlsx", kind: "file", parent_id: "f1" };

describe("starred rows", () => {
  it("fills dates, editor and size from a loaded copy, keeping the favorite's identity", () => {
    const known = knownDocuments([
      [["documents", "ws", "list"], { pages: [{ documents: [{ id: "d1", title: "old", updated_at: "2026-10-01T00:00:00Z", updated_by: "u1", size_bytes: 10 }] }] }],
      [["documents", "ws", "detail", "d1"], { id: "d1", updated_at: "2026-10-02T00:00:00Z", updated_by: "u2", my_level: "view" }],
      [["documents", "ws", "tree"], { documents: "not a list" }],
      [["documents", "ws", "other"], undefined],
    ]);
    const row = favoriteRow(fav, known.get("d1"));
    expect(row).toMatchObject({ id: "d1", title: "Q4.xlsx", parent_id: "f1", updated_at: "2026-10-02T00:00:00Z", updated_by: "u2", my_level: "view" });
  });

  it("keeps the first list copy and says nothing it does not know", () => {
    const known = knownDocuments([
      [null, { pages: [{ documents: [{ id: "d1", updated_at: "a" }, { id: 7 }] }] }],
      [null, { pages: [{ documents: [{ id: "d1", updated_at: "b" }] }] }],
    ]);
    expect(known.get("d1")?.updated_at).toBe("a");
    expect(favoriteRow(fav)).toMatchObject({ updated_at: "", updated_by: "", revision: "", size_bytes: undefined });
  });
});

import { describe, expect, it } from "vitest";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { documentRow, sourceRow, type DocumentSummaryRow } from "./library-rows";
import {
  compareRows,
  DEFAULT_LIBRARY_SORT,
  mergeSorted,
  nextSort,
  readLibrarySort,
  SORT_STORAGE_KEY,
  sortRows,
  sortStorageKey,
  writeLibrarySort,
  type LibrarySort,
} from "./library-sort";

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
  } as DocumentSummaryRow;
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

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const NO_NAMES = new Map<string, string>();
const by = (column: LibrarySort["column"], order: LibrarySort["order"]): LibrarySort => ({ column, order });

describe("nextSort", () => {
  it("starts a new column ascending, Cập nhật and Dung lượng descending, and flips the sorted one", () => {
    expect(nextSort(DEFAULT_LIBRARY_SORT, "name")).toEqual(by("name", "asc"));
    expect(nextSort(by("name", "asc"), "name")).toEqual(by("name", "desc"));
    expect(nextSort(by("name", "desc"), "name")).toEqual(by("name", "asc"));
    expect(nextSort(by("name", "asc"), "updated")).toEqual(by("updated", "desc"));
    expect(nextSort(by("name", "asc"), "size")).toEqual(by("size", "desc"));
    expect(nextSort(by("name", "asc"), "editor")).toEqual(by("editor", "asc"));
    expect(nextSort(DEFAULT_LIBRARY_SORT, "updated")).toEqual(by("updated", "asc"));
  });
});

describe("sortRows", () => {
  it("sorts by Name in Vietnamese collation ('Ă' after 'A', 'Đ' after 'D', not after z), both ways", () => {
    const rows = ["Bình", "Ân", "Ăn", "An", "Zeta", "Đào", "Dũng"].map((title) => documentRow(doc({ id: title, title })));
    expect(ids(sortRows(rows, by("name", "asc"), NO_NAMES))).toEqual(["An", "Ăn", "Ân", "Bình", "Dũng", "Đào", "Zeta"]);
    expect(ids(sortRows(rows, by("name", "desc"), NO_NAMES))).toEqual(["Zeta", "Đào", "Dũng", "Bình", "Ân", "Ăn", "An"]);
  });

  it("sorts by update time and sinks a row with no date in both orders", () => {
    const rows = [
      documentRow(doc({ id: "old", updated_at: "2026-01-01T00:00:00Z" })),
      documentRow(doc({ id: "none" })),
      documentRow(doc({ id: "new", updated_at: "2026-10-01T00:00:00Z" })),
    ];
    expect(ids(sortRows(rows, by("updated", "desc"), NO_NAMES))).toEqual(["new", "old", "none"]);
    expect(ids(sortRows(rows, by("updated", "asc"), NO_NAMES))).toEqual(["old", "new", "none"]);
  });

  it("sorts by size with no file counting as 0: first ascending, last descending", () => {
    const rows = [
      documentRow(doc({ id: "big", kind: "file", size_bytes: 9000 })),
      documentRow(doc({ id: "page", kind: "page" })),
      documentRow(doc({ id: "small", kind: "file", size_bytes: 10 })),
    ];
    expect(ids(sortRows(rows, by("size", "desc"), NO_NAMES))).toEqual(["big", "small", "page"]);
    expect(ids(sortRows(rows, by("size", "asc"), NO_NAMES))).toEqual(["page", "small", "big"]);
  });

  it("sorts by the editor's display name; an agent or an unknown member goes last", () => {
    const names = new Map([
      ["u1", "Bình"],
      ["u2", "An"],
    ]);
    const rows = [
      documentRow(doc({ id: "binh", updated_by: "u1" })),
      documentRow(doc({ id: "agent", updated_by: "a1", updated_by_kind: "agent" })),
      documentRow(doc({ id: "an", updated_by: "u2" })),
      documentRow(doc({ id: "gone", updated_by: "u9" })),
    ];
    expect(ids(sortRows(rows, by("editor", "asc"), names))).toEqual(["an", "binh", "agent", "gone"]);
    // No name goes last in both directions; the tie among them follows the order's id direction.
    expect(ids(sortRows(rows, by("editor", "desc"), names))).toEqual(["binh", "an", "gone", "agent"]);
  });

  it("breaks a tie by id in the same direction as the sort", () => {
    const rows = ["y", "z", "x"].map((id) => documentRow(doc({ id, title: "Same" })));
    expect(ids(sortRows(rows, by("name", "asc"), NO_NAMES))).toEqual(["x", "y", "z"]);
    expect(ids(sortRows(rows, by("name", "desc"), NO_NAMES))).toEqual(["z", "y", "x"]);
    // A source file ties by its own id, not the `source:` row key.
    const mixed = [src({ id: "chat:m", name: "Same" }), documentRow(doc({ id: "chat:a", title: "same" }))];
    expect(ids(sortRows(mixed, by("name", "asc"), NO_NAMES))).toEqual(["chat:a", "source:chat:m"]);
  });
});

describe("mergeSorted", () => {
  const d = (id: string, at: string) => documentRow(doc({ id, updated_at: at }));
  const s = (id: string, at: string) => src({ id, updated_at: at });
  const desc = by("updated", "desc");

  it("interleaves the two lists so the next page only adds rows below the ones shown", () => {
    const docs = [d("d1", "2026-10-09T00:00:00Z"), d("d2", "2026-10-05T00:00:00Z")];
    const sources = [s("chat:a", "2026-10-08T00:00:00Z"), s("chat:b", "2026-10-01T00:00:00Z")];
    // Both lists have more: nothing below the newer of the two last rows is shown yet.
    expect(ids(mergeSorted(docs, sources, { docs: true, sources: true }, desc, NO_NAMES))).toEqual(["d1", "source:chat:a", "d2"]);
    expect(ids(mergeSorted(docs, sources, { docs: false, sources: true }, desc, NO_NAMES))).toEqual(["d1", "source:chat:a", "d2", "source:chat:b"]);
    expect(ids(mergeSorted(docs, sources, { docs: false, sources: false }, desc, NO_NAMES))).toEqual(["d1", "source:chat:a", "d2", "source:chat:b"]);

    const next = [...docs, d("d3", "2026-10-03T00:00:00Z"), d("d4", "2026-09-30T00:00:00Z")];
    const shown = ids(mergeSorted(docs, sources, { docs: true, sources: true }, desc, NO_NAMES));
    const after = ids(mergeSorted(next, sources, { docs: false, sources: true }, desc, NO_NAMES));
    expect(after.slice(0, shown.length)).toEqual(shown);
    expect(after).toEqual(["d1", "source:chat:a", "d2", "d3", "source:chat:b"]);
  });

  it("never hides a row by its own list's bound, even when the comparator disagrees with the server's order", () => {
    // Equal dates, ids out of the comparator's order: the server's order wins inside a list.
    const docs = [d("d-b", "2026-10-01T00:00:00Z"), d("d-a", "2026-10-01T00:00:00Z")];
    expect(ids(mergeSorted(docs, [], { docs: true, sources: true }, desc, NO_NAMES))).toEqual(["d-b", "d-a"]);
  });

  it("merges in the chosen order and never re-sorts inside a list", () => {
    // Each list arrives in the server's name order; the merge only interleaves.
    const docs = [documentRow(doc({ id: "d-an", title: "An" })), documentRow(doc({ id: "d-zeta", title: "Zeta" }))];
    const sources = [src({ id: "chat:b", name: "Bình.pdf" })];
    expect(ids(mergeSorted(docs, sources, { docs: false, sources: false }, by("name", "asc"), NO_NAMES))).toEqual([
      "d-an",
      "source:chat:b",
      "d-zeta",
    ]);
    const desc = [documentRow(doc({ id: "d-zeta", title: "Zeta" })), documentRow(doc({ id: "d-an", title: "An" }))];
    expect(ids(mergeSorted(desc, sources, { docs: false, sources: false }, by("name", "desc"), NO_NAMES))).toEqual([
      "d-zeta",
      "source:chat:b",
      "d-an",
    ]);
  });
});

describe("compareRows", () => {
  it("falls through to the id, in the order's direction, for two rows that both lack the value", () => {
    const a = documentRow(doc({ id: "a" }));
    const b = documentRow(doc({ id: "b" }));
    expect(compareRows(a, b, by("updated", "asc"), NO_NAMES)).toBeLessThan(0);
    expect(compareRows(a, b, by("updated", "desc"), NO_NAMES)).toBeGreaterThan(0);
    expect(compareRows(a, a, by("updated", "desc"), NO_NAMES) === 0).toBe(true);
  });
});

describe("the remembered sort", () => {
  function adapter(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
  }

  it("persists per viewer under uniwork_documents_sort:<userId> and neither reads nor writes without a user", () => {
    const store = adapter();
    expect(sortStorageKey("u1")).toBe(`${SORT_STORAGE_KEY}:u1`);
    expect(SORT_STORAGE_KEY).toBe("uniwork_documents_sort");
    expect(readLibrarySort("u1", store)).toEqual(DEFAULT_LIBRARY_SORT);
    writeLibrarySort("u1", by("size", "asc"), store);
    expect(JSON.parse(store.map.get("uniwork_documents_sort:u1")!)).toEqual(by("size", "asc"));
    expect(readLibrarySort("u1", store)).toEqual(by("size", "asc"));
    // A second viewer on the same browser does not share u1's choice.
    expect(readLibrarySort("u2", store)).toEqual(DEFAULT_LIBRARY_SORT);

    const before = store.map.size;
    for (const none of [null, undefined, ""]) {
      expect(readLibrarySort(none, store)).toEqual(DEFAULT_LIBRARY_SORT);
      writeLibrarySort(none, by("name", "asc"), store);
    }
    expect(store.map.size).toBe(before);
  });

  it("reads the old folder choice once into the new key and drops the old one", () => {
    const store = adapter({ "uniwork_documents_folder_sort:u1": "name" });
    expect(readLibrarySort("u1", store)).toEqual(by("name", "asc"));
    expect(store.map.has("uniwork_documents_folder_sort:u1")).toBe(false);
    expect(JSON.parse(store.map.get("uniwork_documents_sort:u1")!)).toEqual(by("name", "asc"));

    const updated = adapter({ "uniwork_documents_folder_sort:u1": "updated" });
    expect(readLibrarySort("u1", updated)).toEqual(DEFAULT_LIBRARY_SORT);
    expect(updated.map.has("uniwork_documents_folder_sort:u1")).toBe(false);

    // The new key wins and the legacy one is left alone when both exist (nothing to migrate).
    const both = adapter({
      "uniwork_documents_sort:u1": JSON.stringify(by("editor", "desc")),
      "uniwork_documents_folder_sort:u1": "name",
    });
    expect(readLibrarySort("u1", both)).toEqual(by("editor", "desc"));
  });

  it("falls back to the default for a malformed value or storage that throws", () => {
    expect(readLibrarySort("u1", adapter({ "uniwork_documents_sort:u1": "{nope" }))).toEqual(DEFAULT_LIBRARY_SORT);
    expect(readLibrarySort("u1", adapter({ "uniwork_documents_sort:u1": JSON.stringify({ column: "access", order: "asc" }) }))).toEqual(
      DEFAULT_LIBRARY_SORT,
    );
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
    expect(readLibrarySort("u1", throwing)).toEqual(DEFAULT_LIBRARY_SORT);
    expect(readLibrarySort("u1", null)).toEqual(DEFAULT_LIBRARY_SORT);
    expect(() => writeLibrarySort("u1", by("name", "asc"), throwing)).not.toThrow();
    expect(() => writeLibrarySort("u1", by("name", "asc"), null)).not.toThrow();
  });
});

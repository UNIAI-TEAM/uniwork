import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { documentRow, type DocumentSummaryRow } from "./library-rows";
import { sortRows } from "./library-sort";

// The server orders Tên with an ICU Vietnamese collation (expected generated
// from Postgres) and the web merges with Intl.Collator("vi"); both are held to
// the one fixture the server slice owns. It arrives with that slice's branch,
// so until it is merged here the suite is skipped rather than failing.
const FIXTURE = join(__dirname, "../../core/documents/vi-sort-fixture.json");
const present = existsSync(FIXTURE);
const { titles, expected } = present
  ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as { titles: string[]; expected: string[] })
  : { titles: [] as string[], expected: [] as string[] };

const rowsOf = (list: string[]) =>
  list.map((title, i) => documentRow({ id: `id-${String(i).padStart(3, "0")}`, kind: "page", title } as DocumentSummaryRow));
const titlesOf = (rows: ReturnType<typeof rowsOf>) => rows.map((row) => (row.type === "document" ? row.doc.title : ""));

describe.skipIf(!present)("Vietnamese title order (shared with the server)", () => {
  it("covers every title once in the expected order", () => {
    expect(titles).toHaveLength(expected.length);
    expect([...titles].sort()).toEqual([...expected].sort());
  });

  it("sorts the fixture titles into the expected order, ascending", () => {
    expect(titlesOf(sortRows(rowsOf(titles), { column: "name", order: "asc" }, new Map()))).toEqual(expected);
  });

  it("sorts them into the reverse order, descending", () => {
    expect(titlesOf(sortRows(rowsOf(titles), { column: "name", order: "desc" }, new Map()))).toEqual([...expected].reverse());
  });
});

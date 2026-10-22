import { describe, expect, it } from "vitest";
import { documentRow, type DocumentSummaryRow, type LibraryRow } from "../library-rows";
import { docListGroupScreen, groupRowsByDate } from "./date-groups";
import vectors from "./doclist-vectors.json";

// UNI-2045 W11: the date groups of Gần đây (last activity), Được chia sẻ với
// tôi (shared date) and Thùng rác (days left), built over the rows in the
// server's order. The labels come from groups.ts and its shared vectors.

const at = (local: string) => new Date(local);

function doc(id: string, over: Partial<DocumentSummaryRow> = {}): LibraryRow {
  return documentRow({ id, workspace_id: "w1", kind: "page", title: id, revision: "1", updated_at: "2026-10-01T00:00:00Z", ...over } as DocumentSummaryRow);
}
const recentRow = (id: string, when: string | null) => doc(id, when ? { last_activity: { kind: "opened", at: when } } : {});
const sharedRow = (id: string, when: string) => doc(id, { shared: { by: "u2", by_kind: "human", by_name: "Bình", at: when } });
const trashRow = (id: string, purge: string) => doc(id, { archived_at: "2026-10-01T00:00:00Z", purge_after: purge });

describe("groupRowsByDate", () => {
  it("puts each recent row in the vectors' group, across the Monday boundary", () => {
    for (const c of vectors.groups.cases.filter((v) => v.screen !== "trash" && typeof v.input.at === "string")) {
      const at0 = (c.input as { at: string }).at;
      const row = c.screen === "recent" ? recentRow("r", at0) : sharedRow("s", at0);
      // A second row with a known date keeps the screen grouped even when the case's date is invalid.
      const anchor = c.screen === "recent" ? recentRow("anchor", c.now) : sharedRow("anchor", c.now);
      const groups = groupRowsByDate([anchor, row], c.screen as "recent" | "shared", at(c.now));
      expect(groups.find((group) => group.rows.some((r) => r.id === row.id))?.key, c.label).toBe(c.group);
    }
  });

  it("orders the groups by the screen's fixed order and drops the empty ones", () => {
    const now = at("2026-10-21T09:05:00");
    const rows = [
      recentRow("today", "2026-10-21T08:00:00"),
      recentRow("week", "2026-10-19T08:00:00"),
      recentRow("old", "2026-10-01T08:00:00"),
      recentRow("none", null),
    ];
    const groups = groupRowsByDate(rows, "recent", now);
    expect(groups.map((group) => [group.key, group.rows.map((row) => row.id)])).toEqual([
      ["today", ["today"]],
      ["this_week", ["week"]],
      ["earlier", ["old", "none"]],
    ]);
  });

  it("splits the trash into Sắp xóa vĩnh viễn first and Còn trên 7 ngày, by purge_after", () => {
    const now = at("2026-10-21T09:05:00");
    const groups = groupRowsByDate(
      [trashRow("soon", "2026-10-25T00:00:00"), trashRow("later", "2026-11-15T00:00:00"), trashRow("edge", "2026-10-28T09:05:00")],
      "trash",
      now,
    );
    expect(groups.map((group) => [group.key, group.rows.map((row) => row.id)])).toEqual([
      ["deleting_soon", ["soon", "edge"]],
      ["more_than_7_days", ["later"]],
    ]);
  });

  it("stays one flat group when no row carries the screen's date (a server without the field)", () => {
    const now = at("2026-10-21T09:05:00");
    expect(groupRowsByDate([doc("a"), doc("b")], "recent", now)).toEqual([{ key: "all", rows: [doc("a"), doc("b")] }]);
    expect(groupRowsByDate([doc("a")], "shared", now).map((group) => group.key)).toEqual(["all"]);
    expect(groupRowsByDate([doc("a", { archived_at: "2026-10-01T00:00:00Z" })], "trash", now).map((group) => group.key)).toEqual(["all"]);
    expect(groupRowsByDate([], "recent", now)).toEqual([{ key: "all", rows: [] }]);
  });

  it("names the group screen of a list screen; the others never group", () => {
    expect(docListGroupScreen("recent")).toBe("recent");
    expect(docListGroupScreen("shared")).toBe("shared");
    expect(docListGroupScreen("trash")).toBe("trash");
    for (const other of ["workspace", "starred", "shared-by-me", "shelved"] as const) expect(docListGroupScreen(other)).toBeNull();
  });
});

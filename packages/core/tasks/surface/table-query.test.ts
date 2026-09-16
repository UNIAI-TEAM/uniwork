import { describe, expect, it, vi } from "vitest";
import { tableRows } from "../../api/endpoints/tasks-table";
import {
  normalizeTableQuery,
  tableGroupsBody,
  tableRowsBranchPrefix,
  tableRowsPageBody,
  tableRowsPageQuery,
} from "./table-query";

vi.mock("../../api/endpoints/tasks-table", () => ({
  tableRows: vi.fn(async () => ({ rows: [] })),
}));

describe("tasks/surface/table-query", () => {
  describe("normalizeTableQuery", () => {
    it("drops empty filter arrays and gives the same object regardless of field construction order", () => {
      const a = normalizeTableQuery({
        filter: { statuses: [], priorities: ["high"], project_ids: [] },
        search: "  hi  ",
      });
      const b = normalizeTableQuery({
        search: "hi",
        filter: { project_ids: [], priorities: ["high"], statuses: [] },
      });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a).toEqual({ filter: { priorities: ["high"] }, search: "hi" });
    });

    it("drops a filter that has no non-empty arrays", () => {
      expect(normalizeTableQuery({ filter: { statuses: [] } })).toEqual({});
    });

    it("trims search and omits it when only whitespace", () => {
      expect(normalizeTableQuery({ search: "   " })).toEqual({});
      expect(normalizeTableQuery({ search: " a " })).toEqual({ search: "a" });
    });

    it("omits sort when it is the server default (position/asc)", () => {
      expect(normalizeTableQuery({ sort: { field: "position", direction: "asc" } })).toEqual({});
      expect(normalizeTableQuery({ sort: { field: "position", direction: "desc" } })).toEqual({
        sort: { field: "position", direction: "desc" },
      });
      expect(normalizeTableQuery({ sort: { field: "title", direction: "asc" } })).toEqual({
        sort: { field: "title", direction: "asc" },
      });
    });

    it("gives a stable field order (filter, search, sort) no matter the input's order", () => {
      const q = normalizeTableQuery({
        sort: { field: "title", direction: "asc" },
        search: "x",
        filter: { statuses: ["todo"] },
      });
      expect(Object.keys(q)).toEqual(["filter", "search", "sort"]);
    });
  });

  it("keys a rows page by its body minus cursor, in the field order the callers have always used", () => {
    const body = tableRowsPageBody({
      query: { filter: { project_ids: ["p1"] } },
      groupBy: "status",
      hierarchy: false,
      groupKey: "status:todo",
      parentId: null,
      cursor: "abc",
      limit: 50,
    });

    expect(tableRowsPageQuery("w1", body).queryKey).toEqual([
      "tasks-table",
      "w1",
      "rows",
      '{"query":{"filter":{"project_ids":["p1"]}},"group_by":"status","group_key":"status:todo","hierarchy":false,"parent_id":null,"limit":50}',
      "abc",
    ]);
  });

  it("keys page 0 (a null cursor) under the empty-string cursor segment", () => {
    const body = tableRowsPageBody({
      query: {},
      groupBy: "status",
      hierarchy: false,
      groupKey: null,
      parentId: null,
      cursor: null,
      limit: 50,
    });

    expect(tableRowsPageQuery("w1", body).queryKey.at(-1)).toBe("");
  });

  it("fetches exactly the body its key was built from", async () => {
    const body = tableRowsPageBody({
      query: {},
      groupBy: "status",
      hierarchy: false,
      groupKey: null,
      parentId: null,
      cursor: null,
      limit: 50,
    });

    await tableRowsPageQuery("w1", body).queryFn();

    expect(vi.mocked(tableRows)).toHaveBeenCalledWith("w1", body);
  });

  it("builds the groups body in the shape the groups hook hashes; groups carry no cursor or limit", () => {
    expect(JSON.stringify(tableGroupsBody({ query: { filter: { statuses: ["todo"] } }, groupBy: "status" }))).toBe(
      '{"query":{"filter":{"statuses":["todo"]}},"group_by":"status"}',
    );
  });

  describe("tableRowsBranchPrefix", () => {
    const params = {
      query: { filter: { project_ids: ["p1"] } },
      groupBy: "status",
      hierarchy: false,
      groupKey: "status:todo",
      parentId: null,
      limit: 50,
    };

    it("is a prefix of every page key of that branch", () => {
      const branch = tableRowsBranchPrefix("w1", tableRowsPageBody({ ...params, cursor: null }));
      const page0 = tableRowsPageQuery("w1", tableRowsPageBody({ ...params, cursor: null })).queryKey;
      const page1 = tableRowsPageQuery("w1", tableRowsPageBody({ ...params, cursor: "next-1" })).queryKey;

      expect(page0.slice(0, branch.length)).toEqual(branch);
      expect(page1.slice(0, branch.length)).toEqual(branch);
    });

    it("is not a prefix of another branch's page key", () => {
      const branch = tableRowsBranchPrefix("w1", tableRowsPageBody({ ...params, cursor: null }));
      const otherBranch = tableRowsPageQuery(
        "w1",
        tableRowsPageBody({ ...params, groupKey: "status:done", cursor: null }),
      ).queryKey;

      expect(otherBranch.slice(0, branch.length)).not.toEqual(branch);
    });
  });
});

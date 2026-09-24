import { describe, expect, it, vi } from "vitest";
import { tableRows } from "../../api/endpoints/tasks-table";
import { ApiError } from "../../api/http";
import {
  tableQueryRetry,
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

    it("preserves expanded filter fields and drops empty or false ones", () => {
      expect(
        normalizeTableQuery({
          filter: {
            statuses: ["todo"],
            include_no_assignee: true,
            include_no_project: false,
            creator_refs: ["human:u1"],
            label_ids: [],
            properties: { prop1: ["a"], prop2: [] },
            date_field: "created_at",
            date_from: "2026-01-01",
            date_to: "",
          },
        }),
      ).toEqual({
        filter: {
          statuses: ["todo"],
          include_no_assignee: true,
          creator_refs: ["human:u1"],
          properties: { prop1: ["a"] },
        },
      });
    });

    it("keeps a stable filter key order for cache keys", () => {
      const q = normalizeTableQuery({
        filter: {
          date_to: "2026-12-31",
          label_ids: ["l1"],
          statuses: ["todo"],
          include_no_project: true,
          priorities: ["high"],
          date_from: "2026-01-01",
          project_ids: ["p1"],
          include_no_assignee: true,
          assignee_ids: ["u1"],
          creator_refs: ["human:c1"],
          properties: { x: ["1"] },
          date_field: "updated_at",
        },
      });
      expect(Object.keys(q.filter!)).toEqual([
        "statuses",
        "priorities",
        "assignee_ids",
        "include_no_assignee",
        "project_ids",
        "include_no_project",
        "creator_refs",
        "label_ids",
        "properties",
        "date_field",
        "date_from",
        "date_to",
      ]);
    });

    it("omits date fields unless date_field is set and both bounds are non-empty", () => {
      expect(
        normalizeTableQuery({
          filter: { date_field: "created_at", date_from: "2026-01-01", date_to: "2026-12-31" },
        }),
      ).toEqual({
        filter: {
          date_field: "created_at",
          date_from: "2026-01-01",
          date_to: "2026-12-31",
        },
      });
      expect(
        normalizeTableQuery({ filter: { date_field: "created_at", date_from: "", date_to: "2026-12-31" } }),
      ).toEqual({});
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

  describe("tableQueryRetry", () => {
    it("never retries a client error: the same request would fail the same way", () => {
      for (const status of [400, 404, 409, 422, 499]) {
        expect(tableQueryRetry(0, new ApiError("no", "bad", status))).toBe(false);
      }
    });

    it("retries a server or network failure once", () => {
      expect(tableQueryRetry(0, new ApiError("down", "internal", 500))).toBe(true);
      expect(tableQueryRetry(0, new Error("network"))).toBe(true);
      expect(tableQueryRetry(1, new Error("network"))).toBe(false);
    });

    it("is what a rows page asks with", () => {
      const body = tableRowsPageBody({
        query: {},
        groupBy: "none",
        hierarchy: true,
        groupKey: null,
        parentId: null,
        cursor: null,
        limit: 50,
      });
      expect(tableRowsPageQuery("w1", body).retry).toBe(tableQueryRetry);
    });
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { tableFacets, tableGroups, tableRows } from "./tasks-table";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const validTask = {
  id: "t1",
  workspace_id: "ws1",
  title: "Việc",
  description: "",
  status: "todo",
  priority: "medium",
  position: 1,
  created_by: "u1",
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
};

describe("tasks-table endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("tableGroups sends the query{filter,search,sort}/group_by body and returns groups", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        query_fingerprint: "abc",
        total: 1,
        groups: [{ key: "status:todo", value: { kind: "status", status: "todo" }, count: 1 }],
        next_cursor: null,
      }),
    );
    const res = await tableGroups("ws1", {
      query: { filter: { statuses: ["todo"], project_ids: ["proj1"] } },
      group_by: "status",
    });
    expect(res.groups[0]?.key).toBe("status:todo");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual({
      query: { filter: { statuses: ["todo"], project_ids: ["proj1"] } },
      group_by: "status",
    });
  });

  it("tableGroups falls back to empty on a non-object response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json("not an object"));
    await expect(tableGroups("ws1", { query: {}, group_by: "status" })).resolves.toMatchObject({
      groups: [],
      total: 0,
    });
  });

  it("tableGroups falls back to empty when groups is not an array", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ query_fingerprint: "a", total: 1, groups: "nope" }));
    await expect(tableGroups("ws1", { query: {}, group_by: "status" })).resolves.toMatchObject({
      groups: [],
      total: 0,
    });
  });

  it("tableRows sends the cursor-contract body and returns rows with labels", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        query_fingerprint: "abc",
        group_key: "status:todo",
        parent_id: null,
        total: 1,
        rows: [
          {
            task: validTask,
            direct_child_count: 0,
            labels: [{ id: "l1", name: "Bug", color: "#f00" }],
          },
        ],
        next_cursor: "cursor-2",
      }),
    );
    const body = {
      query: {},
      group_by: "status",
      group_key: "status:todo",
      hierarchy: false,
      parent_id: null,
      cursor: null,
      limit: 50,
    };
    const res = await tableRows("ws1", body);
    expect(res.rows[0]?.task.id).toBe("t1");
    expect(res.rows[0]?.labels).toEqual([{ id: "l1", name: "Bug", color: "#f00" }]);
    expect(res.next_cursor).toBe("cursor-2");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual(body);
  });

  it("tableRows falls back to empty on a non-object response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(null));
    await expect(
      tableRows("ws1", { query: {}, group_by: "status", group_key: null, hierarchy: false, parent_id: null, cursor: null, limit: 50 }),
    ).resolves.toMatchObject({ rows: [], total: 0 });
  });

  it("tableRows falls back to empty when rows is not an array", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ query_fingerprint: "a", total: 1, rows: "nope" }),
    );
    await expect(
      tableRows("ws1", { query: {}, group_by: "status", group_key: null, hierarchy: false, parent_id: null, cursor: null, limit: 50 }),
    ).resolves.toMatchObject({ rows: [] });
  });

  it("tableRows falls back to empty when a row's task is malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        query_fingerprint: "a",
        total: 1,
        rows: [{ task: { id: 1 }, direct_child_count: 0 }],
      }),
    );
    await expect(
      tableRows("ws1", { query: {}, group_by: "status", group_key: null, hierarchy: false, parent_id: null, cursor: null, limit: 50 }),
    ).resolves.toMatchObject({ rows: [] });
  });

  it("tableRows degrades a row with missing labels to an empty array instead of dropping the row", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        query_fingerprint: "a",
        group_key: null,
        parent_id: null,
        total: 1,
        rows: [{ task: validTask, direct_child_count: 0 }],
        next_cursor: null,
      }),
    );
    const res = await tableRows("ws1", {
      query: {},
      group_by: "status",
      group_key: null,
      hierarchy: false,
      parent_id: null,
      cursor: null,
      limit: 50,
    });
    expect(res.rows).toEqual([{ task: expect.objectContaining({ id: "t1" }), direct_child_count: 0, labels: [] }]);
  });

  it("tableRows normalizes a missing next_cursor to null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        query_fingerprint: "a",
        group_key: null,
        parent_id: null,
        total: 0,
        rows: [],
      }),
    );
    const res = await tableRows("ws1", {
      query: {},
      group_by: "status",
      group_key: null,
      hierarchy: false,
      parent_id: null,
      cursor: null,
      limit: 50,
    });
    expect(res.next_cursor).toBeNull();
  });

  it("tableFacets sends the query/facets body, lets unknown facet kinds through and falls back on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        query_fingerprint: "abc",
        total: 2,
        facets: [{ kind: "custom_field", values: [{ key: "x", count: 2 }] }],
      }),
    );
    const res = await tableFacets("ws1", { query: {}, facets: ["status"] });
    expect(res.facets[0]?.kind).toBe("custom_field");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual({
      query: {},
      facets: ["status"],
    });

    vi.mocked(fetch).mockResolvedValueOnce(json({ facets: 1 }));
    await expect(tableFacets("ws1", { query: {}, facets: ["status"] })).resolves.toMatchObject({
      facets: [],
      total: 0,
    });
  });

  it("tableFacets falls back to empty on a non-object response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(42));
    await expect(tableFacets("ws1", { query: {}, facets: ["status"] })).resolves.toMatchObject({
      facets: [],
      total: 0,
    });
  });
});

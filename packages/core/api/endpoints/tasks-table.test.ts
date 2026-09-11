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

  it("tableGroups returns groups and empty fallback on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        query_fingerprint: "abc",
        total: 1,
        groups: [{ key: "todo", value: { kind: "status", status: "todo" }, count: 1 }],
        next_cursor: null,
      }),
    );
    const res = await tableGroups("ws1", {
      group_by: "status",
      filter: { statuses: ["todo"], project_ids: ["proj1"] },
    });
    expect(res.groups[0]?.key).toBe("todo");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({
      filter: { statuses: ["todo"], project_ids: ["proj1"] },
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ groups: "nope" }));
    await expect(tableGroups("ws1", { group_by: "status" })).resolves.toMatchObject({
      groups: [],
      total: 0,
    });
  });

  it("tableRows returns rows and empty on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        query_fingerprint: "abc",
        group_key: "todo",
        parent_id: null,
        total: 1,
        rows: [{ task: validTask, direct_child_count: 0 }],
        branch_total: 1,
        next_cursor: null,
      }),
    );
    const res = await tableRows("ws1", { group_by: "status", group_key: "todo" });
    expect(res.rows[0]?.task.id).toBe("t1");
    vi.mocked(fetch).mockResolvedValueOnce(json({ rows: [{ task: { id: 1 } }] }));
    await expect(tableRows("ws1", { group_by: "status" })).resolves.toMatchObject({ rows: [] });
  });

  it("tableFacets lets unknown facet kinds through and falls back on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        query_fingerprint: "abc",
        total: 2,
        facets: [{ kind: "custom_field", values: [{ key: "x", count: 2 }] }],
      }),
    );
    const res = await tableFacets("ws1", { facets: ["status"] });
    expect(res.facets[0]?.kind).toBe("custom_field");
    vi.mocked(fetch).mockResolvedValueOnce(json({ facets: 1 }));
    await expect(tableFacets("ws1", { facets: ["status"] })).resolves.toMatchObject({
      facets: [],
      total: 0,
    });
  });
});

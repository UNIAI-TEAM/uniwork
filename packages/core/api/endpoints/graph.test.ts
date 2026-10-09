import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { getGraphHistory, getGraphNeighbors } from "./graph";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const node = { type: "MEETING", id: "m1", subtype: "", title: "Giao ban", status: "ENDED", workspace_id: "w1", workspace_slug: "team", deleted: false };

describe("graph endpoints", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("getGraphNeighbors builds the query and keeps the good rows", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ node, items: [{ edge_type: 1 }, { edge_type: "ORIGINATED_FROM", direction: "out", origin: "SYSTEM", valid_from: "2026-10-07T00:00:00Z", backfilled: false, node }], next_cursor: "c" }),
    );
    const got = await getGraphNeighbors("w1", "TASK", "t1", { edgeTypes: ["ORIGINATED_FROM", "OWNED_BY"], direction: "out", limit: 20 });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
      "/api/v1/workspaces/w1/graph/nodes/TASK/t1/neighbors?edge_types=ORIGINATED_FROM%2COWNED_BY&direction=out&limit=20",
    );
    expect(got.items).toHaveLength(1);
    expect(got.next_cursor).toBe("c");
  });

  it("getGraphNeighbors degrades on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: "nope" }));
    await expect(getGraphNeighbors("w1", "TASK", "t1")).resolves.toEqual({ node: null, items: [], next_cursor: "" });
  });

  it("getGraphHistory degrades on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ node: 3, items: [{ kind: "edge" }] }));
    await expect(getGraphHistory("w1", "TASK", "t1")).resolves.toEqual({ node: null, items: [] });
  });
});

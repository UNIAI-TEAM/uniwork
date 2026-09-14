import { describe, expect, it, vi } from "vitest";
import { tableRows } from "../../api/endpoints/tasks-table";
import { tableGroupsBody, tableRowsPageBody, tableRowsPageQuery } from "./table-query";

vi.mock("../../api/endpoints/tasks-table", () => ({
  tableRows: vi.fn(async () => ({ rows: [] })),
}));

describe("tasks/surface/table-query", () => {
  it("keys a rows page by its body, in the field order the table view has always used", () => {
    const body = tableRowsPageBody({
      filter: { project_ids: ["p1"] },
      groupBy: "status",
      groupKey: "todo",
      columns: ["title", "status"],
      limit: 50,
      offset: 50,
    });

    expect(tableRowsPageQuery("w1", body).queryKey).toEqual([
      "tasks-table",
      "w1",
      "rows",
      '{"filter":{"project_ids":["p1"]},"group_by":"status","group_key":"todo","columns":["title","status"],"limit":50,"offset":50}',
    ]);
  });

  it("fetches exactly the body its key was built from", async () => {
    const body = tableRowsPageBody({
      groupBy: "status",
      groupKey: null,
      columns: ["title"],
      limit: 50,
      offset: 0,
    });

    await tableRowsPageQuery("w1", body).queryFn();

    expect(vi.mocked(tableRows)).toHaveBeenCalledWith("w1", body);
  });

  it("builds the first groups page in the shape the groups hook hashes", () => {
    expect(
      JSON.stringify(tableGroupsBody({ groupBy: "status", columns: ["title"], limit: 50 })),
    ).toBe('{"group_by":"status","columns":["title"],"limit":50,"offset":0}');
  });
});

import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ listWorkspaces: vi.fn(async () => [{ id: "w1" }]) }));
vi.mock("../api", () => ({ api: apiMock }));

import { workspaceListOptions } from "./workspaces";

describe("workspaceListOptions", () => {
  it("keys the list and hands the query's signal to the api", async () => {
    const options = workspaceListOptions();
    expect(options.queryKey).toEqual(["workspaces"]);
    const signal = new AbortController().signal;
    const queryFn = options.queryFn as (ctx: { signal: AbortSignal }) => Promise<unknown>;
    expect(await queryFn({ signal })).toEqual([{ id: "w1" }]);
    expect(apiMock.listWorkspaces).toHaveBeenCalledWith({ signal });
  });
});

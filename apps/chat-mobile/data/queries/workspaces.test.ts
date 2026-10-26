import { onlineManager, QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => onlineManager.setOnline(true));

// TestFlight build 4: iOS's reachability probe called a working network offline, and the picker's first fetch
// waited for an online that never came. The list is asked once whatever the probe says; a real network failure
// then shows as an error with Retry instead of an endless wait.
describe("the list while the app thinks it is offline", () => {
  it("is still asked once", async () => {
    onlineManager.setOnline(false);
    apiMock.listWorkspaces.mockClear();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(await client.fetchQuery(workspaceListOptions())).toEqual([{ id: "w1" }]);
    expect(apiMock.listWorkspaces).toHaveBeenCalledTimes(1);
  });
});

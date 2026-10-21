import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ request: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>() }));
vi.mock("../api", () => ({ api: apiMock }));

import { deactivatedMembersOptions, fetchDeactivatedUserIds } from "./org-members";

const paths = () => apiMock.request.mock.calls.map(([path]) => path);

beforeEach(() => apiMock.request.mockReset());

describe("fetchDeactivatedUserIds", () => {
  it("follows next_cursor through every page of deactivated people", async () => {
    apiMock.request
      .mockResolvedValueOnce({ members: [{ user_id: "D1" }], next_cursor: "c 2" })
      .mockResolvedValueOnce({ members: [{ user_id: "D2" }], next_cursor: "" });
    expect(await fetchDeactivatedUserIds("acme")).toEqual(["D1", "D2"]);
    expect(paths()).toEqual([
      "/api/v1/orgs/acme/members?status=deactivated&limit=100",
      "/api/v1/orgs/acme/members?status=deactivated&limit=100&cursor=c%202",
    ]);
  });

  it("stops at the page cap even if the server keeps answering a cursor", async () => {
    apiMock.request.mockResolvedValue({ members: [], next_cursor: "again" });
    expect(await fetchDeactivatedUserIds("acme")).toEqual([]);
    expect(apiMock.request).toHaveBeenCalledTimes(10);
  });

  it("a malformed page hides no one", async () => {
    apiMock.request.mockResolvedValueOnce({ members: "x" });
    expect(await fetchDeactivatedUserIds("acme")).toEqual([]);
  });
});

describe("query options", () => {
  it("keys the deactivated people by organization and hands the signal through", async () => {
    const signal = new AbortController().signal;
    apiMock.request.mockResolvedValue({});
    const options = deactivatedMembersOptions("acme");
    expect(options.queryKey).toEqual(["org", "acme", "deactivated-members"]);
    await (options.queryFn as (ctx: { signal: AbortSignal }) => Promise<unknown>)({ signal });
    expect(paths()).toEqual(["/api/v1/orgs/acme/members?status=deactivated&limit=100"]);
    expect(apiMock.request.mock.calls[0]?.[1]).toEqual({ signal });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ request: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>() }));
vi.mock("../api", () => ({ api: apiMock }));

import { activeMembersOptions, deactivatedMembersOptions, fetchDeactivatedUserIds } from "./org-members";

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

describe("the active members (an owner hands the organization to one)", () => {
  it("reads every page of active people with their names and roles", async () => {
    apiMock.request
      .mockResolvedValueOnce({
        members: [{ user_id: "A1", display_name: "Chi", email: "chi@acme.vn", role: "admin", deactivated_at: null }],
        next_cursor: "n",
      })
      .mockResolvedValueOnce({ members: [{ user_id: "A2", display_name: "Bình", email: "binh@acme.vn", role: "member" }] });
    const signal = new AbortController().signal;
    const options = activeMembersOptions("acme");
    expect(options.queryKey).toEqual(["org", "acme", "active-members"]);
    const rows = await (options.queryFn as (ctx: { signal: AbortSignal }) => Promise<unknown>)({ signal });
    expect(rows).toEqual([
      { user_id: "A1", display_name: "Chi", email: "chi@acme.vn", role: "admin", deactivated_at: null },
      { user_id: "A2", display_name: "Bình", email: "binh@acme.vn", role: "member" },
    ]);
    expect(paths()).toEqual(["/api/v1/orgs/acme/members?status=active&limit=100", "/api/v1/orgs/acme/members?status=active&limit=100&cursor=n"]);
  });

  it("a malformed row degrades: no id drops it, a drifted field reads empty", async () => {
    apiMock.request.mockResolvedValueOnce({
      members: [{ display_name: "No id" }, { user_id: "A3", display_name: 7, email: null, role: {}, deactivated_at: 5 }],
    });
    expect(await (activeMembersOptions("acme").queryFn as (ctx: { signal?: AbortSignal }) => Promise<unknown>)({})).toEqual([
      { user_id: "A3", display_name: "", email: "", role: "", deactivated_at: null },
    ]);
  });
});

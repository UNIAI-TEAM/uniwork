import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  invitationsApi: {
    mine: vi.fn(async () => []),
    preview: vi.fn(async () => null),
    organizations: vi.fn(async () => []),
  },
}));
vi.mock("../invitations/api", () => api);

import { invitationPreviewOptions, myInvitationsOptions, myOrganizationsOptions } from "./invitations";

describe("invitation queries", () => {
  it("sit under one account-scoped root, outside the chat keys", () => {
    expect(myInvitationsOptions().queryKey).toEqual(["invitations", "mine"]);
    expect(invitationPreviewOptions("t1").queryKey).toEqual(["invitations", "preview", "t1"]);
    expect(myOrganizationsOptions().queryKey).toEqual(["invitations", "organizations"]);
  });

  it("ask the endpoints with the query's signal", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await client.fetchQuery(myInvitationsOptions());
    await client.fetchQuery(invitationPreviewOptions("t1"));
    await client.fetchQuery(myOrganizationsOptions());
    expect(api.invitationsApi.mine).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(api.invitationsApi.preview).toHaveBeenCalledWith("t1", expect.any(AbortSignal));
    expect(api.invitationsApi.organizations).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("never retries a refused preview: the refusal is the answer", () => {
    expect(invitationPreviewOptions("t1").retry).toBe(false);
  });
});

// The invitation endpoints: the request each sends, what it reads from a good answer, and that a malformed answer
// degrades to null (never an empty list, which would tell the person nobody invited them).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ api: { request: vi.fn(async () => ({ invitations: [] })) } }));

import { api } from "../api";
import { createInvitationsApi, invitationsApi } from "./api";

const request = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
const invitations = createInvitationsApi(request);

const pending = {
  id: "inv1",
  role: "member",
  token: "tok/1",
  expires_at: "2026-11-01T00:00:00Z",
  org_role: "member",
  workspace: { id: "w1", slug: "hq", name: "HQ" },
  workspaces: [{ id: "w1", slug: "hq", name: "HQ" }],
  organization: { id: "o1", slug: "acme", name: "Acme" },
  invited_by: { display_name: "Bình" },
};
const workspace = { id: "w1", slug: "hq", name: "HQ", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" };

beforeEach(() => request.mockReset());

describe("invitation endpoints", () => {
  it("mine reads the invitations waiting for the account, and null when the answer drifted", async () => {
    const signal = new AbortController().signal;
    request.mockResolvedValueOnce({ invitations: [pending] });
    await expect(invitations.mine(signal)).resolves.toEqual([pending]);
    expect(request).toHaveBeenCalledWith("/api/v1/me/invitations", { signal });
    request.mockResolvedValueOnce({ invitations: [] });
    await expect(invitations.mine()).resolves.toEqual([]);
    request.mockResolvedValueOnce({ invitations: "nope" });
    await expect(invitations.mine()).resolves.toBeNull();
    request.mockResolvedValueOnce("<html>");
    await expect(invitations.mine()).resolves.toBeNull();
  });

  it("preview reads one invitation by its token, encoded, and null when the answer drifted", async () => {
    const answer = {
      invitation: { id: "inv1", status: "pending", expires_at: "2026-11-01T00:00:00Z", organization: pending.organization, workspaces: [], org_role: "admin" },
      conflicts: [],
    };
    request.mockResolvedValueOnce(answer);
    await expect(invitations.preview("tok/1")).resolves.toMatchObject({ invitation: { id: "inv1", status: "pending" }, conflicts: [] });
    expect(request).toHaveBeenCalledWith("/api/v1/invitations/tok%2F1", { signal: undefined });
    request.mockResolvedValueOnce({ invitation: { id: "inv1" } });
    await expect(invitations.preview("tok")).resolves.toBeNull();
  });

  it("accept posts no body and reads where the person landed", async () => {
    request.mockResolvedValueOnce({ organization: { id: "o1", slug: "acme", name: "Acme" }, workspace });
    await expect(invitations.accept("tok/1")).resolves.toEqual({ organization: { id: "o1", slug: "acme", name: "Acme" }, workspace });
    expect(request).toHaveBeenCalledWith("/api/v1/invitations/tok%2F1/accept", { method: "POST" });
  });

  it("accept reads an organization with nowhere to land yet, and a drifted workspace, as no workspace", async () => {
    request.mockResolvedValueOnce({ organization: { id: "o1", slug: "acme", name: "Acme" } });
    await expect(invitations.accept("t")).resolves.toEqual({ organization: { id: "o1", slug: "acme", name: "Acme" }, workspace: null });
    request.mockResolvedValueOnce({ organization: { id: "o1", slug: "acme", name: "Acme" }, workspace: { slug: 3 } });
    await expect(invitations.accept("t")).resolves.toMatchObject({ workspace: null });
  });

  it("accept answers null when the whole answer drifted, and lets a refusal through", async () => {
    request.mockResolvedValueOnce({ ok: true });
    await expect(invitations.accept("t")).resolves.toBeNull();
    const refusal = Object.assign(new Error("organization_switch_required"), { status: 409 });
    request.mockRejectedValueOnce(refusal);
    await expect(invitations.accept("t")).rejects.toBe(refusal);
  });

  it("organizations reads the account's organizations, and null when the answer drifted", async () => {
    request.mockResolvedValueOnce({ organizations: [{ id: "o1", slug: "acme", name: "Acme", role: "member", status: "active" }] });
    await expect(invitations.organizations()).resolves.toEqual([{ id: "o1", slug: "acme", name: "Acme", role: "member", status: "active" }]);
    expect(request).toHaveBeenCalledWith("/api/v1/orgs", { signal: undefined });
    request.mockResolvedValueOnce({ organizations: null });
    await expect(invitations.organizations()).resolves.toBeNull();
  });

  it("the app's binding sends through the bearer client", async () => {
    await invitationsApi.mine();
    expect(api.request).toHaveBeenCalledWith("/api/v1/me/invitations", { signal: undefined });
  });
});

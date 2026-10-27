import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime } from "../../runtime-config";
import * as http from "../http";
import {
  createOrgInviteLink,
  createWorkspaceInviteLink,
  joinMembershipInviteLink,
  listWorkspaceInviteLinks,
  previewMembershipInviteLink,
} from "./membership-invite-links";

describe("membership-invite-links endpoints", () => {
  beforeEach(() => {
    configureRuntime({ apiUrl: "http://api.test", appUrl: "http://app.test" });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listWorkspaceInviteLinks degrades malformed payloads", async () => {
    vi.spyOn(http, "request").mockResolvedValue({ invite_links: "nope" });
    await expect(listWorkspaceInviteLinks("ws1")).resolves.toEqual([]);
  });

  it("createWorkspaceInviteLink returns null on drift", async () => {
    vi.spyOn(http, "request").mockResolvedValue({ invite_link: 1 });
    await expect(createWorkspaceInviteLink("ws1")).resolves.toBeNull();
  });

  it("createOrgInviteLink posts workspace_ids", async () => {
    const spy = vi.spyOn(http, "request").mockResolvedValue({
      invite_link: {
        id: "l1",
        organization_id: "o1",
        status: "active",
        expires_at: "2030-01-01T00:00:00Z",
        secret: "s",
        workspaces: [{ id: "w1", slug: "a", name: "A" }],
        created_at: "2026-01-01T00:00:00Z",
      },
    });
    const link = await createOrgInviteLink("acme", { workspace_ids: ["w1"], expires_in_days: 7 });
    expect(link?.id).toBe("l1");
    expect(spy).toHaveBeenCalledWith(
      "/api/v1/orgs/acme/invite-links",
      expect.objectContaining({
        method: "POST",
        body: { workspace_ids: ["w1"], expires_in_days: 7 },
      }),
    );
  });

  it("previewMembershipInviteLink degrades", async () => {
    vi.spyOn(http, "request").mockResolvedValue(null);
    await expect(previewMembershipInviteLink("l1", "sec")).resolves.toBeNull();
  });

  it("joinMembershipInviteLink returns empty shells on drift", async () => {
    vi.spyOn(http, "request").mockResolvedValue({});
    await expect(joinMembershipInviteLink("l1", "sec")).resolves.toEqual({
      organization: null,
      workspace: null,
      joined_ids: [],
      already_all: false,
    });
  });
});

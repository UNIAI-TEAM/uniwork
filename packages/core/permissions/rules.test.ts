import { describe, expect, it } from "vitest";
import {
  canCreateWorkspaceInOrg,
  canDeleteMeeting,
  canDeleteTask,
  canEditTask,
  canInviteMembers,
  canManageMembers,
} from "./rules";
import type { PermissionContext } from "./types";

const ctx = (over: Partial<PermissionContext>): PermissionContext => ({
  userId: "u1",
  orgRole: null,
  wsRole: null,
  ...over,
});

describe("canInviteMembers — mirrors workspace.go:136", () => {
  it("allows workspace owners and admins", () => {
    expect(canInviteMembers(ctx({ wsRole: "owner" })).allowed).toBe(true);
    expect(canInviteMembers(ctx({ wsRole: "admin" })).allowed).toBe(true);
  });
  it("denies a plain member with not_admin_role", () => {
    expect(canInviteMembers(ctx({ wsRole: "member" })).reason).toBe("not_admin_role");
  });
  it("denies a non-member and a logged-out user with distinct reasons", () => {
    expect(canInviteMembers(ctx({ wsRole: null })).reason).toBe("not_member");
    expect(canInviteMembers(ctx({ userId: null, wsRole: "owner" })).reason).toBe("not_authenticated");
  });
  it("carries copy for the UI on every denial", () => {
    expect(canInviteMembers(ctx({ wsRole: "member" })).message.length).toBeGreaterThan(0);
    expect(canManageMembers(ctx({ wsRole: "member" })).reason).toBe("not_admin_role");
  });
});

describe("canCreateWorkspaceInOrg — mirrors workspace.go:44", () => {
  it("allows any organization member, whatever the role", () => {
    for (const orgRole of ["owner", "admin", "member"] as const) {
      expect(canCreateWorkspaceInOrg(ctx({ orgRole })).allowed).toBe(true);
    }
  });
  it("denies a non-member of the organization with not_org_member", () => {
    expect(canCreateWorkspaceInOrg(ctx({ orgRole: null, wsRole: "owner" })).reason).toBe("not_org_member");
  });
});

describe("task and meeting rules — membership only, as the backend gates today", () => {
  it("lets any workspace member delete or edit a task, creator or not", () => {
    const task = null;
    expect(canDeleteTask(task, ctx({ wsRole: "member" })).allowed).toBe(true);
    expect(canEditTask(task, ctx({ wsRole: "member" })).allowed).toBe(true);
    expect(canDeleteMeeting(ctx({ wsRole: "member" })).allowed).toBe(true);
  });
  it("denies outside the workspace", () => {
    expect(canDeleteTask(null, ctx({ wsRole: null })).reason).toBe("not_member");
    expect(canDeleteMeeting(ctx({ userId: null })).reason).toBe("not_authenticated");
  });
});

import { describe, expect, it } from "vitest";
import { canCreateInsideFolder } from "./rules";
import type { PermissionContext } from "./types";

// UNI-2055 W1/W3: a workspace folder (kind folder, visibility workspace, no
// system_kind) takes new content from every human workspace member, even at
// my_level "view"; everything else keeps the edit rule.

const ctx = (over: Partial<PermissionContext> = {}): PermissionContext => ({
  userId: "u1",
  orgRole: null,
  wsRole: "member",
  orgMemberStatus: null,
  ...over,
});

const workspaceFolder = { kind: "folder", visibility: "workspace", system_kind: null, my_level: "view" } as const;

describe("canCreateInsideFolder (mirror of server lockPageParent for a workspace folder)", () => {
  it.each(["owner", "admin", "member"] as const)("lets a workspace %s create inside a workspace folder at view level", (wsRole) => {
    expect(canCreateInsideFolder(workspaceFolder, ctx({ wsRole }))).toMatchObject({ allowed: true, reason: "allowed" });
  });

  it("does not need my_level at all on a workspace folder (a tree node carries none)", () => {
    expect(canCreateInsideFolder({ kind: "folder", visibility: "workspace" }, ctx()).allowed).toBe(true);
  });

  it("keeps a viewer, a guest or an unknown role read-only", () => {
    for (const wsRole of [null, "viewer", "guest"] as unknown as PermissionContext["wsRole"][]) {
      expect(canCreateInsideFolder(workspaceFolder, ctx({ wsRole })).allowed).toBe(false);
    }
  });

  it("keeps an agent (no user id, no workspace role) read-only", () => {
    expect(canCreateInsideFolder(workspaceFolder, ctx({ userId: null, wsRole: null })).allowed).toBe(false);
    expect(canCreateInsideFolder(workspaceFolder, ctx({ userId: null })).reason).toBe("not_authenticated");
  });

  it("refuses a deactivated organization member before any role", () => {
    expect(canCreateInsideFolder(workspaceFolder, ctx({ orgMemberStatus: "deactivated" }))).toMatchObject({
      allowed: false,
      reason: "member_deactivated",
    });
  });

  it("does not open My Folder or its sub-folders (restricted) to a member at view level", () => {
    const myFolder = { kind: "folder", visibility: "restricted", system_kind: "my_folder", my_level: "view" };
    const sub = { kind: "folder", visibility: "restricted", system_kind: null, my_level: "view" };
    expect(canCreateInsideFolder(myFolder, ctx()).allowed).toBe(false);
    expect(canCreateInsideFolder(sub, ctx()).allowed).toBe(false);
  });

  it("does not treat a workspace-visible My Folder row as a workspace folder", () => {
    expect(
      canCreateInsideFolder({ kind: "folder", visibility: "workspace", system_kind: "my_folder", my_level: "view" }, ctx()).allowed,
    ).toBe(false);
  });

  it("falls back to the edit rule on a restricted legacy folder", () => {
    const legacy = (my_level: string) => ({ kind: "folder", visibility: "restricted", system_kind: null, my_level });
    expect(canCreateInsideFolder(legacy("view"), ctx()).allowed).toBe(false);
    expect(canCreateInsideFolder(legacy("comment"), ctx()).allowed).toBe(false);
    expect(canCreateInsideFolder(legacy("edit"), ctx()).allowed).toBe(true);
    expect(canCreateInsideFolder(legacy("manage"), ctx({ wsRole: null })).allowed).toBe(true);
  });

  it("does not open a workspace-visible page to a member at view level", () => {
    expect(canCreateInsideFolder({ kind: "page", visibility: "workspace", my_level: "view" }, ctx()).allowed).toBe(false);
  });

  it("needs a folder", () => {
    expect(canCreateInsideFolder(null, ctx()).allowed).toBe(false);
  });
});

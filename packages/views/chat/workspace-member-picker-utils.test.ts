import { describe, expect, it } from "vitest";
import {
  filterWorkspaceMembers,
  findWorkspaceMemberByEmail,
  memberToChatContact,
  shouldLookupEmailOutsideWorkspace,
} from "./workspace-member-picker-utils";

const members = [
  {
    workspace_id: "ws1",
    user_id: "u1",
    role: "member" as const,
    email: "long@example.com",
    display_name: "Tran Hoang Long",
  },
  {
    workspace_id: "ws1",
    user_id: "u2",
    role: "member" as const,
    email: "alice@example.com",
    display_name: "Alice",
  },
];

describe("workspace-member-picker-utils", () => {
  it("maps workspace member to chat contact", () => {
    expect(memberToChatContact(members[0]!)).toEqual({
      user_id: "u1",
      email: "long@example.com",
      display_name: "Tran Hoang Long",
    });
  });

  it("filters members by name or email", () => {
    const filtered = filterWorkspaceMembers(members, {
      currentUserId: "self",
      query: "long",
    });
    expect(filtered.map((m) => m.user_id)).toEqual(["u1"]);
  });

  it("finds member by exact email", () => {
    expect(findWorkspaceMemberByEmail(members, "alice@example.com")?.user_id).toBe("u2");
  });

  it("skips email lookup when member is in workspace", () => {
    expect(
      shouldLookupEmailOutsideWorkspace("long@example.com", members, true),
    ).toBe(false);
  });

  it("runs email lookup when email is not in workspace", () => {
    expect(
      shouldLookupEmailOutsideWorkspace("other@example.com", members, true),
    ).toBe(true);
  });
});

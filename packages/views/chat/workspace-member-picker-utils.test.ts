import { describe, expect, it } from "vitest";
import {
  filterWorkspaceMembers,
  findWorkspaceMemberByEmail,
  memberPickerEmptyReason,
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

  it("name-only search never matches the email text, nor the local part of an unnamed member", () => {
    const unnamed = { workspace_id: "ws1", user_id: "u3", role: "member" as const, email: "nguyen.an@example.com", display_name: "" };
    const all = [...members, unnamed];
    const ids = (query: string, nameOnly: boolean) =>
      filterWorkspaceMembers(all, { currentUserId: "self", query, nameOnly }).map((m) => m.user_id);
    expect(ids("alice@example.com", true)).toEqual([]);
    expect(ids("nguyen", true)).toEqual([]);
    expect(ids("alice", true)).toEqual(["u2"]);
    // Chat callers still find people by email and by the local part.
    expect(ids("alice@example.com", false)).toEqual(["u2"]);
    expect(ids("nguyen", false)).toEqual(["u3"]);
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

describe("memberPickerEmptyReason", () => {
  it("only blames the query when one was typed", () => {
    expect(memberPickerEmptyReason({ query: " lan ", hasOtherMembers: true })).toBe("no_match");
    expect(memberPickerEmptyReason({ query: "", hasOtherMembers: false })).toBe("no_other_members");
    expect(memberPickerEmptyReason({ query: "  ", hasOtherMembers: true })).toBe("all_picked");
  });
});

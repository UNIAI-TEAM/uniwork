import { describe, expect, it } from "vitest";
import type { ChatRoomMemberRecord } from "@uniwork/core/api/endpoints/chat";
import {
  canDemoteChatMember,
  canMuteChatMember,
  canPromoteChatMember,
  canUnmuteChatMember,
  isChatRoomModerator,
} from "./chat-room-moderation-utils";

const member = (over: Partial<ChatRoomMemberRecord> = {}): ChatRoomMemberRecord => ({
  user_id: "u2",
  role: "member",
  send_restricted: false,
  email: "u2@example.com",
  display_name: "User Two",
  ...over,
});

describe("chat-room-moderation-utils", () => {
  it("detects moderators via room admin or workspace role", () => {
    expect(isChatRoomModerator("u1", [member({ user_id: "u1", role: "admin" })], "member")).toBe(
      true,
    );
    expect(isChatRoomModerator("u1", [member({ user_id: "u1", role: "member" })], "owner")).toBe(
      true,
    );
    expect(isChatRoomModerator("u1", [member({ user_id: "u1", role: "member" })], "admin")).toBe(
      true,
    );
    expect(isChatRoomModerator("u1", [member({ user_id: "u1", role: "member" })], "member")).toBe(
      false,
    );
  });

  it("gates promote, demote, mute, and unmute", () => {
    const targetMember = member();
    const targetAdmin = member({ role: "admin", user_id: "u3" });
    expect(canPromoteChatMember(targetMember, true)).toBe(true);
    expect(canPromoteChatMember(targetAdmin, true)).toBe(false);
    expect(canPromoteChatMember(targetMember, false)).toBe(false);

    expect(canDemoteChatMember(targetAdmin, "u1", true)).toBe(true);
    expect(canDemoteChatMember(targetAdmin, "u3", true)).toBe(false);
    expect(canDemoteChatMember(targetMember, "u1", true)).toBe(false);

    expect(canMuteChatMember(targetMember, true)).toBe(true);
    expect(canMuteChatMember(member({ send_restricted: true }), true)).toBe(false);
    expect(canUnmuteChatMember(member({ send_restricted: true }), true)).toBe(true);
    expect(canUnmuteChatMember(targetMember, true)).toBe(false);
  });
});

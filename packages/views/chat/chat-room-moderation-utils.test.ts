import { describe, expect, it } from "vitest";
import type { ChatRoomMemberRecord } from "@uniwork/core/api/endpoints/chat";
import {
  bypassesRoomPermissions,
  canAdminChannel,
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
  is_creator: false,
  ...over,
});

const group = { kind: "group" as const };
const channel = { kind: "channel" as const, is_default: false };
const defaultChannel = { kind: "channel" as const, is_default: true };

describe("chat-room-moderation-utils", () => {
  it("detects moderators the way canModerateChatRoom does", () => {
    const plain = [member({ user_id: "u1" })];
    expect(isChatRoomModerator("u1", [member({ user_id: "u1", role: "admin" })], "member", group)).toBe(true);
    // A workspace owner/admin moderates only the default channel.
    expect(isChatRoomModerator("u1", plain, "admin", group)).toBe(false);
    expect(isChatRoomModerator("u1", plain, "owner", channel)).toBe(false);
    expect(isChatRoomModerator("u1", plain, "admin", defaultChannel)).toBe(true);
    expect(isChatRoomModerator("u1", plain, "owner", { kind: "workspace" })).toBe(true);
    // The creator of a group or a channel moderates it even without the admin role.
    expect(isChatRoomModerator("u1", [member({ user_id: "u1", is_creator: true })], "member", group)).toBe(true);
    expect(isChatRoomModerator("u1", [member({ user_id: "u1", is_creator: true })], "member", channel)).toBe(true);
    expect(isChatRoomModerator("u1", plain, "member", group)).toBe(false);
    // Until the room is known nobody but a room admin is shown moderation.
    expect(isChatRoomModerator("u1", plain, "admin", undefined)).toBe(false);
  });

  it("lets only room admins and a group's creator bypass permission flags", () => {
    expect(bypassesRoomPermissions("u1", [member({ user_id: "u1", role: "admin" })], channel)).toBe(true);
    expect(bypassesRoomPermissions("u1", [member({ user_id: "u1", is_creator: true })], group)).toBe(true);
    expect(bypassesRoomPermissions("u1", [member({ user_id: "u1", is_creator: true })], channel)).toBe(false);
    expect(bypassesRoomPermissions("u1", [member({ user_id: "u1" })], defaultChannel)).toBe(false);
  });

  it("lets the creator, a room admin or a workspace owner/admin edit a channel", () => {
    expect(canAdminChannel("u1", [member({ user_id: "u1" })], "admin")).toBe(true);
    expect(canAdminChannel("u1", [member({ user_id: "u1" })], "owner")).toBe(true);
    expect(canAdminChannel("u1", [member({ user_id: "u1", is_creator: true })], "member")).toBe(true);
    expect(canAdminChannel("u1", [member({ user_id: "u1", role: "admin" })], "member")).toBe(true);
    expect(canAdminChannel("u1", [member({ user_id: "u1" })], "member")).toBe(false);
  });

  it("demotes admins the way canDemoteChatAdmin does", () => {
    const creator = member({ user_id: "u1", role: "admin", is_creator: true });
    const deputy = member({ user_id: "u3", role: "admin" });
    const groupMembers = [creator, deputy];
    // In a group only the creator demotes, and nobody demotes the creator.
    expect(canDemoteChatMember(deputy, "u1", groupMembers, "member", group)).toBe(true);
    expect(canDemoteChatMember(creator, "u3", groupMembers, "admin", group)).toBe(false);
    expect(canDemoteChatMember(deputy, "u3", groupMembers, "member", group)).toBe(false);
    // Elsewhere only a workspace owner/admin who moderates the room demotes.
    const channelMembers = [member({ user_id: "u1", role: "admin" }), deputy];
    expect(canDemoteChatMember(deputy, "u1", channelMembers, "member", channel)).toBe(false);
    expect(canDemoteChatMember(deputy, "u1", channelMembers, "admin", channel)).toBe(true);
    expect(canDemoteChatMember(member({ user_id: "u3" }), "u1", channelMembers, "admin", channel)).toBe(false);
  });

  it("gates promote, mute, and unmute", () => {
    const targetMember = member();
    const targetAdmin = member({ role: "admin", user_id: "u3" });
    expect(canPromoteChatMember(targetMember, true)).toBe(true);
    expect(canPromoteChatMember(targetAdmin, true)).toBe(false);
    expect(canPromoteChatMember(targetMember, false)).toBe(false);

    expect(canMuteChatMember(targetMember, true)).toBe(true);
    expect(canMuteChatMember(member({ send_restricted: true }), true)).toBe(false);
    expect(canUnmuteChatMember(member({ send_restricted: true }), true)).toBe(true);
    expect(canUnmuteChatMember(targetMember, true)).toBe(false);
  });
});

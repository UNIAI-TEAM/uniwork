import { describe, expect, it } from "vitest";
import {
  canUseRoomPermission,
  DEFAULT_CHAT_ROOM_MEMBER_PERMISSIONS,
  isRoomSendBlocked,
  mergeRoomMemberPermissions,
} from "./room-permissions-utils";

describe("room-permissions-utils", () => {
  it("merges partial permissions with defaults", () => {
    expect(
      mergeRoomMemberPermissions({ allow_send_messages: false }).allow_send_messages,
    ).toBe(false);
    expect(
      mergeRoomMemberPermissions({ allow_send_messages: false }).allow_pin_content,
    ).toBe(true);
  });

  it("lets moderators bypass member restrictions", () => {
    const perms = { ...DEFAULT_CHAT_ROOM_MEMBER_PERMISSIONS, allow_send_messages: false };
    expect(canUseRoomPermission(perms, true, "allow_send_messages")).toBe(true);
    expect(canUseRoomPermission(perms, false, "allow_send_messages")).toBe(false);
  });

  it("blocks send when restricted or permission disabled", () => {
    const perms = { ...DEFAULT_CHAT_ROOM_MEMBER_PERMISSIONS, allow_send_messages: false };
    expect(isRoomSendBlocked(perms, false, false)).toBe(true);
    expect(isRoomSendBlocked(perms, false, true)).toBe(true);
    expect(isRoomSendBlocked(perms, true, false)).toBe(false);
  });
});

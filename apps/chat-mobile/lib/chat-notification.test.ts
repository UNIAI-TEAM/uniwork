import { CHAT_MESSAGE_BODY_MAX_LENGTH } from "@uniwork/core/chat/client-msg-id";
import { describe, expect, it } from "vitest";
import { chatNotificationAction, chatPushTarget } from "./chat-notification";

const data = { url: "https://app/o/w/chat?room=r&message=m", tag: "chat_room:r:dm", workspace_id: "w", room_id: "r", message_id: "m" };
const response = (actionIdentifier: string, extra: Record<string, unknown> = {}, content: unknown = data) => ({
  actionIdentifier,
  notification: { request: { identifier: "n1", content: { data: content } } },
  ...extra,
});

describe("chatPushTarget", () => {
  it("reads the room a chat push is about, and its thread", () => {
    expect(chatPushTarget(data)).toEqual({ workspaceId: "w", roomId: "r", messageId: "m" });
    expect(chatPushTarget({ ...data, thread_root_id: "t" })).toEqual({ workspaceId: "w", roomId: "r", messageId: "m", threadRootId: "t" });
    expect(chatPushTarget({ dataString: JSON.stringify(data) })).toEqual({ workspaceId: "w", roomId: "r", messageId: "m" });
  });

  it("is none for a call, a push of an older server, a broken payload or none", () => {
    expect(chatPushTarget({ ...data, call_id: "c" })).toBeNull();
    expect(chatPushTarget({ url: data.url, tag: data.tag })).toBeNull();
    expect(chatPushTarget({ dataString: "{not json" })).toBeNull();
    expect(chatPushTarget({ dataString: "[1]" })).toBeNull();
    expect(chatPushTarget(null)).toBeNull();
    expect(chatPushTarget(["x"])).toBeNull();
  });
});

describe("chatNotificationAction", () => {
  it("reads a reply, trimmed and capped at a message's length, keyed to its notification", () => {
    expect(chatNotificationAction(response("reply", { userText: "  ok, 9h nhé  " }))).toEqual({
      action: "reply",
      key: "n1:reply",
      notificationId: "n1",
      target: { workspaceId: "w", roomId: "r", messageId: "m" },
      text: "ok, 9h nhé",
      // The notification as shown, so a reply the app lock refuses can put it back (data/chat-notification-actions.ts).
      shown: { title: "", data },
    });
    const long = chatNotificationAction(response("reply", { userText: "x".repeat(CHAT_MESSAGE_BODY_MAX_LENGTH + 10) }));
    expect(long?.action === "reply" && long.text.length).toBe(CHAT_MESSAGE_BODY_MAX_LENGTH);
  });

  it("reads a mark as read, keyed to the message when the notification has no id", () => {
    expect(chatNotificationAction({ actionIdentifier: "mark_read", notification: { request: { content: { data } } } })).toEqual({
      action: "mark_read",
      key: "m:mark_read",
      notificationId: "",
      target: { workspaceId: "w", roomId: "r", messageId: "m" },
    });
  });

  it("reads the shape Android's background task receives: the push's data as `dataString` JSON on the content, no `data`", () => {
    // expo-notifications' NotificationSerializer.toBundle(NotificationRequest) for a push of Expo's service.
    const native = (actionIdentifier: string, extra: Record<string, unknown> = {}) => ({
      actionIdentifier,
      notification: { request: { identifier: "n1", content: { title: "Minh", body: "hi", dataString: JSON.stringify(data) } } },
      ...extra,
    });
    expect(chatNotificationAction(native("reply", { userText: "ok" }))).toEqual({
      action: "reply",
      key: "n1:reply",
      notificationId: "n1",
      target: { workspaceId: "w", roomId: "r", messageId: "m" },
      text: "ok",
      shown: { title: "Minh", data },
    });
    expect(chatNotificationAction(native("mark_read"))).toEqual(chatNotificationAction(response("mark_read")));
    // One response heard by both the listener (data parsed) and the task (dataString) carries one key.
    expect(chatNotificationAction(native("reply", { userText: "ok" }))?.key).toBe(chatNotificationAction(response("reply", { userText: "ok" }))?.key);
    const broken = { actionIdentifier: "mark_read", notification: { request: { identifier: "n1", content: { dataString: "{not json" } } } };
    expect(chatNotificationAction(broken)).toBeNull();
    expect(chatNotificationAction({ actionIdentifier: "mark_read", notification: { request: { identifier: "n1", content: { title: "Minh" } } } })).toBeNull();
  });

  it("is none for a plain tap, an empty reply, a push that is not a chat message, or no response", () => {
    expect(chatNotificationAction(response("expo.modules.notifications.actions.DEFAULT"))).toBeNull();
    expect(chatNotificationAction(response("reply", { userText: "   " }))).toBeNull();
    expect(chatNotificationAction(response("reply"))).toBeNull();
    expect(chatNotificationAction(response("mark_read", {}, { url: "x" }))).toBeNull();
    expect(chatNotificationAction(null)).toBeNull();
  });
});

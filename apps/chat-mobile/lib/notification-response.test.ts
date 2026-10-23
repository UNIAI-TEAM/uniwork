import { describe, expect, it, vi } from "vitest";
import { MARK_READ_ACTION } from "./chat-notification";
import { DEFAULT_NOTIFICATION_ACTION, createNotificationResponseHandler, handleLaunchResponse } from "./notification-response";

function response(id: string, data: Record<string, unknown>, actionIdentifier = DEFAULT_NOTIFICATION_ACTION) {
  return { actionIdentifier, notification: { request: { identifier: id, content: { data } } } };
}

const CHAT = { url: "https://app.test/o/w/chat?room=r1&message=m1", workspace_id: "w", room_id: "r1", message_id: "m1" };

function setup() {
  const deps = { openUrl: vi.fn(), runChatAction: vi.fn(), trackPushOpen: vi.fn(), clearLast: vi.fn() };
  return { deps, handle: createNotificationResponseHandler(deps) };
}

describe("notification responses", () => {
  it("opens a tapped push's link once, counts the open and forgets it as the launch response", () => {
    const { deps, handle } = setup();
    handle(response("n1", CHAT));
    expect(deps.openUrl).toHaveBeenCalledWith(CHAT.url);
    expect(deps.trackPushOpen).toHaveBeenCalledWith(CHAT);
    expect(deps.clearLast).toHaveBeenCalledTimes(1);
    // The listener and the launch read can both hand over the same tap.
    handle(response("n1", CHAT));
    expect(deps.openUrl).toHaveBeenCalledTimes(1);
    handle(response("n2", CHAT));
    expect(deps.openUrl).toHaveBeenCalledTimes(2);
  });

  it("runs Reply or Mark as read where it was tapped and opens nothing", () => {
    const { deps, handle } = setup();
    handle(response("n1", CHAT, MARK_READ_ACTION));
    expect(deps.runChatAction).toHaveBeenCalledWith(expect.objectContaining({ action: MARK_READ_ACTION, notificationId: "n1" }));
    expect(deps.openUrl).not.toHaveBeenCalled();
    expect(deps.trackPushOpen).not.toHaveBeenCalled();
  });

  it("counts a push with no link and opens nothing", () => {
    const { deps, handle } = setup();
    handle(response("n1", { type: "general" }));
    handle({ actionIdentifier: DEFAULT_NOTIFICATION_ACTION, notification: { request: { identifier: "n2", content: {} } } });
    expect(deps.trackPushOpen).toHaveBeenCalledTimes(2);
    expect(deps.openUrl).not.toHaveBeenCalled();
  });
});

describe("the launch response", () => {
  it("routes the tap that started the app, before any listener could hear it", () => {
    const { deps, handle } = setup();
    expect(handleLaunchResponse(handle, response("n1", CHAT), "android")).toBe(true);
    expect(deps.openUrl).toHaveBeenCalledWith(CHAT.url);
    expect(handleLaunchResponse(handle, null, "android")).toBe(false);
  });

  it("leaves an Android action to the background task that already ran it, but runs an iOS one that opened the app", () => {
    const { deps, handle } = setup();
    expect(handleLaunchResponse(handle, response("n1", CHAT, MARK_READ_ACTION), "android")).toBe(false);
    expect(deps.runChatAction).not.toHaveBeenCalled();
    expect(handleLaunchResponse(handle, response("n1", CHAT, MARK_READ_ACTION), "ios")).toBe(true);
    expect(deps.runChatAction).toHaveBeenCalledTimes(1);
  });
});

// Reply and Mark as read from a chat notification (chat-notification-actions.ts),
// with every native and network edge stood in for: the category in the app's
// language (opening the app on iOS, not on Android), one run per action, a
// reply through the outbox that also reads the room, nothing for a phone
// signed out, and a headless runtime that boots, opens the store and reads
// the queues before it sends.
import { beforeEach, describe, expect, it, vi } from "vitest";

const notifications = vi.hoisted(() => ({
  setNotificationCategoryAsync: vi.fn(async () => null),
  dismissNotificationAsync: vi.fn(async () => undefined),
}));
vi.mock("expo-notifications", () => notifications);

const deps = vi.hoisted(() => ({
  bootRuntime: vi.fn(),
  session: { status: vi.fn(() => "signed-in"), restore: vi.fn(async () => true) },
  readLastUser: vi.fn(async () => ({ id: "me" }) as { id: string } | null),
  sendChatMessage: vi.fn(async () => undefined),
  markRoomRead: vi.fn(async () => undefined),
  installed: true,
  installDeviceStore: vi.fn(),
  hydrated: true,
  hydrateChatSendStore: vi.fn(async () => undefined),
  hydratePendingOpsStore: vi.fn(async () => undefined),
}));
vi.mock("./boot", () => ({ bootRuntime: deps.bootRuntime }));
vi.mock("./auth/flow", () => ({ session: deps.session }));
vi.mock("./auth/last-user", () => ({ readLastUser: deps.readLastUser }));
vi.mock("./chat-send", () => ({ chatSendDeps: { tag: "send-deps" }, sendChatMessage: deps.sendChatMessage }));
vi.mock("./pending-ops", () => ({ markRoomRead: deps.markRoomRead }));
vi.mock("./query-client", () => ({ queryClient: { tag: "qc" } }));
vi.mock("./storage/device-store", () => ({ deviceStoreInstalled: () => deps.installed, installDeviceStore: deps.installDeviceStore }));
vi.mock("./storage/native-device-store", () => ({ openNativeDeviceStore: "native-opener" }));
vi.mock("./stores/chat-send-store", () => ({ hydrateChatSendStore: deps.hydrateChatSendStore, useChatSendStore: { persist: { hasHydrated: () => deps.hydrated } } }));
vi.mock("./stores/pending-ops-store", () => ({ hydratePendingOpsStore: deps.hydratePendingOpsStore, usePendingOpsStore: { persist: { hasHydrated: () => deps.hydrated } } }));

import { chatNotificationAction, type ChatNotificationAction } from "@/lib/chat-notification";
import {
  appChatActionEnv,
  chatMessageCategoryActions,
  handleChatNotificationAction,
  registerChatMessageCategory,
  runChatNotificationAction,
  type ChatActionEnv,
} from "./chat-notification-actions";

const t = (key: string) => `[${key}]`;
let seq = 0;
const reply = (extra: Partial<Extract<ChatNotificationAction, { action: "reply" }>> = {}): ChatNotificationAction => ({
  action: "reply",
  key: `n${++seq}:reply`,
  notificationId: `n${seq}`,
  target: { workspaceId: "w", roomId: "r", messageId: "m" },
  text: "ok",
  ...extra,
});
const markRead = (): ChatNotificationAction => ({ action: "mark_read", key: `n${++seq}:mark_read`, notificationId: "", target: { workspaceId: "w", roomId: "r", messageId: "m" } });

function fakeEnv(userId: string | null = "me"): ChatActionEnv & { [K in keyof ChatActionEnv]: ReturnType<typeof vi.fn> } {
  return {
    signedInUser: vi.fn(async () => userId),
    send: vi.fn(async () => undefined),
    markRead: vi.fn(async () => undefined),
    dismiss: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  deps.installed = true;
  deps.hydrated = true;
  deps.session.status.mockReturnValue("signed-in");
  deps.readLastUser.mockResolvedValue({ id: "me" });
});

describe("the chat message category", () => {
  it("offers Reply with a text field and Mark as read, in the app's language; the app opens for them on iOS only", async () => {
    const android = chatMessageCategoryActions(t, "android");
    expect(android).toEqual([
      {
        identifier: "reply",
        buttonTitle: "[mobile.notification_actions.reply]",
        textInput: { submitButtonTitle: "[mobile.notification_actions.send]", placeholder: "[mobile.notification_actions.reply_placeholder]" },
        options: { opensAppToForeground: false },
      },
      { identifier: "mark_read", buttonTitle: "[mobile.notification_actions.mark_read]", options: { opensAppToForeground: false } },
    ]);
    expect(chatMessageCategoryActions(t, "ios").every((action) => action.options?.opensAppToForeground)).toBe(true);
    await registerChatMessageCategory(t, "android");
    expect(notifications.setNotificationCategoryAsync).toHaveBeenCalledWith("chat_message", android);
  });

  it("survives a platform that refuses the category", async () => {
    notifications.setNotificationCategoryAsync.mockRejectedValueOnce(new Error("no"));
    await expect(registerChatMessageCategory(t, "ios")).resolves.toBeUndefined();
    notifications.setNotificationCategoryAsync.mockRejectedValueOnce("odd");
    await expect(registerChatMessageCategory(t, "ios")).resolves.toBeUndefined();
  });
});

describe("handleChatNotificationAction", () => {
  it("sends a reply through the outbox, reads the room and takes the notification down, once", async () => {
    const env = fakeEnv();
    const action = reply({ target: { workspaceId: "w", roomId: "r", messageId: "m", threadRootId: "t" } });
    expect(await handleChatNotificationAction(action, env)).toBe("replied");
    expect(env.send).toHaveBeenCalledWith({ workspaceId: "w", roomId: "r", senderId: "me", body: "ok", threadRootId: "t" });
    expect(env.markRead).toHaveBeenCalledWith("w", "r", "me");
    expect(env.dismiss).toHaveBeenCalledWith(action.notificationId);
    expect(await handleChatNotificationAction(action, env)).toBe("duplicate");
    expect(env.send).toHaveBeenCalledTimes(1);
  });

  it("reads the room for Mark as read, sending nothing", async () => {
    const env = fakeEnv();
    expect(await handleChatNotificationAction(markRead(), env)).toBe("read");
    expect(env.send).not.toHaveBeenCalled();
    expect(env.markRead).toHaveBeenCalledWith("w", "r", "me");
    expect(env.dismiss).not.toHaveBeenCalled();
    const room = fakeEnv();
    await handleChatNotificationAction(reply(), room);
    expect(room.send).toHaveBeenCalledWith({ workspaceId: "w", roomId: "r", senderId: "me", body: "ok" });
  });

  it("sends once a reply that both the listener and Android's task hear (an app alive in the background)", async () => {
    const data = { workspace_id: "w", room_id: "r", message_id: "m" };
    const response = (content: Record<string, unknown>) => ({ actionIdentifier: "reply", userText: "ok", notification: { request: { identifier: "both-1", content } } });
    const listener = chatNotificationAction(response({ data }));
    const task = chatNotificationAction(response({ dataString: JSON.stringify(data) }));
    if (!listener || !task) throw new Error("both paths must read the reply");
    const env = fakeEnv();
    const outcomes = await Promise.all([handleChatNotificationAction(task, env), handleChatNotificationAction(listener, env)]);
    expect(outcomes.sort()).toEqual(["duplicate", "replied"]);
    expect(env.send).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a phone nobody is signed in on", async () => {
    const env = fakeEnv(null);
    expect(await handleChatNotificationAction(reply(), env)).toBe("signed-out");
    expect(env.send).not.toHaveBeenCalled();
  });
});

describe("runChatNotificationAction and the app's env", () => {
  it("runs in a booted app with what it has", async () => {
    await runChatNotificationAction(reply());
    expect(deps.bootRuntime).toHaveBeenCalled();
    expect(deps.installDeviceStore).not.toHaveBeenCalled();
    expect(deps.session.restore).not.toHaveBeenCalled();
    expect(deps.hydrateChatSendStore).not.toHaveBeenCalled();
    expect(deps.sendChatMessage).toHaveBeenCalledWith({ tag: "qc" }, expect.objectContaining({ senderId: "me", body: "ok" }), { tag: "send-deps" });
    expect(deps.markRoomRead).toHaveBeenCalledWith({ tag: "qc" }, "w", "r", "me");
    expect(notifications.dismissNotificationAsync).toHaveBeenCalled();
  });

  it("boots a headless runtime: the encrypted store, the session and the queues before sending", async () => {
    deps.installed = false;
    deps.hydrated = false;
    deps.session.status.mockReturnValue("signed-out");
    await runChatNotificationAction(reply());
    expect(deps.installDeviceStore).toHaveBeenCalledWith("native-opener");
    expect(deps.session.restore).toHaveBeenCalled();
    expect(deps.hydrateChatSendStore).toHaveBeenCalled();
    expect(deps.hydratePendingOpsStore).toHaveBeenCalled();
    expect(deps.sendChatMessage).toHaveBeenCalled();
  });

  it("sends nothing when the session cannot come back or nobody is stored", async () => {
    deps.session.status.mockReturnValue("signed-out");
    deps.session.restore.mockResolvedValueOnce(false);
    expect(await appChatActionEnv.signedInUser()).toBeNull();
    deps.session.status.mockReturnValue("signed-in");
    deps.readLastUser.mockResolvedValueOnce(null);
    expect(await appChatActionEnv.signedInUser()).toBeNull();
  });

  it("never throws into a listener or a task, and a notification that will not come down is only untidy", async () => {
    deps.sendChatMessage.mockRejectedValueOnce(new Error("disk"));
    await expect(runChatNotificationAction(reply())).resolves.toBeUndefined();
    deps.sendChatMessage.mockRejectedValueOnce("odd");
    await expect(runChatNotificationAction(reply())).resolves.toBeUndefined();
    notifications.dismissNotificationAsync.mockRejectedValueOnce(new Error("gone"));
    await expect(appChatActionEnv.dismiss("n")).resolves.toBeUndefined();
  });
});

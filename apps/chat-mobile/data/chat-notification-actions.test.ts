// Reply and Mark as read from a chat notification (chat-notification-actions.ts),
// with every native and network edge stood in for: the category in the app's
// language (opening the app on iOS, not on Android), one run per action, a
// reply through the outbox that also reads the room, nothing for a phone
// signed out, and a headless runtime that boots, opens the store and reads
// the queues before it sends. While the app lock is on (the person's or the
// organization's), there is no Reply, and a reply typed in a notification
// shown before the lock is refused: on Android the notification is put back
// in place, quietly, saying the reply was not sent.
import { beforeEach, describe, expect, it, vi } from "vitest";

const notifications = vi.hoisted(() => ({
  setNotificationCategoryAsync: vi.fn(async () => null),
  dismissNotificationAsync: vi.fn(async () => undefined),
  scheduleNotificationAsync: vi.fn(async () => "id"),
}));
vi.mock("expo-notifications", () => notifications);
const platform = vi.hoisted(() => ({ OS: "android" }));

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
  readPrivacy: vi.fn(async (): Promise<string | null> => null),
}));
vi.mock("./device-preferences", () => ({ readDevicePreference: (name: string) => (name === "privacy" ? deps.readPrivacy() : Promise.resolve(null)) }));
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
const offScreen = vi.hoisted(() => ({ appState: "background", keepSendingOffScreen: vi.fn(async () => undefined) }));
vi.mock("react-native", () => ({ Platform: platform, AppState: { get currentState() { return offScreen.appState; } } }));
vi.mock("./outbox-drain/background-send", () => ({ keepSendingOffScreen: offScreen.keepSendingOffScreen }));

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
type ReplyAction = Extract<ChatNotificationAction, { action: "reply" }>;
const reply = (extra: Partial<ReplyAction> = {}): ReplyAction => ({
  action: "reply",
  key: `n${++seq}:reply`,
  notificationId: `n${seq}`,
  target: { workspaceId: "w", roomId: "r", messageId: "m" },
  text: "ok",
  shown: { title: "Minh", data: { url: "https://app/o/w/chat?room=r", workspace_id: "w", room_id: "r", message_id: "m" } },
  ...extra,
});
const markRead = (): ChatNotificationAction => ({ action: "mark_read", key: `n${++seq}:mark_read`, notificationId: "", target: { workspaceId: "w", roomId: "r", messageId: "m" } });

function fakeEnv(userId: string | null = "me", locked = false): ChatActionEnv & { [K in keyof ChatActionEnv]: ReturnType<typeof vi.fn> } {
  return {
    appLocked: vi.fn(async () => locked),
    signedInUser: vi.fn(async () => userId),
    send: vi.fn(async () => undefined),
    markRead: vi.fn(async () => undefined),
    dismiss: vi.fn(async () => undefined),
    offScreen: vi.fn((_userId: string) => undefined),
    refused: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  deps.installed = true;
  deps.hydrated = true;
  deps.session.status.mockReturnValue("signed-in");
  deps.readLastUser.mockResolvedValue({ id: "me" });
  offScreen.appState = "background";
  deps.readPrivacy.mockResolvedValue(null);
  platform.OS = "android";
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

  it("while the app lock is on, offers only Mark as read: no reply can be written from the lock screen", async () => {
    const android = chatMessageCategoryActions(t, "android", true);
    expect(android).toEqual([{ identifier: "mark_read", buttonTitle: "[mobile.notification_actions.mark_read]", options: { opensAppToForeground: false } }]);
    // iOS opens the app for it already, and asks for the phone to be unlocked first.
    expect(chatMessageCategoryActions(t, "ios", true)).toEqual([
      { identifier: "mark_read", buttonTitle: "[mobile.notification_actions.mark_read]", options: { opensAppToForeground: true, isAuthenticationRequired: true } },
    ]);
    expect(chatMessageCategoryActions(t, "ios").some((action) => action.options?.isAuthenticationRequired)).toBe(false);
    await registerChatMessageCategory(t, "android", true);
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
    // What the reply and the read left owed keeps going with the app off screen (an offline reply waits for the network).
    expect(env.offScreen).toHaveBeenCalledTimes(1);
    expect(env.offScreen).toHaveBeenCalledWith("me");
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

  it("refuses a reply while the app lock is on: nothing sent, nothing read, the notification put back as refused", async () => {
    const env = fakeEnv("me", true);
    const action = reply();
    expect(await handleChatNotificationAction(action, env)).toBe("locked");
    expect(env.signedInUser).not.toHaveBeenCalled();
    expect(env.send).not.toHaveBeenCalled();
    expect(env.markRead).not.toHaveBeenCalled();
    expect(env.dismiss).not.toHaveBeenCalled();
    expect(env.refused).toHaveBeenCalledWith(action);
  });

  it("still reads the room for Mark as read while the app lock is on: it shows and sends nothing", async () => {
    const env = fakeEnv("me", true);
    expect(await handleChatNotificationAction(markRead(), env)).toBe("read");
    expect(env.markRead).toHaveBeenCalledWith("w", "r", "me");
  });

  it("does nothing for a phone nobody is signed in on", async () => {
    const env = fakeEnv(null);
    expect(await handleChatNotificationAction(reply(), env)).toBe("signed-out");
    expect(env.send).not.toHaveBeenCalled();
    expect(env.offScreen).not.toHaveBeenCalled();
  });
});

describe("runChatNotificationAction and the app's env", () => {
  it("runs in a booted app with what it has", async () => {
    expect(await runChatNotificationAction(reply())).toBe("replied");
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

  it("refuses a background reply while the lock saved on the phone is on, the organization's included", async () => {
    deps.installed = false;
    deps.hydrated = false;
    deps.session.status.mockReturnValue("signed-out");
    deps.readPrivacy.mockResolvedValueOnce(JSON.stringify({ appLock: false, floor: { appLock: true, screenSecurity: false } }));
    expect(await runChatNotificationAction(reply())).toBe("locked");
    expect(deps.session.restore).not.toHaveBeenCalled();
    expect(deps.sendChatMessage).not.toHaveBeenCalled();
    expect(deps.markRoomRead).not.toHaveBeenCalled();
    expect(notifications.dismissNotificationAsync).not.toHaveBeenCalled();
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    deps.readPrivacy.mockResolvedValueOnce(JSON.stringify({ appLock: true }));
    expect(await appChatActionEnv.appLocked()).toBe(true);
    deps.readPrivacy.mockRejectedValueOnce(new Error("keychain"));
    expect(await appChatActionEnv.appLocked()).toBe(true);
    expect(await appChatActionEnv.appLocked()).toBe(false);
  });

  it("puts a refused reply's notification back on Android, in place and quiet, saying the reply was not sent", async () => {
    // Android keeps the reply field's spinner until the app posts the notification again (RemoteInput's contract);
    // expo-notifications posts under the request's identifier, so the same id replaces it.
    const action = reply();
    await appChatActionEnv.refused(action);
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: action.notificationId,
      content: {
        title: "Minh",
        body: "Chưa gửi tin trả lời vì UniChat đang khoá. Mở UniChat để trả lời.",
        data: action.shown.data,
        categoryIdentifier: "chat_message",
        sound: false,
      },
      trigger: { channelId: "messages" },
    });
    expect(notifications.dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it("leaves a refused reply's notification to iOS, which opened the app for it, and survives one that will not post", async () => {
    platform.OS = "ios";
    await appChatActionEnv.refused(reply());
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    platform.OS = "android";
    notifications.scheduleNotificationAsync.mockRejectedValueOnce(new Error("gone"));
    await expect(appChatActionEnv.refused(reply())).resolves.toBeUndefined();
    // A notification without an id cannot be replaced: it is taken down only by opening the room.
    await appChatActionEnv.refused(reply({ notificationId: "" }));
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the session cannot come back or nobody is stored", async () => {
    deps.session.status.mockReturnValue("signed-out");
    deps.session.restore.mockResolvedValueOnce(false);
    expect(await appChatActionEnv.signedInUser()).toBeNull();
    deps.session.status.mockReturnValue("signed-in");
    deps.readLastUser.mockResolvedValueOnce(null);
    expect(await appChatActionEnv.signedInUser()).toBeNull();
  });

  it("keeps what is owed going when the action ran with the app off screen, and leaves it to the screens in front", async () => {
    appChatActionEnv.offScreen("me");
    expect(offScreen.keepSendingOffScreen).toHaveBeenCalledWith("me");
    offScreen.appState = "active";
    appChatActionEnv.offScreen("me");
    expect(offScreen.keepSendingOffScreen).toHaveBeenCalledTimes(1);
    offScreen.appState = "background";
    offScreen.keepSendingOffScreen.mockRejectedValueOnce(new Error("no job"));
    expect(() => appChatActionEnv.offScreen("me")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("never throws into a listener or a task, and a notification that will not come down is only untidy", async () => {
    deps.sendChatMessage.mockRejectedValueOnce(new Error("disk"));
    await expect(runChatNotificationAction(reply())).resolves.toBe("failed");
    deps.sendChatMessage.mockRejectedValueOnce("odd");
    await expect(runChatNotificationAction(reply())).resolves.toBe("failed");
    notifications.dismissNotificationAsync.mockRejectedValueOnce(new Error("gone"));
    await expect(appChatActionEnv.dismiss("n")).resolves.toBeUndefined();
  });
});

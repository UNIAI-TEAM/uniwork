// Reply and Mark as read from a chat message notification (the
// push's side is lib/chat-notification.ts and server notification/
// push_expo.go). The category is registered in the app's language at launch
// and on every change of language (app/_layout.tsx). An action runs from the
// running app's notification listener, or on Android from the background
// notification task when UniChat is closed (calls/call-wiring.ts): a reply
// goes through the outbox like any send (data/chat-send.ts — durable, sent
// now or when the network is back, client_msg_id-deduplicated by the
// server) and reads the room, as WhatsApp does; Mark as read queues the read
// (data/pending-ops.ts). Either takes the notification down. An action heard
// twice (the listener and the task of one runtime) runs once. With UniChat off
// screen, what the action left owed (a reply written offline, a read that did
// not reach the server) keeps going as on leaving the app
// (outbox-drain/background-send.ts: Android's job sends it when the network
// comes back).
//
// iOS hands JavaScript no response for an app it did not launch when the
// action stays in the background, so there the actions open the app (no reply
// is ever lost); Android runs them without opening it.
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import { CHAT_MESSAGE_CATEGORY, MARK_READ_ACTION, REPLY_ACTION, type ChatNotificationAction } from "@/lib/chat-notification";
import { session } from "./auth/flow";
import { readLastUser } from "./auth/last-user";
import { bootRuntime } from "./boot";
import { chatSendDeps, sendChatMessage, type ChatSendInput } from "./chat-send";
import { createLogger } from "./logger";
import { keepSendingOffScreen } from "./outbox-drain/background-send";
import { markRoomRead } from "./pending-ops";
import { bestEffort } from "./report";
import { queryClient } from "./query-client";
import { deviceStoreInstalled, installDeviceStore } from "./storage/device-store";
import { openNativeDeviceStore } from "./storage/native-device-store";
import { hydrateChatSendStore, useChatSendStore } from "./stores/chat-send-store";
import { hydratePendingOpsStore, usePendingOpsStore } from "./stores/pending-ops-store";

type Translate = (key: string) => string;

const log = createLogger("push");

/** The category's buttons, in the app's language: Reply with a text field, and Mark as read. */
export function chatMessageCategoryActions(t: Translate, platform: string): Notifications.NotificationAction[] {
  const options = { opensAppToForeground: platform !== "android" };
  return [
    {
      identifier: REPLY_ACTION,
      buttonTitle: t("mobile.notification_actions.reply"),
      textInput: { submitButtonTitle: t("mobile.notification_actions.send"), placeholder: t("mobile.notification_actions.reply_placeholder") },
      options,
    },
    { identifier: MARK_READ_ACTION, buttonTitle: t("mobile.notification_actions.mark_read"), options },
  ];
}

/** At launch and on a change of language; a failure leaves the pushes without buttons until the next launch. */
export async function registerChatMessageCategory(t: Translate, platform: string): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(CHAT_MESSAGE_CATEGORY, chatMessageCategoryActions(t, platform));
  } catch (error) {
    log.warn("chat notification category not registered", { error: error instanceof Error ? error.name : typeof error });
  }
}

export interface ChatActionEnv {
  /** The person signed in on this phone, with the runtime ready to send for them (a headless one booted); null when none. */
  signedInUser: () => Promise<string | null>;
  send: (input: ChatSendInput) => Promise<void>;
  markRead: (workspaceId: string, roomId: string, userId: string) => Promise<void>;
  dismiss: (notificationId: string) => Promise<void>;
  /** After the action: what it left owed keeps going if UniChat is off screen. */
  offScreen: (userId: string) => void;
}

export type ChatActionOutcome = "replied" | "read" | "signed-out" | "duplicate";

const handled = new Set<string>();

export async function handleChatNotificationAction(action: ChatNotificationAction, env: ChatActionEnv): Promise<ChatActionOutcome> {
  if (handled.has(action.key)) return "duplicate";
  handled.add(action.key);
  const userId = await env.signedInUser();
  if (!userId) return "signed-out";
  const { workspaceId, roomId, threadRootId } = action.target;
  if (action.action === REPLY_ACTION) {
    await env.send({ workspaceId, roomId, senderId: userId, body: action.text, ...(threadRootId ? { threadRootId } : {}) });
  }
  // Answering a message reads it, as WhatsApp's reply does.
  await env.markRead(workspaceId, roomId, userId);
  env.offScreen(userId);
  if (action.notificationId) await env.dismiss(action.notificationId);
  return action.action === REPLY_ACTION ? "replied" : "read";
}

/** The app's env: a running app has all of it; a headless task boots, opens the encrypted store and reads the queues. */
export const appChatActionEnv: ChatActionEnv = {
  async signedInUser() {
    bootRuntime();
    if (!deviceStoreInstalled()) installDeviceStore(openNativeDeviceStore);
    if (session.status() === "signed-out" && !(await session.restore())) return null;
    const user = await readLastUser();
    if (!user) return null;
    if (!useChatSendStore.persist.hasHydrated()) await hydrateChatSendStore();
    if (!usePendingOpsStore.persist.hasHydrated()) await hydratePendingOpsStore();
    return user.id;
  },
  send: (input) => sendChatMessage(queryClient, input, chatSendDeps),
  markRead: (workspaceId, roomId, userId) => markRoomRead(queryClient, workspaceId, roomId, userId),
  // The reply is already in the outbox: a notification that will not come down is only untidy.
  dismiss: (notificationId) =>
    Notifications.dismissNotificationAsync(notificationId).catch(bestEffort("push", "notification not dismissed", "breadcrumb")),
  offScreen(userId) {
    if (AppState.currentState === "active") return;
    void keepSendingOffScreen(userId).catch(bestEffort("outbox", "outbox not kept going off screen", "breadcrumb"));
  },
};

/** Runs one action and logs how it went; never throws into a listener or a task. */
export async function runChatNotificationAction(action: ChatNotificationAction, env: ChatActionEnv = appChatActionEnv): Promise<void> {
  try {
    const outcome = await handleChatNotificationAction(action, env);
    log.info("chat notification action", { action: action.action, outcome });
  } catch (error) {
    log.warn("chat notification action failed", { action: action.action, error: error instanceof Error ? error.name : typeof error });
  }
}

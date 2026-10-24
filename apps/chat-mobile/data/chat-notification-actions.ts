// Reply and Mark as read from a chat message notification (the
// push's side is lib/chat-notification.ts and server notification/
// push_expo.go). The category is registered in the app's language at launch
// and on every change of language or of the app lock
// (components/app/chat-category-sync.tsx). An action runs from the
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
//
// The app lock (the person's or the organization's, lib/app-lock.ts) must not
// be answerable from the phone's lock screen: while it is on, the category
// has no Reply — a tap on the notification opens its room behind the lock,
// and the reply is written there once unlocked — and the category is
// registered again when the lock or the organization's floor changes. Reply
// is left out rather than made to open the app: on Android a button that
// opens a killed app also starts the background task beside it, the race
// expo guards only for a plain tap (ExpoHandlingDelegate.
// handleNotificationResponse), and the tap already opens the room. A reply
// typed into a notification shown before the lock was on (Android draws a
// notification's buttons when it posts it) is refused here, whatever runtime
// hears it: nothing is sent or read, and on Android the notification is
// posted again in place, quietly, saying the reply was not sent (Android keeps
// the reply field's spinner until the app posts it again, and the person
// would take the spinner for a send). Mark as read stays: it shows nothing,
// opens nothing and sends no words, only moves the read marker; on iOS it also
// asks for the phone to be unlocked.
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { CHAT_MESSAGE_CATEGORY, MARK_READ_ACTION, REPLY_ACTION, type ChatNotificationAction } from "@/lib/chat-notification";
import { i18n } from "@/lib/i18n/singleton";
import { session } from "./auth/flow";
import { readLastUser } from "./auth/last-user";
import { bootRuntime } from "./boot";
import { chatSendDeps, sendChatMessage, type ChatSendInput } from "./chat-send";
import { readDevicePreference } from "./device-preferences";
import { createLogger } from "./logger";
import { keepSendingOffScreen } from "./outbox-drain/background-send";
import { markRoomRead } from "./pending-ops";
import { savedAppLockOn } from "./privacy-settings";
import { bestEffort } from "./report";
import { queryClient } from "./query-client";
import { deviceStoreInstalled, installDeviceStore } from "./storage/device-store";
import { openNativeDeviceStore } from "./storage/native-device-store";
import { hydrateChatSendStore, useChatSendStore } from "./stores/chat-send-store";
import { hydratePendingOpsStore, usePendingOpsStore } from "./stores/pending-ops-store";

type Translate = (key: string) => string;

const log = createLogger("push");

/**
 * The category's buttons, in the app's language: Reply with a text field, and Mark as read. While the app lock is
 * on, only Mark as read, which on iOS asks for the phone to be unlocked.
 */
export function chatMessageCategoryActions(t: Translate, platform: string, locked = false): Notifications.NotificationAction[] {
  const options = { opensAppToForeground: platform !== "android" };
  const markRead = { identifier: MARK_READ_ACTION, buttonTitle: t("mobile.notification_actions.mark_read"), options };
  if (locked) return [{ ...markRead, options: { ...options, ...(platform === "ios" ? { isAuthenticationRequired: true } : {}) } }];
  return [
    {
      identifier: REPLY_ACTION,
      buttonTitle: t("mobile.notification_actions.reply"),
      textInput: { submitButtonTitle: t("mobile.notification_actions.send"), placeholder: t("mobile.notification_actions.reply_placeholder") },
      options,
    },
    markRead,
  ];
}

/** At launch, on a change of language and on a change of the app lock; a failure leaves the pushes without buttons until the next launch. */
export async function registerChatMessageCategory(t: Translate, platform: string, locked = false): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(CHAT_MESSAGE_CATEGORY, chatMessageCategoryActions(t, platform, locked));
  } catch (error) {
    log.warn("chat notification category not registered", { error: error instanceof Error ? error.name : typeof error });
  }
}

export interface ChatActionEnv {
  /** Whether the app lock is on (the person's or the organization's): a reply must then be written in the unlocked app. */
  appLocked: () => Promise<boolean>;
  /** The person signed in on this phone, with the runtime ready to send for them (a headless one booted); null when none. */
  signedInUser: () => Promise<string | null>;
  send: (input: ChatSendInput) => Promise<void>;
  markRead: (workspaceId: string, roomId: string, userId: string) => Promise<void>;
  dismiss: (notificationId: string) => Promise<void>;
  /** After the action: what it left owed keeps going if UniChat is off screen. */
  offScreen: (userId: string) => void;
  /** A reply the app lock refused: its notification says so, without the spinner of a send under way. */
  refused: (action: Extract<ChatNotificationAction, { action: "reply" }>) => Promise<void>;
}

export type ChatActionOutcome = "replied" | "read" | "signed-out" | "duplicate" | "locked";

const handled = new Set<string>();

export async function handleChatNotificationAction(action: ChatNotificationAction, env: ChatActionEnv): Promise<ChatActionOutcome> {
  if (handled.has(action.key)) return "duplicate";
  handled.add(action.key);
  // Nothing is sent or read: the notification stays for the person to open the app from, saying so.
  if (action.action === REPLY_ACTION && (await env.appLocked())) {
    await env.refused(action);
    return "locked";
  }
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
  // The Keychain, not the privacy store: a headless task has no store, and the running app saves each change there.
  appLocked: () => savedAppLockOn(() => readDevicePreference("privacy")),
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
  // Android only: iOS opened the app for the action (opensAppToForeground), and the room opens there. Posted under
  // the same identifier, so it replaces the one replied to (expo-notifications notifies with it as the tag); silent,
  // since the person is looking at it; the category is the locked one by now, Mark as read only.
  async refused({ notificationId, shown }) {
    if (Platform.OS !== "android" || !notificationId) return;
    await Notifications.scheduleNotificationAsync({
      identifier: notificationId,
      content: {
        title: shown.title,
        body: i18n.t("mobile.notification_actions.reply_locked"),
        data: shown.data,
        categoryIdentifier: CHAT_MESSAGE_CATEGORY,
        sound: false,
      },
      trigger: { channelId: "messages" },
    }).catch(bestEffort("push", "refused reply's notification not posted", "breadcrumb"));
  },
};

/** Runs one action, logs how it went and says it; never throws into a listener or a task. */
export async function runChatNotificationAction(
  action: ChatNotificationAction,
  env: ChatActionEnv = appChatActionEnv,
): Promise<ChatActionOutcome | "failed"> {
  try {
    const outcome = await handleChatNotificationAction(action, env);
    log.info("chat notification action", { action: action.action, outcome });
    return outcome;
  } catch (error) {
    log.warn("chat notification action failed", { action: action.action, error: error instanceof Error ? error.name : typeof error });
    return "failed";
  }
}

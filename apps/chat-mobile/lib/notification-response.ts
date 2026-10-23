// What a notification response does: a tap opens the push's link, Reply or Mark as read run where
// they were tapped (data/chat-notification-actions.ts). Two sources hand a
// response over: the running app's listener, and — for the tap that launched a
// killed app — Notifications.getLastNotificationResponse(), read once at boot,
// so that tap never depends on a listener being registered in time. Both can
// hand over the same response: each (notification, action) runs once, and the
// launch response is cleared once handled so a JavaScript reload does not
// replay it. A reply the app lock refused (typed into a notification shown
// before the lock was on) opens its room as a tap does, behind the lock, when
// the app is in front (app/_layout.tsx decides). Pure: the platform's calls
// are passed in.
import type { NotificationResponse } from "expo-notifications";
import { chatNotificationAction, type ChatNotificationAction } from "./chat-notification";

/** expo-notifications' DEFAULT_ACTION_IDENTIFIER: the notification itself was tapped. */
export const DEFAULT_NOTIFICATION_ACTION = "expo.modules.notifications.actions.DEFAULT";

/** The part of a response this reads; NotificationResponse fits it. */
export type TappedResponse = Pick<NotificationResponse, "actionIdentifier"> & {
  notification: { request: { identifier: string; content: { data?: Record<string, unknown> | null } } };
};

export interface NotificationResponseDeps {
  /** A web link of a push (app/_layout.tsx › openUrl with navigate). */
  openUrl: (url: string) => void;
  /** Runs Reply or Mark as read; resolves true when the app lock refused it in an app in front: the room opens instead. */
  runChatAction: (action: ChatNotificationAction) => Promise<boolean>;
  trackPushOpen: (data: unknown) => void;
  /** Notifications.clearLastNotificationResponse */
  clearLast: () => void;
}

export function createNotificationResponseHandler(deps: NotificationResponseDeps): (response: TappedResponse) => void {
  const handled = new Set<string>();
  return (response) => {
    const key = `${response.notification.request.identifier}|${response.actionIdentifier}`;
    if (handled.has(key)) return;
    handled.add(key);
    deps.clearLast();
    const data = response.notification.request.content.data;
    const open = () => {
      deps.trackPushOpen(data);
      const url = data?.url;
      if (typeof url === "string") deps.openUrl(url);
    };
    const chatAction = chatNotificationAction(response);
    if (!chatAction) return open();
    void Promise.resolve(deps.runChatAction(chatAction)).then((refused) => {
      if (refused) open();
    });
  };
}

/**
 * The response that launched the app, if any, handled at boot. On Android a Reply or Mark as read never opens the
 * app (it ran in the background notification task, in another runtime), so only a tap is taken from there; on iOS
 * the actions open the app and arrive here.
 */
export function handleLaunchResponse(handle: (response: TappedResponse) => void, last: TappedResponse | null, platform: string): boolean {
  if (!last) return false;
  if (platform === "android" && last.actionIdentifier !== DEFAULT_NOTIFICATION_ACTION) return false;
  handle(last);
  return true;
}

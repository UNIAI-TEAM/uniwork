// Expo push registration. The Expo push token travels in `endpoint` with an
// empty web-push key pair, and `platform` tells the server it is an Expo
// token (server SDI). Without an EAS projectId (no EAS account yet, spec §12
// Q8) there is no token to fetch, so registration is skipped and said once.
import * as Notifications from "expo-notifications";
import type { ApiClient } from "./api";

type PushApi = Pick<ApiClient, "subscribePush" | "unsubscribePush">;

interface RegisterPushOptions {
  api: PushApi;
  /** app.config.ts › extra.eas.projectId */
  projectId: string | undefined;
  /** Platform.OS, passed in so this module stays free of react-native */
  platform: string;
}

let registeredToken: string | null = null;
let skipLogged = false;

/** Resolves to the registered Expo push token, or null when nothing was registered. */
export async function registerPushToken({ api, projectId, platform }: RegisterPushOptions): Promise<string | null> {
  if (!projectId) {
    if (!skipLogged) {
      skipLogged = true;
      console.info("[push] no EAS projectId in app config; push registration skipped");
    }
    return null;
  }
  if (platform === "android") {
    // Android needs a channel before the first notification; HIGH makes chat messages heads-up.
    await Notifications.setNotificationChannelAsync("chat", {
      name: "Chat",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return null;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.subscribePush({ endpoint: token, keys: { p256dh: "", auth: "" }, platform });
  registeredToken = token;
  return token;
}

/** Logout: drop the device's subscription while the session can still authorize the call. */
export async function unregisterPushToken(api: PushApi): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  registeredToken = null;
  await api.unsubscribePush({ endpoint: token });
}

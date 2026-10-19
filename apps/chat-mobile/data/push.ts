// Expo push registration. The Expo push token travels in `endpoint` with an
// empty web-push key pair, and `platform` tells the server it is an Expo
// token (server SDI). Without an EAS projectId (no EAS account yet, spec §12
// Q8) there is no token to fetch, so registration is skipped and said once.
// Settings can turn push off for this device: the choice lives in SecureStore
// and every later registration respects it.
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import type { ApiClient } from "./api";

const PUSH_PREF_KEY = "push_enabled";

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

/** The person's choice for this device: on until they turn it off; an unreadable store reads as on. */
export async function isPushEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(PUSH_PREF_KEY)) !== "off";
  } catch {
    return true;
  }
}

/** Resolves to the registered Expo push token, or null when nothing was registered. */
export async function registerPushToken({ api, projectId, platform }: RegisterPushOptions): Promise<string | null> {
  if (!(await isPushEnabled())) return null;
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

/**
 * Settings › Notifications for this device. Off drops the device's server
 * subscription first and remembers the choice only once that worked, so a
 * failure rejects with push still on; the token is asked of Expo again when
 * this process never registered one (registration failed at launch while an
 * older subscription stands). On remembers the choice, then registers.
 */
export async function setPushEnabled(enabled: boolean, options: RegisterPushOptions): Promise<string | null> {
  if (enabled) {
    await SecureStore.setItemAsync(PUSH_PREF_KEY, "on");
    return registerPushToken(options);
  }
  let token = registeredToken;
  if (!token && options.projectId && (await Notifications.getPermissionsAsync()).granted) {
    token = (await Notifications.getExpoPushTokenAsync({ projectId: options.projectId })).data;
  }
  if (token) await options.api.unsubscribePush({ endpoint: token });
  registeredToken = null;
  await SecureStore.setItemAsync(PUSH_PREF_KEY, "off");
  return null;
}

/** Logout: drop the device's subscription while the session can still authorize the call. */
export async function unregisterPushToken(api: PushApi): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  registeredToken = null;
  await api.unsubscribePush({ endpoint: token });
}

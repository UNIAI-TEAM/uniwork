// The services the root layout starts once, before the first render
// (app/_layout.tsx composes; the wiring lives here so it is tested): critical
// OTAs applied away from the person (updates-controller.ts), the anonymous
// product counters (analytics.ts), and the server's last kill switches and
// minimum version kept on the device (remote-config.ts), and the app's language
// sent to the server, which writes pushes and emails in it (locale-sync.ts), and the tray following reads
// (notification-tray.ts). Plus the two events
// the root layout reports: the first screen drawn, and a notification opened.
import type { QueryClient } from "@tanstack/react-query";
import { pushOpenResult, startAnalytics, track } from "./analytics";
import { i18n } from "@/lib/i18n/singleton";
import { accountApi } from "./account-api";
import { useAuthStore } from "./auth/store";
import { startLocaleSync } from "./locale-sync";
import { dismissRoomNotifications } from "./notification-tray";
import { persistRemoteConfig, restoreRemoteConfig } from "./remote-config";
import { bestEffort } from "./report";
import { onRoomRead } from "./room-read-signal";
import { openDeviceStore } from "./storage/device-store";
import { startUpdatesController } from "./updates-controller";

/** When this JavaScript started (this module loads with the root layout): the first screen's time is measured from here. */
const BOOTED_AT = Date.now();
let firstScreenTracked = false;

export interface AppServicesDeps {
  queryClient: QueryClient;
  /** Settings › Privacy › anonymous usage statistics (components/app/privacy.ts), read at every event. */
  usageStatsEnabled: () => boolean;
}

/** Starts the boot services; called once, after the device store is installed (the kept remote config lives there). */
export function startAppServices({ queryClient, usageStatsEnabled }: AppServicesDeps): void {
  // An update marked critical is applied away from the person, not at the next cold start.
  startUpdatesController();
  // Anonymous product counters (opens, sends, push opens, call connects), off when the person says so.
  startAnalytics({ enabled: usageStatsEnabled, signedIn: () => useAuthStore.getState().user !== null });
  // The server's last kill switches and minimum version, kept on the device: they hold through an offline cold start.
  persistRemoteConfig(queryClient, openDeviceStore);
  void restoreRemoteConfig(queryClient, openDeviceStore).catch(bestEffort("remote-config", "kept answer not read", "breadcrumb"));
  // A room read here or on another device takes its notifications out of the tray.
  onRoomRead((roomId) => void dismissRoomNotifications(roomId).catch(bestEffort("push", "read room's notifications not dismissed", "breadcrumb")));
  startLocaleSync({
    getUser: () => useAuthStore.getState().user,
    subscribeUser: (listener) => useAuthStore.subscribe((state, previous) => state.user !== previous.user && listener()),
    getLocale: () => (i18n.language === "en" ? "en" : "vi"),
    subscribeLocale: (listener) => {
      i18n.on("languageChanged", listener);
      return () => i18n.off("languageChanged", listener);
    },
    patchLocale: (locale) => accountApi.setLocale(locale),
    setUser: (user) => useAuthStore.getState().setUser(user),
    openStore: openDeviceStore,
  });
}

/** The first screen drew (the splash went): its time since JS started, once per process. */
export function trackFirstScreen(now: number = Date.now()): void {
  if (firstScreenTracked) return;
  firstScreenTracked = true;
  track({ name: "first_screen", result: "ok", duration_ms: now - BOOTED_AT });
}

/** A notification tap that opens something, by what it was about (a chat message, a call, anything else). */
export function trackPushOpen(data: unknown): void {
  track({ name: "push_open", result: pushOpenResult(data) });
}

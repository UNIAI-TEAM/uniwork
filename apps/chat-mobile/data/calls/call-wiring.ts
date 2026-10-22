// Wires the native call support (docs/adr/drafts/0038) to the app: the
// pieces in this folder hold the policy and are tested on their own; this
// file hands them the real call engine, session, socket-free API, i18n,
// AppState and the native module.
//
// - registerCallBackgroundTasks(), at the app's entry (index.ts) so it exists
//   in a headless runtime too: the Android background notification task that
//   turns a data-only call push into the ringing notification
//   (call-push.ts), and the headless task Decline / Hang up run
//   (call-actions.ts).
// - startNativeCalls(), once the app's screens load (app/_layout.tsx): the
//   engine ↔ foreground-service sync (call-native-sync.ts), the Decline /
//   Hang up taps that could not run before, the foreground push handler
//   (lib/notification-presentation.ts), the hand-over of a call ringing
//   on screen to the notification when the person leaves the app, and the
//   call's service started again on the way back; and the native ring path
//   kept able to ring without JavaScript (native-ring.ts), its rings counted.
//
// The background task is only the fallback ring path on Android now: a call
// push for a closed or backgrounded app rings from the FCM service itself
// (modules/unichat-calls › NativeCallPush.kt) and never reaches JavaScript;
// the task sees a ring the native path left to it (UniChat on screen, a call
// under way, no ring config yet, a notification the system refused).
import { runtimeConfig } from "@uniwork/core/runtime-config";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { AppRegistry, AppState, PermissionsAndroid, Platform } from "react-native";
import { callPushFromData, ringLatencyMs, taskPayloadData } from "@/lib/call-push";
import { chatNotificationAction } from "@/lib/chat-notification";
import { roomReadPushFromData, type RoomReadPush } from "@/lib/room-read-push";
import { i18n } from "@/lib/i18n/singleton";
import { showInForeground } from "@/lib/notification-presentation";
import { track } from "../analytics";
import { applyStoredLocale } from "../app-locale";
import { authConfig, session } from "../auth/flow";
import { setAppBadge } from "../badge";
import { bootRuntime } from "../boot";
import { runChatNotificationAction } from "../chat-notification-actions";
import { createLogger } from "../logger";
import { callChannelNames } from "../notification-channels";
import { dismissRoomNotifications } from "../notification-tray";
import { queryClient } from "../query-client";
import { readMobileFlag, remoteConfigKey, restoreRemoteConfig } from "../remote-config";
import { bestEffort } from "../report";
import { openDeviceStore } from "../storage/device-store";
import { getCurrentWorkspace } from "../stores/workspace-store";
import { callActionFrom, handleCallAction, type CallActionEnv } from "./call-actions";
import { createNativeCallSync, installNativeCallSync } from "./call-native-sync";
import { callSignals } from "./call-signals";
import { installGroupDecline } from "./group-decline";
import { handleCallPush, incomingSpecFromState, type CallPushEnv } from "./call-push";
import { callEngine } from "./call-store";
import { nativeCalls } from "./native-calls";
import { installNativeRingSync, reportNativeRings, type NativeRingSyncEnv } from "./native-ring";

/** expo-task-manager's name for the background notification task. */
export const CALL_PUSH_TASK = "unichat-call-push";
/** CallActionTaskService.TASK_KEY in modules/unichat-calls. */
export const CALL_ACTION_TASK = "UniChatCallAction";

const log = createLogger("calls");
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const current = () => callEngine.store.getState().call;

/** Android 12+ asks before Bluetooth audio; asked at the start of each call until granted. */
export async function requestBluetooth(): Promise<void> {
  if (Platform.OS !== "android" || typeof Platform.Version !== "number" || Platform.Version < 31) return;
  const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  if (!(await PermissionsAndroid.check(permission))) await PermissionsAndroid.request(permission);
}

/** The plain ring's notification id, so the end of the ring takes it down. */
const fallbackRingId = (callId: string) => `call-ring:${callId}`;

/**
 * The plain ring (call-push.ts › fallback), on the missed-calls channel:
 * expo-notifications creates that one at launch, while the calls channel
 * exists only where the native module made it. A tap opens the call's
 * ringing screen through the push's `data.url` (app/_layout.tsx).
 */
const callFallback: CallPushEnv["fallback"] = {
  async show(call, url) {
    await Notifications.scheduleNotificationAsync({
      identifier: fallbackRingId(call.callId),
      content: { title: call.callerName, body: call.text, data: { url }, sound: "default", priority: Notifications.AndroidNotificationPriority.MAX },
      trigger: { channelId: "missed_calls" },
    });
  },
  dismiss: (callId) => Notifications.dismissNotificationAsync(fallbackRingId(callId)),
};

const pushEnv: CallPushEnv = {
  native: nativeCalls,
  fallback: callFallback,
  appActive: () => AppState.currentState === "active",
  callsOn: () => readMobileFlag(queryClient, "unichat_mobile_calls"),
  engine: { current, contextWorkspaceId: () => callEngine.contextWorkspaceId(), syncPendingInvites: () => callEngine.syncPendingInvites() },
  ensureChannels: () => nativeCalls.ensureChannels(callChannelNames(t)),
  t,
  scheme: authConfig.scheme,
  now: () => Date.now(),
};

const actionEnv: CallActionEnv = {
  engine: { current, hangUp: () => callEngine.hangUp() },
  async declineOnServer(workspaceId, roomId, callId) {
    // A headless runtime: no screen restored the session or set the server URLs.
    bootRuntime();
    if (session.status() === "signed-out" && !(await session.restore())) return;
    await callSignals.decline(workspaceId, roomId, callId);
  },
  now: () => Date.now(),
};

/**
 * A room read on another device (server: chat.room.notifications_cleared): its message notifications leave this
 * phone's tray and the icon takes the count the server sent, with UniChat closed or not. No runtime to boot: both
 * are expo-notifications calls.
 */
async function clearReadRoom(push: RoomReadPush): Promise<void> {
  const dismissed = await dismissRoomNotifications(push.roomId);
  if (push.badge !== null) await setAppBadge(push.badge);
  log.info("room read elsewhere", { dismissed });
}

/**
 * The background notification task's body: a call push, a room read on another device, or a Reply / Mark as read
 * tapped on a chat notification while UniChat is closed (Android runs this task for an action too:
 * data/chat-notification-actions.ts), or nothing.
 */
export async function runCallPushTask(payload: unknown): Promise<void> {
  const chatAction = chatNotificationAction(payload);
  if (chatAction) return runChatNotificationAction(chatAction);
  const data = taskPayloadData(payload);
  const roomRead = roomReadPushFromData(data);
  if (roomRead) return clearReadRoom(roomRead).catch(bestEffort("push", "read room's notifications not cleared", "breadcrumb"));
  const push = callPushFromData(data);
  if (!push) return;
  bootRuntime();
  await applyStoredLocale();
  // A headless runtime has no screen that seeded the kept remote config: without it the calls switch would read
  // its default (on), and a switch the server turned off would still ring here (review: kill switch fails open).
  await restoreRemoteConfig(queryClient, openDeviceStore).catch(bestEffort("remote-config", "kept answer not read", "breadcrumb"));
  reportNativeRings(nativeCalls, track);
  try {
    const outcome = await handleCallPush(push, pushEnv);
    log.info("call push", { type: push.type, outcome });
    track({ name: "call_push", result: outcome });
    const latency = push.type === "call_invite" && (outcome === "shown" || outcome === "fallback") ? ringLatencyMs(push, Date.now()) : null;
    if (latency !== null) track({ name: "call_ring", result: "app", duration_ms: latency });
  } catch (error) {
    log.warn("call push failed", { type: push.type, error: error instanceof Error ? error.name : typeof error });
    if (push.type === "call_invite") track({ name: "call_push", result: "lost" });
  }
}

/** The headless Decline / Hang up task's body. */
export async function runCallActionTask(data: unknown): Promise<void> {
  const action = callActionFrom(data);
  if (!action) return;
  try {
    const outcome = await handleCallAction(action, actionEnv);
    log.info("call action", { action: action.action, outcome });
  } catch (error) {
    log.warn("call action failed", { action: action.action, error: error instanceof Error ? error.name : typeof error });
  }
}

/** At the app's entry, before any screen: both tasks must exist in a headless runtime. Android only. */
export function registerCallBackgroundTasks(): void {
  if (Platform.OS !== "android") return;
  TaskManager.defineTask(CALL_PUSH_TASK, ({ data }) => runCallPushTask(data));
  Notifications.registerTaskAsync(CALL_PUSH_TASK).catch((error: unknown) =>
    log.warn("call push task not registered", { error: error instanceof Error ? error.name : typeof error }),
  );
  AppRegistry.registerHeadlessTask(CALL_ACTION_TASK, () => runCallActionTask);
}

/** The engine's sync with the foreground service, for the call screen's refresh once LiveKit connects. */
export const nativeCallSync = createNativeCallSync({
  native: nativeCalls,
  requestBluetooth,
  workspaceId: () => callEngine.contextWorkspaceId() ?? "",
  t,
  now: () => Date.now(),
});

/**
 * A push that arrives while UniChat is open: quiet when it is about the
 * workspace on screen (a call there rings in the app; the pending list picks
 * up one the socket missed), a banner with sound otherwise.
 */
export async function foregroundBehavior(data: unknown): Promise<Notifications.NotificationBehavior> {
  const workspace = callEngine.contextWorkspaceId() ? getCurrentWorkspace() : null;
  const show = showInForeground(data, workspace, runtimeConfig().appUrl, authConfig.scheme);
  if (!show && callPushFromData(data)?.type === "call_invite" && readMobileFlag(queryClient, "unichat_mobile_calls")) {
    void callEngine.syncPendingInvites();
  }
  return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
}

/**
 * A call ringing on screen when the person leaves the app (Home, another
 * app) moves to the ringing notification, which rings on the calls channel
 * and answers or declines from there; back in the app, the call screen and
 * its ringer take it again. Android only (the module is a no-op elsewhere).
 */
export function handOverRing(status: string): void {
  const state = current();
  if (state.status !== "incoming") return;
  if (status === "active") {
    nativeCalls.cancelIncomingCall(state.callId);
    nativeCalls.startRinging();
    return;
  }
  if (status !== "background") return;
  const workspace = getCurrentWorkspace();
  if (!workspace) return;
  const chatUrl = `${runtimeConfig().appUrl}/${encodeURIComponent(workspace.orgSlug)}/${encodeURIComponent(workspace.wsSlug)}/chat`;
  nativeCalls.stopRinging();
  nativeCalls.showIncomingCall(incomingSpecFromState(state, chatUrl, workspace.wsId, pushEnv));
}

/**
 * The app's AppState listener: the ring hand-over, and back in the app the
 * call's service once more — a start Android refused while the app was in the
 * background (no foreground-start exemption) gets another try in front.
 */
export function onAppStateChange(status: string): void {
  if (status === "active") {
    nativeCallSync.refresh(current());
    reportNativeRings(nativeCalls, track);
  }
  handOverRing(status);
}

/**
 * The native ring path's config follows the calls switch (every update of the remote-config query) and the
 * language; a return to the app writes it again if anything else moved meanwhile.
 */
export const ringSyncEnv: NativeRingSyncEnv = {
  native: nativeCalls,
  t,
  scheme: authConfig.scheme,
  callsOn: () => readMobileFlag(queryClient, "unichat_mobile_calls"),
  subscribe(listener) {
    const offConfig = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === remoteConfigKey[0]) listener();
    });
    const appState = AppState.addEventListener("change", (status) => status === "active" && listener());
    i18n.on("languageChanged", listener);
    return () => {
      offConfig();
      appState.remove();
      i18n.off("languageChanged", listener);
    };
  },
};

/** Once the app's screens load; the function it returns undoes it (tests). */
export function startNativeCalls(): () => void {
  const stopSync = installNativeCallSync(callEngine.store, nativeCallSync);
  const stopRingSync = installNativeRingSync(ringSyncEnv);
  // A group call declined on screen stops ringing on the person's other devices too.
  const stopGroupDecline = installGroupDecline(callEngine.store, {
    decline: (wsId, roomId, callId) => callSignals.decline(wsId, roomId, callId),
    workspaceId: () => callEngine.contextWorkspaceId(),
  });
  for (const pending of nativeCalls.takePendingActions()) void runCallActionTask(pending);
  // Rings the FCM service handled while JavaScript was not running, counted now.
  reportNativeRings(nativeCalls, track);
  Notifications.setNotificationHandler({ handleNotification: (notification) => foregroundBehavior(notification.request.content.data) });
  const appState = AppState.addEventListener("change", onAppStateChange);
  return () => {
    stopSync();
    stopRingSync();
    stopGroupDecline();
    appState.remove();
    Notifications.setNotificationHandler(null);
  };
}

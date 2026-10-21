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
//   (lib/notification-presentation.ts), and the hand-over of a call ringing
//   on screen to the notification when the person leaves the app.
import { runtimeConfig } from "@uniwork/core/runtime-config";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { AppRegistry, AppState, PermissionsAndroid, Platform } from "react-native";
import { callPushFromData, taskPayloadData } from "@/lib/call-push";
import { i18n } from "@/lib/i18n/singleton";
import { showInForeground } from "@/lib/notification-presentation";
import { applyStoredLocale } from "../app-locale";
import { authConfig, session } from "../auth/flow";
import { bootRuntime } from "../boot";
import { chatApi } from "../chat-api";
import { createLogger } from "../logger";
import { callChannelNames } from "../notification-channels";
import { queryClient } from "../query-client";
import { readMobileFlag } from "../remote-config";
import { getCurrentWorkspace } from "../stores/workspace-store";
import { callActionFrom, handleCallAction, type CallActionEnv } from "./call-actions";
import { createNativeCallSync, installNativeCallSync } from "./call-native-sync";
import { handleCallPush, incomingSpecFromState, type CallPushEnv } from "./call-push";
import { callEngine } from "./call-store";
import { nativeCalls } from "./native-calls";

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

const pushEnv: CallPushEnv = {
  native: nativeCalls,
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
    await chatApi.signalVoiceHangup(workspaceId, roomId, callId);
  },
  now: () => Date.now(),
};

/** The background notification task's body: a call push, or nothing. */
export async function runCallPushTask(payload: unknown): Promise<void> {
  const push = callPushFromData(taskPayloadData(payload));
  if (!push) return;
  bootRuntime();
  await applyStoredLocale();
  try {
    const outcome = await handleCallPush(push, pushEnv);
    log.info("call push", { type: push.type, outcome });
  } catch (error) {
    log.warn("call push failed", { type: push.type, error: error instanceof Error ? error.name : typeof error });
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

/** Once the app's screens load; the function it returns undoes it (tests). */
export function startNativeCalls(): () => void {
  const stopSync = installNativeCallSync(callEngine.store, nativeCallSync);
  for (const pending of nativeCalls.takePendingActions()) void runCallActionTask(pending);
  Notifications.setNotificationHandler({ handleNotification: (notification) => foregroundBehavior(notification.request.content.data) });
  const appState = AppState.addEventListener("change", handOverRing);
  return () => {
    stopSync();
    appState.remove();
    Notifications.setNotificationHandler(null);
  };
}

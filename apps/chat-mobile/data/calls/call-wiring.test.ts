// The wiring with every native and network edge stood in for: the tasks
// register (Android only) and run the tested policies (call-push.ts,
// call-actions.ts) with the real engine shape, the session and the API.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";

const rn = vi.hoisted(() => ({
  Platform: { OS: "android", Version: 34 as number | string },
  AppState: { currentState: "background", addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  AppRegistry: { registerHeadlessTask: vi.fn() },
  PermissionsAndroid: { PERMISSIONS: { BLUETOOTH_CONNECT: "android.permission.BLUETOOTH_CONNECT" }, check: vi.fn(async () => false), request: vi.fn(async () => "granted") },
}));
vi.mock("react-native", () => rn);

const notifications = vi.hoisted(() => ({
  registerTaskAsync: vi.fn(async () => null),
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(async () => null),
  deleteNotificationChannelAsync: vi.fn(async () => undefined),
  scheduleNotificationAsync: vi.fn(async () => "id"),
  dismissNotificationAsync: vi.fn(async () => undefined),
  AndroidNotificationPriority: { MAX: "max" },
  AndroidImportance: { HIGH: 6, DEFAULT: 5 },
  AndroidNotificationVisibility: { PUBLIC: 1, PRIVATE: 2 },
}));
vi.mock("expo-notifications", () => notifications);
const taskManager = vi.hoisted(() => ({ defineTask: vi.fn() }));
vi.mock("expo-task-manager", () => taskManager);
vi.mock("@uniwork/core/runtime-config", () => ({ runtimeConfig: () => ({ appUrl: "https://app.test" }) }));

const deps = vi.hoisted(() => ({
  applyStoredLocale: vi.fn(async () => "vi"),
  bootRuntime: vi.fn(),
  session: {
    status: vi.fn(() => "signed-out"),
    restore: vi.fn(async () => true),
  },
  cacheListener: (_event: { query: { queryKey: readonly unknown[] } }) => undefined as void,
  offCache: vi.fn(),
  restoreRemoteConfig: vi.fn(async () => true),
  openDeviceStore: vi.fn(),
  signalVoiceDecline: vi.fn(async () => true),
  callsOn: true,
  workspace: { orgSlug: "acme", wsSlug: "hq", wsId: "w-1" } as { orgSlug: string; wsSlug: string; wsId: string } | null,
  pending: [] as Record<string, unknown>[],
}));
vi.mock("../app-locale", () => ({ applyStoredLocale: deps.applyStoredLocale }));
vi.mock("../boot", () => ({ bootRuntime: deps.bootRuntime }));
vi.mock("../auth/flow", () => ({ authConfig: { scheme: "uniworkchat" }, session: deps.session }));
vi.mock("../chat-api", () => ({ chatApi: { signalVoiceDecline: deps.signalVoiceDecline } }));
const queryClient = vi.hoisted(() => ({
  getQueryCache: () => ({
    subscribe: (listener: (event: { query: { queryKey: readonly unknown[] } }) => void) => {
      deps.cacheListener = listener;
      return deps.offCache;
    },
  }),
}));
vi.mock("../query-client", () => ({ queryClient }));
vi.mock("../remote-config", () => ({ readMobileFlag: () => deps.callsOn, remoteConfigKey: ["remote-config"], restoreRemoteConfig: deps.restoreRemoteConfig }));
vi.mock("../storage/device-store", () => ({ openDeviceStore: deps.openDeviceStore }));
vi.mock("../stores/workspace-store", () => ({ getCurrentWorkspace: () => deps.workspace }));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../analytics", () => analytics);
const tray = vi.hoisted(() => ({ dismissRoomNotifications: vi.fn(async () => 2), setAppBadge: vi.fn(async () => undefined) }));
vi.mock("../notification-tray", () => ({ dismissRoomNotifications: tray.dismissRoomNotifications }));
vi.mock("../badge", () => ({ setAppBadge: tray.setAppBadge }));
const chatActions = vi.hoisted(() => ({ runChatNotificationAction: vi.fn(async () => undefined) }));
vi.mock("../chat-notification-actions", () => chatActions);

const engine = vi.hoisted(() => ({
  ctx: "w-1" as string | null,
  store: null as unknown as StoreApi<{ call: VoiceCallOverlayState }>,
  syncPendingInvites: vi.fn(async () => undefined),
  hangUp: vi.fn(async () => undefined),
}));
vi.mock("./call-store", async () => {
  const { createStore: create } = await import("zustand/vanilla");
  engine.store = create<{ call: VoiceCallOverlayState }>(() => ({ call: { status: "idle" } }));
  return {
    callEngine: {
      store: engine.store,
      contextWorkspaceId: () => engine.ctx,
      syncPendingInvites: engine.syncPendingInvites,
      hangUp: engine.hangUp,
    },
  };
});

const native = vi.hoisted(() => ({
  available: true,
  ensureChannels: vi.fn(),
  showIncomingCall: vi.fn(() => true),
  cancelIncomingCall: vi.fn(),
  startOngoingCall: vi.fn(() => true),
  stopOngoingCall: vi.fn(),
  startRinging: vi.fn(),
  stopRinging: vi.fn(),
  canUseFullScreenIntent: vi.fn(() => true),
  openFullScreenIntentSettings: vi.fn(),
  releaseLockScreen: vi.fn(),
  takePendingActions: vi.fn(() => deps.pending),
  configureRing: vi.fn(),
  takeRingReports: vi.fn((): { result: string; latencyMs: number }[] => []),
}));
vi.mock("./native-calls", () => ({ nativeCalls: native }));

const wiring = await import("./call-wiring");
const { i18n } = await import("@/lib/i18n/singleton");

const NOW = Date.now();
const INVITE = {
  type: "call_invite",
  call_id: "c-1",
  room_id: "r-1",
  workspace_id: "w-1",
  caller_name: "Minh",
  call_kind: "dm",
  video: "0",
  expires_at: String(NOW + 40_000),
  url: "https://app.test/acme/hq/chat?room=r-1&call=c-1",
};
const DECLINE = { action: "decline", callId: "c-1", roomId: "r-1", workspaceId: "w-1", callKind: "dm", at: NOW };

beforeEach(() => {
  vi.clearAllMocks();
  rn.Platform.OS = "android";
  rn.Platform.Version = 34;
  rn.AppState.currentState = "background";
  deps.callsOn = true;
  deps.workspace = { orgSlug: "acme", wsSlug: "hq", wsId: "w-1" };
  deps.pending = [];
  deps.session.status.mockReturnValue("signed-out");
  deps.session.restore.mockResolvedValue(true);
  engine.ctx = "w-1";
  engine.store.setState({ call: { status: "idle" } });
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

describe("registerCallBackgroundTasks", () => {
  it("defines the push task and the Decline task on Android, and runs them", async () => {
    wiring.registerCallBackgroundTasks();
    expect(taskManager.defineTask).toHaveBeenCalledWith(wiring.CALL_PUSH_TASK, expect.any(Function));
    expect(notifications.registerTaskAsync).toHaveBeenCalledWith(wiring.CALL_PUSH_TASK);
    expect(rn.AppRegistry.registerHeadlessTask).toHaveBeenCalledWith(wiring.CALL_ACTION_TASK, expect.any(Function));
    const pushTask = taskManager.defineTask.mock.calls[0]![1] as (body: { data: unknown }) => Promise<void>;
    await pushTask({ data: { data: { body: JSON.stringify(INVITE) } } });
    expect(native.showIncomingCall).toHaveBeenCalledWith(expect.objectContaining({ callId: "c-1", callerName: "Minh" }));
    const factory = rn.AppRegistry.registerHeadlessTask.mock.calls[0]![1] as () => (data: unknown) => Promise<void>;
    expect(factory()).toBe(wiring.runCallActionTask);
  });

  it("logs a push task Android would not register, and does nothing on iOS", async () => {
    notifications.registerTaskAsync.mockRejectedValueOnce(new Error("no task manager"));
    wiring.registerCallBackgroundTasks();
    notifications.registerTaskAsync.mockRejectedValueOnce("odd");
    wiring.registerCallBackgroundTasks();
    await Promise.resolve();
    rn.Platform.OS = "ios";
    vi.clearAllMocks();
    wiring.registerCallBackgroundTasks();
    expect(taskManager.defineTask).not.toHaveBeenCalled();
    expect(rn.AppRegistry.registerHeadlessTask).not.toHaveBeenCalled();
  });
});

describe("runCallPushTask", () => {
  it("hands a Reply or Mark as read tapped on a chat notification to the chat actions, not the call policy", async () => {
    const response = {
      actionIdentifier: "reply",
      userText: "ok",
      notification: { request: { identifier: "n1", content: { data: { workspace_id: "w-1", room_id: "r-1", message_id: "m-1" } } } },
    };
    await wiring.runCallPushTask(response);
    expect(chatActions.runChatNotificationAction).toHaveBeenCalledWith(expect.objectContaining({ action: "reply", text: "ok", key: "n1:reply" }));
    expect(deps.bootRuntime).not.toHaveBeenCalled();
  });

  it("hands over the shape Android's task really receives: the push's data as `dataString` on the content", async () => {
    const dataString = JSON.stringify({ workspace_id: "w-1", room_id: "r-1", message_id: "m-1" });
    const content = { title: "Minh", body: "hi", dataString };
    await wiring.runCallPushTask({ actionIdentifier: "reply", userText: "ok", notification: { request: { identifier: "n1", content } } });
    await wiring.runCallPushTask({ actionIdentifier: "mark_read", notification: { request: { identifier: "n2", content } } });
    expect(chatActions.runChatNotificationAction).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: "reply", text: "ok", key: "n1:reply" }));
    expect(chatActions.runChatNotificationAction).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: "mark_read", key: "n2:mark_read" }));
    expect(deps.bootRuntime).not.toHaveBeenCalled();
  });

  it("boots the runtime and the language, then rings with the app's own notification", async () => {
    await wiring.runCallPushTask({ data: { dataString: JSON.stringify(INVITE) } });
    expect(deps.bootRuntime).toHaveBeenCalledTimes(1);
    expect(deps.applyStoredLocale).toHaveBeenCalledTimes(1);
    expect(native.ensureChannels).toHaveBeenCalledWith(expect.objectContaining({ calls: expect.any(String) }));
    expect(native.showIncomingCall).toHaveBeenCalledWith(expect.objectContaining({ openUrl: expect.stringMatching(/^uniworkchat:\/\/open\?url=/) }));
    // What the push did is counted (server metrics › call_push; alert UniChatCallRingsDegraded).
    expect(analytics.track).toHaveBeenCalledWith({ name: "call_push", result: "shown" });
  });

  it("rings with a plain notification on the missed-calls channel when the native one is not shown, and the end takes it down", async () => {
    native.showIncomingCall.mockReturnValueOnce(false);
    await wiring.runCallPushTask({ data: INVITE });
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: "call-ring:c-1",
      content: {
        title: "Minh",
        body: expect.any(String),
        data: { url: "https://app.test/acme/hq/chat?room=r-1&call=c-1" },
        sound: "default",
        priority: "max",
      },
      trigger: { channelId: "missed_calls" },
    });
    await wiring.runCallPushTask({ data: { type: "call_end", call_id: "c-1", room_id: "r-1", workspace_id: "w-1" } });
    expect(notifications.dismissNotificationAsync).toHaveBeenCalledWith("call-ring:c-1");
  });

  it("reads the kept remote config first, so a calls switch the server turned off holds in a headless runtime", async () => {
    deps.restoreRemoteConfig.mockImplementationOnce(async () => {
      deps.callsOn = false;
      return true;
    });
    await wiring.runCallPushTask({ data: INVITE });
    expect(deps.restoreRemoteConfig).toHaveBeenCalledWith(queryClient, deps.openDeviceStore);
    expect(native.showIncomingCall).not.toHaveBeenCalled();
    expect(analytics.track).toHaveBeenCalledWith({ name: "call_push", result: "ignored" });
  });

  it("still rings when the kept config cannot be read", async () => {
    deps.restoreRemoteConfig.mockRejectedValueOnce(new Error("locked"));
    await wiring.runCallPushTask({ data: INVITE });
    expect(native.showIncomingCall).toHaveBeenCalledTimes(1);
  });

  it("counts how long after the server rang the phone rang, and what the native path did meanwhile", async () => {
    native.takeRingReports.mockReturnValueOnce([{ result: "native", latencyMs: 700 }]);
    await wiring.runCallPushTask({ data: INVITE });
    expect(analytics.track).toHaveBeenCalledWith({ name: "call_push", result: "native" });
    expect(analytics.track).toHaveBeenCalledWith({ name: "call_ring", result: "native", duration_ms: 700 });
    // expires_at is 40 s ahead, so the server rang 20 s before now (the ring window is 60 s).
    const ring = analytics.track.mock.calls.map(([event]) => event as { name: string; result: string; duration_ms?: number }).find((e) => e.result === "app");
    expect(ring?.name).toBe("call_ring");
    expect(ring?.duration_ms).toBeGreaterThanOrEqual(20_000);
    // A ring that says nothing of when it ends has no latency to count.
    analytics.track.mockClear();
    await wiring.runCallPushTask({ data: { ...INVITE, expires_at: "" } });
    expect(analytics.track).toHaveBeenCalledWith({ name: "call_push", result: "shown" });
    expect(analytics.track.mock.calls.some(([event]) => (event as { name: string }).name === "call_ring")).toBe(false);
  });

  it("takes a room read on another device out of the tray and sets the icon's count, without booting anything", async () => {
    await wiring.runCallPushTask({ data: { body: JSON.stringify({ type: "room_read", room_id: "r-1", workspace_id: "w-1", badge: "3" }) } });
    expect(tray.dismissRoomNotifications).toHaveBeenCalledWith("r-1");
    expect(tray.setAppBadge).toHaveBeenCalledWith(3);
    expect(deps.bootRuntime).not.toHaveBeenCalled();
    // No count from the server: the icon is left as it is; a tray that cannot be read is a breadcrumb, not a crash.
    tray.dismissRoomNotifications.mockRejectedValueOnce(new Error("no tray"));
    await expect(wiring.runCallPushTask({ data: { type: "room_read", room_id: "r-2", call_id: "" } })).resolves.toBeUndefined();
    await wiring.runCallPushTask({ data: { body: JSON.stringify({ type: "room_read", room_id: "r-3" }) } });
    expect(tray.dismissRoomNotifications).toHaveBeenLastCalledWith("r-3");
    expect(tray.setAppBadge).toHaveBeenCalledTimes(1);
  });

  it("ignores a push that is not about a call, without booting anything", async () => {
    await wiring.runCallPushTask({ data: { body: JSON.stringify({ url: "https://x", tag: "t" }) } });
    expect(deps.bootRuntime).not.toHaveBeenCalled();
  });

  it("on screen in a workspace, asks its pending list first and rings natively only a call it does not know", async () => {
    rn.AppState.currentState = "active";
    await wiring.runCallPushTask({ data: INVITE });
    expect(engine.syncPendingInvites).toHaveBeenCalledTimes(1);
    expect(native.showIncomingCall).toHaveBeenCalledTimes(1);
  });

  it("on screen, with the switch off, nothing rings", async () => {
    rn.AppState.currentState = "active";
    deps.callsOn = false;
    await wiring.runCallPushTask({ data: INVITE });
    expect(native.showIncomingCall).not.toHaveBeenCalled();
  });

  it("swallows (and logs) a native failure", async () => {
    native.showIncomingCall.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await expect(wiring.runCallPushTask({ data: INVITE })).resolves.toBeUndefined();
    native.showIncomingCall.mockImplementationOnce(() => {
      throw "boom";
    });
    await expect(wiring.runCallPushTask({ data: INVITE })).resolves.toBeUndefined();
    // A ring that threw reached no notification: counted as lost.
    expect(analytics.track.mock.calls.filter(([event]) => (event as { result: string }).result === "lost")).toHaveLength(2);
    // An end that threw lost no ring.
    native.cancelIncomingCall.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await expect(wiring.runCallPushTask({ data: { type: "call_end", call_id: "c-1", room_id: "r-1", workspace_id: "w-1" } })).resolves.toBeUndefined();
    expect(analytics.track.mock.calls.filter(([event]) => (event as { result: string }).result === "lost")).toHaveLength(2);
  });
});

describe("runCallActionTask", () => {
  it("declines a 1-1 call on the server from a closed app, signing the stored session in", async () => {
    await wiring.runCallActionTask(DECLINE);
    expect(deps.bootRuntime).toHaveBeenCalled();
    expect(deps.session.restore).toHaveBeenCalledTimes(1);
    expect(deps.signalVoiceDecline).toHaveBeenCalledWith("w-1", "r-1", "c-1");
  });

  it("uses the session already in, and gives up without one", async () => {
    deps.session.status.mockReturnValue("signed-in");
    await wiring.runCallActionTask(DECLINE);
    expect(deps.session.restore).not.toHaveBeenCalled();
    expect(deps.signalVoiceDecline).toHaveBeenCalledTimes(1);
    deps.session.status.mockReturnValue("signed-out");
    deps.session.restore.mockResolvedValueOnce(false);
    await wiring.runCallActionTask(DECLINE);
    expect(deps.signalVoiceDecline).toHaveBeenCalledTimes(1);
  });

  it("hands a call the app is in to the engine; ignores what is not an action; logs a failure", async () => {
    engine.store.setState({ call: { status: "incoming", callId: "c-1", roomId: "r-1", peerName: "Minh", callKind: "dm" } });
    await wiring.runCallActionTask(DECLINE);
    expect(engine.hangUp).toHaveBeenCalledTimes(1);
    await wiring.runCallActionTask({ action: "answer" });
    expect(engine.hangUp).toHaveBeenCalledTimes(1);
    engine.store.setState({ call: { status: "idle" } });
    deps.signalVoiceDecline.mockRejectedValueOnce(new Error("offline"));
    await expect(wiring.runCallActionTask(DECLINE)).resolves.toBeUndefined();
    deps.signalVoiceDecline.mockRejectedValueOnce("offline");
    await expect(wiring.runCallActionTask(DECLINE)).resolves.toBeUndefined();
  });
});

describe("requestBluetooth", () => {
  it("asks on Android 12+ until granted, never elsewhere", async () => {
    await wiring.requestBluetooth();
    expect(rn.PermissionsAndroid.request).toHaveBeenCalledWith("android.permission.BLUETOOTH_CONNECT");
    rn.PermissionsAndroid.check.mockResolvedValueOnce(true);
    await wiring.requestBluetooth();
    expect(rn.PermissionsAndroid.request).toHaveBeenCalledTimes(1);
    for (const [os, version] of [["android", 30], ["android", "x"], ["ios", 34]] as const) {
      rn.Platform.OS = os;
      rn.Platform.Version = version;
      await wiring.requestBluetooth();
    }
    expect(rn.PermissionsAndroid.check).toHaveBeenCalledTimes(2);
  });
});

describe("foregroundBehavior", () => {
  it("keeps a push about the open workspace quiet and has its pending list pick up a missed ring", async () => {
    expect(await wiring.foregroundBehavior(INVITE)).toEqual({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false });
    expect(engine.syncPendingInvites).toHaveBeenCalledTimes(1);
    await wiring.foregroundBehavior({ url: INVITE.url });
    deps.callsOn = false;
    await wiring.foregroundBehavior(INVITE);
    expect(engine.syncPendingInvites).toHaveBeenCalledTimes(1);
  });

  it("shows a push about another workspace, or any push with no workspace open", async () => {
    expect((await wiring.foregroundBehavior({ ...INVITE, url: "https://app.test/acme/sales/chat?room=r&call=c" })).shouldShowBanner).toBe(true);
    engine.ctx = null;
    expect((await wiring.foregroundBehavior(INVITE)).shouldPlaySound).toBe(true);
    expect(engine.syncPendingInvites).not.toHaveBeenCalled();
  });
});

describe("handOverRing", () => {
  const ringing: VoiceCallOverlayState = { status: "incoming", callId: "c-1", roomId: "r-1", peerName: "Minh", callKind: "dm" };

  it("moves a call ringing on screen to the notification when the person leaves, and back on return", () => {
    engine.store.setState({ call: ringing });
    wiring.handOverRing("background");
    expect(native.stopRinging).toHaveBeenCalledTimes(1);
    expect(native.showIncomingCall).toHaveBeenCalledWith(
      expect.objectContaining({ callId: "c-1", workspaceId: "w-1", openUrl: `uniworkchat://open?url=${encodeURIComponent("https://app.test/acme/hq/chat?room=r-1&call=c-1")}` }),
    );
    wiring.handOverRing("active");
    expect(native.cancelIncomingCall).toHaveBeenCalledWith("c-1");
    expect(native.startRinging).toHaveBeenCalledTimes(1);
    wiring.handOverRing("inactive");
    expect(native.showIncomingCall).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a ringing call or an open workspace", () => {
    wiring.handOverRing("background");
    engine.store.setState({ call: ringing });
    deps.workspace = null;
    wiring.handOverRing("background");
    expect(native.showIncomingCall).not.toHaveBeenCalled();
    expect(native.stopRinging).not.toHaveBeenCalled();
  });
});

describe("onAppStateChange", () => {
  it("back in the app, starts the call's service again (a start refused in the background gets another try)", () => {
    const stop = wiring.startNativeCalls();
    engine.store.setState({ call: { status: "connecting", callId: "c-7", roomId: "r-1", peerName: "Minh", outgoing: true, callKind: "dm" } });
    expect(native.startOngoingCall).toHaveBeenCalledTimes(1);
    wiring.onAppStateChange("background");
    expect(native.startOngoingCall).toHaveBeenCalledTimes(1);
    wiring.onAppStateChange("active");
    expect(native.startOngoingCall).toHaveBeenCalledTimes(2);
    expect(native.startOngoingCall).toHaveBeenLastCalledWith(expect.objectContaining({ callId: "c-7" }));
    stop();
    engine.store.setState({ call: { status: "idle" } });
  });

  it("still hands a ringing call back to the call screen", () => {
    engine.store.setState({ call: { status: "incoming", callId: "c-1", roomId: "r-1", peerName: "Minh", callKind: "dm" } });
    wiring.onAppStateChange("active");
    expect(native.startRinging).toHaveBeenCalledTimes(1);
    expect(native.startOngoingCall).not.toHaveBeenCalled();
  });
});

describe("the native ring path", () => {
  it("is configured at start with the switch and the app's words, and counts what it rang meanwhile", () => {
    native.takeRingReports.mockReturnValueOnce([{ result: "cleared", latencyMs: -1 }]);
    const stop = wiring.startNativeCalls();
    expect(native.configureRing).toHaveBeenCalledTimes(1);
    // On from the start, whatever the session is doing: a session still restoring never silences a ring.
    expect(native.configureRing).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, scheme: "uniworkchat" }));
    expect(analytics.track).toHaveBeenCalledWith({ name: "call_push", result: "cleared" });
    // The server turns calling off: the next answer of the remote-config query turns native rings off.
    deps.callsOn = false;
    deps.cacheListener({ query: { queryKey: ["chat", "w-1"] } });
    expect(native.configureRing).toHaveBeenCalledTimes(1);
    deps.cacheListener({ query: { queryKey: ["remote-config"] } });
    expect(native.configureRing).toHaveBeenCalledTimes(2);
    expect(native.configureRing).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    // A group call declined on screen is declined on the server too.
    engine.store.setState({ call: { status: "incoming", callId: "g-1", roomId: "r-9", peerName: "Đội", callKind: "group" } });
    engine.store.setState({ call: { status: "idle" } });
    expect(deps.signalVoiceDecline).toHaveBeenCalledWith("w-1", "r-9", "g-1");
    stop();
    expect(deps.offCache).toHaveBeenCalledTimes(1);
  });

  it("is written again on a return to the app and when the language changes, and counts rings on the way back", () => {
    const listener = vi.fn();
    const stop = wiring.ringSyncEnv.subscribe(listener);
    const calls = rn.AppState.addEventListener.mock.calls as unknown as [string, (status: string) => void][];
    const onState = calls.at(-1)![1];
    onState("background");
    expect(listener).not.toHaveBeenCalled();
    onState("active");
    void i18n.changeLanguage("en");
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    void i18n.changeLanguage("vi");
    expect(listener).toHaveBeenCalledTimes(2);
    native.takeRingReports.mockReturnValueOnce([{ result: "native", latencyMs: 300 }]);
    wiring.onAppStateChange("active");
    expect(analytics.track).toHaveBeenCalledWith({ name: "call_ring", result: "native", duration_ms: 300 });
  });
});

describe("startNativeCalls", () => {
  it("follows the engine with the service, runs the taps that waited and handles pushes while open", async () => {
    deps.pending = [DECLINE, { nope: true }];
    const stop = wiring.startNativeCalls();
    await vi.waitFor(() => expect(deps.signalVoiceDecline).toHaveBeenCalledWith("w-1", "r-1", "c-1"));
    engine.store.setState({ call: { status: "connecting", callId: "c-9", roomId: "r-1", peerName: "Minh", outgoing: true, callKind: "dm" } });
    expect(native.startOngoingCall).toHaveBeenCalledWith(expect.objectContaining({ callId: "c-9", workspaceId: "w-1" }));
    expect(rn.PermissionsAndroid.check).toHaveBeenCalled();
    engine.store.setState({ call: { status: "active", callId: "c-9", roomId: "r-1", peerName: "Minh", outgoing: true, callKind: "dm", token: "t", url: "u" } });
    expect(native.startOngoingCall).toHaveBeenLastCalledWith(expect.objectContaining({ startedAt: expect.any(Number) }));
    engine.ctx = null;
    wiring.nativeCallSync.refresh(engine.store.getState().call);
    expect(native.startOngoingCall).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: "" }));
    const handler = notifications.setNotificationHandler.mock.calls[0]![0] as { handleNotification: (n: unknown) => Promise<unknown> };
    expect(await handler.handleNotification({ request: { content: { data: INVITE } } })).toMatchObject({ shouldShowBanner: true });
    expect(rn.AppState.addEventListener).toHaveBeenCalledWith("change", wiring.onAppStateChange);
    stop();
    expect(rn.AppState.addEventListener.mock.results[0]?.value.remove).toHaveBeenCalledTimes(1);
    expect(notifications.setNotificationHandler).toHaveBeenLastCalledWith(null);
    engine.store.setState({ call: { status: "idle" } });
    expect(native.stopOngoingCall).not.toHaveBeenCalled();
  });
});

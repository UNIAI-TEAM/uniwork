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
  session: { status: vi.fn(() => "signed-out"), restore: vi.fn(async () => true) },
  signalVoiceHangup: vi.fn(async () => true),
  callsOn: true,
  workspace: { orgSlug: "acme", wsSlug: "hq", wsId: "w-1" } as { orgSlug: string; wsSlug: string; wsId: string } | null,
  pending: [] as Record<string, unknown>[],
}));
vi.mock("../app-locale", () => ({ applyStoredLocale: deps.applyStoredLocale }));
vi.mock("../boot", () => ({ bootRuntime: deps.bootRuntime }));
vi.mock("../auth/flow", () => ({ authConfig: { scheme: "uniworkchat" }, session: deps.session }));
vi.mock("../chat-api", () => ({ chatApi: { signalVoiceHangup: deps.signalVoiceHangup } }));
vi.mock("../query-client", () => ({ queryClient: {} }));
vi.mock("../remote-config", () => ({ readMobileFlag: () => deps.callsOn }));
vi.mock("../stores/workspace-store", () => ({ getCurrentWorkspace: () => deps.workspace }));
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
}));
vi.mock("./native-calls", () => ({ nativeCalls: native }));

const wiring = await import("./call-wiring");

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

  it("boots the runtime and the language, then rings with the app's own notification", async () => {
    await wiring.runCallPushTask({ data: { dataString: JSON.stringify(INVITE) } });
    expect(deps.bootRuntime).toHaveBeenCalledTimes(1);
    expect(deps.applyStoredLocale).toHaveBeenCalledTimes(1);
    expect(native.ensureChannels).toHaveBeenCalledWith(expect.objectContaining({ calls: expect.any(String) }));
    expect(native.showIncomingCall).toHaveBeenCalledWith(expect.objectContaining({ openUrl: expect.stringMatching(/^uniworkchat:\/\/open\?url=/) }));
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
  });
});

describe("runCallActionTask", () => {
  it("declines a 1-1 call on the server from a closed app, signing the stored session in", async () => {
    await wiring.runCallActionTask(DECLINE);
    expect(deps.bootRuntime).toHaveBeenCalled();
    expect(deps.session.restore).toHaveBeenCalledTimes(1);
    expect(deps.signalVoiceHangup).toHaveBeenCalledWith("w-1", "r-1", "c-1");
  });

  it("uses the session already in, and gives up without one", async () => {
    deps.session.status.mockReturnValue("signed-in");
    await wiring.runCallActionTask(DECLINE);
    expect(deps.session.restore).not.toHaveBeenCalled();
    expect(deps.signalVoiceHangup).toHaveBeenCalledTimes(1);
    deps.session.status.mockReturnValue("signed-out");
    deps.session.restore.mockResolvedValueOnce(false);
    await wiring.runCallActionTask(DECLINE);
    expect(deps.signalVoiceHangup).toHaveBeenCalledTimes(1);
  });

  it("hands a call the app is in to the engine; ignores what is not an action; logs a failure", async () => {
    engine.store.setState({ call: { status: "incoming", callId: "c-1", roomId: "r-1", peerName: "Minh", callKind: "dm" } });
    await wiring.runCallActionTask(DECLINE);
    expect(engine.hangUp).toHaveBeenCalledTimes(1);
    await wiring.runCallActionTask({ action: "answer" });
    expect(engine.hangUp).toHaveBeenCalledTimes(1);
    engine.store.setState({ call: { status: "idle" } });
    deps.signalVoiceHangup.mockRejectedValueOnce(new Error("offline"));
    await expect(wiring.runCallActionTask(DECLINE)).resolves.toBeUndefined();
    deps.signalVoiceHangup.mockRejectedValueOnce("offline");
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

describe("startNativeCalls", () => {
  it("follows the engine with the service, runs the taps that waited and handles pushes while open", async () => {
    deps.pending = [DECLINE, { nope: true }];
    const stop = wiring.startNativeCalls();
    await vi.waitFor(() => expect(deps.signalVoiceHangup).toHaveBeenCalledWith("w-1", "r-1", "c-1"));
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

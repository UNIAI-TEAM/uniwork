import { describe, expect, it, vi } from "vitest";
import type { UniChatCallsModule } from "@/modules/unichat-calls";

vi.mock("@/modules/unichat-calls", () => ({ UniChatCalls: null }));

const { nativeCalls, nativeCallsFrom } = await import("./native-calls");

function fakeModule(): UniChatCallsModule {
  return {
    ensureChannels: vi.fn(),
    showIncomingCall: vi.fn(() => true),
    cancelIncomingCall: vi.fn(),
    startOngoingCall: vi.fn(() => true),
    stopOngoingCall: vi.fn(),
    startRinging: vi.fn(),
    stopRinging: vi.fn(),
    canUseFullScreenIntent: vi.fn(() => false),
    openFullScreenIntentSettings: vi.fn(),
    releaseLockScreen: vi.fn(),
    setProximityScreenOff: vi.fn(),
    takePendingActions: vi.fn(() => [{ action: "decline", callId: "c", roomId: "r", workspaceId: "w", callKind: "dm", at: 1 }]),
    takeAnsweredCall: vi.fn((callId: string) => callId === "c"),
  };
}

const INCOMING = { callId: "c", roomId: "r", workspaceId: "w", callerName: "Minh", callKind: "dm", text: "", video: false, openUrl: "x://", timeoutMs: 1, answerLabel: "", declineLabel: "" };
const ONGOING = { callId: "c", roomId: "r", workspaceId: "w", peerName: "Minh", text: "", video: false, startedAt: 0 };

describe("nativeCalls", () => {
  it("is a set of no-ops without the module (iOS, Expo Go, tests)", () => {
    expect(nativeCalls.available).toBe(false);
    nativeCalls.ensureChannels({ calls: "", callsDescription: "", ongoing: "", ongoingDescription: "" });
    expect(nativeCalls.showIncomingCall(INCOMING)).toBe(false);
    nativeCalls.cancelIncomingCall("c");
    expect(nativeCalls.startOngoingCall(ONGOING)).toBe(false);
    nativeCalls.stopOngoingCall();
    nativeCalls.startRinging();
    nativeCalls.stopRinging();
    expect(nativeCalls.canUseFullScreenIntent()).toBe(true);
    nativeCalls.openFullScreenIntentSettings();
    nativeCalls.releaseLockScreen();
    nativeCalls.setProximityScreenOff(true);
    expect(nativeCalls.takePendingActions()).toEqual([]);
    expect(nativeCalls.takeAnsweredCall("c")).toBe(false);
  });

  it("hands every call to the module itself, as its `this`", () => {
    const module = fakeModule();
    const calls = nativeCallsFrom(module);
    const names = { calls: "a", callsDescription: "b", ongoing: "c", ongoingDescription: "d" };
    expect(calls.available).toBe(true);
    calls.ensureChannels(names);
    expect(calls.showIncomingCall(INCOMING)).toBe(true);
    calls.cancelIncomingCall("c");
    expect(calls.startOngoingCall(ONGOING)).toBe(true);
    calls.stopOngoingCall();
    calls.startRinging();
    calls.stopRinging();
    expect(calls.canUseFullScreenIntent()).toBe(false);
    calls.openFullScreenIntentSettings();
    calls.releaseLockScreen();
    calls.setProximityScreenOff(true);
    expect(calls.takePendingActions()).toHaveLength(1);
    expect(calls.takeAnsweredCall("c")).toBe(true);
    expect(calls.takeAnsweredCall("other")).toBe(false);
    expect(module.ensureChannels).toHaveBeenCalledWith(names);
    expect(module.showIncomingCall).toHaveBeenCalledWith(INCOMING);
    expect(module.cancelIncomingCall).toHaveBeenCalledWith("c");
    expect(module.startOngoingCall).toHaveBeenCalledWith(ONGOING);
    expect(module.setProximityScreenOff).toHaveBeenCalledWith(true);
    expect(vi.mocked(module.setProximityScreenOff).mock.contexts[0]).toBe(module);
    for (const fn of [module.stopOngoingCall, module.startRinging, module.stopRinging, module.openFullScreenIntentSettings, module.releaseLockScreen]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fn).mock.contexts[0]).toBe(module);
    }
  });
});

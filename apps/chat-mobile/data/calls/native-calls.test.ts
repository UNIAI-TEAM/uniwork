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
    leaveLockScreen: vi.fn(async () => false),
    setProximityScreenOff: vi.fn(),
    takePendingActions: vi.fn(() => [{ action: "decline", callId: "c", roomId: "r", workspaceId: "w", callKind: "dm", at: 1 }]),
    takeAnsweredCall: vi.fn((callId: string) => callId === "c"),
    isCallHeld: vi.fn(() => true),
    addListener: vi.fn((_event: "onCallHeld", listener: (event: { held: boolean }) => void) => {
      held.push(listener);
      return { remove: removeHeld };
    }),
  };
}

const held: ((event: { held: boolean }) => void)[] = [];
const removeHeld = vi.fn();

const INCOMING = { callId: "c", roomId: "r", workspaceId: "w", callerName: "Minh", callKind: "dm", text: "", video: false, openUrl: "x://", timeoutMs: 1, answerLabel: "", declineLabel: "" };
const ONGOING = { callId: "c", roomId: "r", workspaceId: "w", peerName: "Minh", text: "", video: false, startedAt: 0 };

describe("nativeCalls", () => {
  it("is a set of no-ops without the module (iOS, Expo Go, tests)", async () => {
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
    await expect(nativeCalls.leaveLockScreen()).resolves.toBe(true);
    nativeCalls.setProximityScreenOff(true);
    expect(nativeCalls.takePendingActions()).toEqual([]);
    expect(nativeCalls.takeAnsweredCall("c")).toBe(false);
    expect(nativeCalls.isCallHeld()).toBe(false);
    nativeCalls.onCallHeld(() => undefined)();
  });

  it("hands the phone's own call taking and giving back the line to its listener, until unsubscribed", () => {
    const module = fakeModule();
    const calls = nativeCallsFrom(module);
    expect(calls.isCallHeld()).toBe(true);
    expect(vi.mocked(module.isCallHeld).mock.contexts[0]).toBe(module);
    const seen: boolean[] = [];
    const off = calls.onCallHeld((on) => seen.push(on));
    expect(module.addListener).toHaveBeenCalledWith("onCallHeld", expect.any(Function));
    held.at(-1)?.({ held: true });
    held.at(-1)?.({ held: false });
    // A malformed event reads as not held.
    held.at(-1)?.({} as { held: boolean });
    expect(seen).toEqual([true, false, false]);
    off();
    expect(removeHeld).toHaveBeenCalledTimes(1);
  });

  it("hands every call to the module itself, as its `this`", async () => {
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
    await expect(calls.leaveLockScreen()).resolves.toBe(false);
    expect(vi.mocked(module.leaveLockScreen).mock.contexts[0]).toBe(module);
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

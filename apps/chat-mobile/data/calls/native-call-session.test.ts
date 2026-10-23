// The one interface both halves of modules/unichat-calls implement (native-call-session.ts), on fakes of each
// module: what the app tells the system's call UI, what the system tells the app, and VoIP registration's source.
import { describe, expect, it, vi } from "vitest";
import type { UniChatCallKitModule } from "@/modules/unichat-calls";
import type { NativeCalls } from "./native-calls";

vi.mock("@/modules/unichat-calls", () => ({ UniChatCalls: null, UniChatCallKit: null }));

const { nativeCallSession, nativeCallSessionFrom, voipPush, voipPushFrom } = await import("./native-call-session");
const { nativeCalls } = await import("./native-calls");

const CALL = { callId: "c-1", roomId: "r-1", workspaceId: "w-1", orgSlug: "acme", wsSlug: "hq", callerName: "Minh", video: false };

function fakeCallKit(enabled = true) {
  const listeners: ((event: unknown) => void)[] = [];
  const remove = vi.fn();
  const module = {
    isEnabled: vi.fn(() => enabled),
    voipToken: vi.fn((): string | null => "ab12"),
    apnsEnvironment: vi.fn(() => "sandbox"),
    bundleId: vi.fn(() => "com.uniworkos.chat.dev"),
    isRinging: vi.fn(() => true),
    isHeld: vi.fn(() => true),
    takeAnswered: vi.fn((callId: string) => callId === "c-1"),
    takePendingEvents: vi.fn((): unknown[] => [{ type: "answered", ...CALL }, { type: "nonsense" }, null]),
    answer: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    addListener: vi.fn((_name: "onCallEvent", listener: (event: unknown) => void) => {
      listeners.push(listener);
      return { remove };
    }),
  } satisfies UniChatCallKitModule;
  return { module, emit: (event: unknown) => listeners.forEach((listener) => listener(event)), remove };
}

function fakeAndroid(available = true) {
  let heldListener: (held: boolean) => void = () => undefined;
  const off = vi.fn();
  const native = {
    ...nativeCalls,
    available,
    cancelIncomingCall: vi.fn(),
    isCallHeld: vi.fn(() => true),
    takeAnsweredCall: vi.fn((callId: string) => callId === "c-1"),
    onCallHeld: vi.fn((listener: (held: boolean) => void) => {
      heldListener = listener;
      return off;
    }),
  } satisfies NativeCalls;
  return { native, hold: (held: boolean) => heldListener(held), off };
}

describe("nativeCallSessionFrom", () => {
  it("is nothing without either module (tests, Expo Go)", () => {
    expect(nativeCallSession.platform).toBe("none");
    expect(voipPush).toBeNull();
    expect(nativeCallSession.ringing()).toBe(false);
    expect(nativeCallSession.isHeld()).toBe(false);
    expect(nativeCallSession.takeAnswered("c-1")).toBe(false);
    expect(nativeCallSession.takePending()).toEqual([]);
    nativeCallSession.answered("c-1");
    nativeCallSession.declined("c-1");
    nativeCallSession.ended("c-1");
    nativeCallSession.subscribe(() => undefined)();
  });

  it("picks CallKit where it exists, the Android module otherwise", () => {
    expect(nativeCallSessionFrom(fakeCallKit().module, fakeAndroid().native).platform).toBe("ios");
    expect(nativeCallSessionFrom(null, fakeAndroid().native).platform).toBe("android");
    expect(nativeCallSessionFrom(null, fakeAndroid(false).native).platform).toBe("none");
  });
});

describe("the iOS half (CallKit)", () => {
  it("answers and ends CallKit's call when the app answers, declines or ends it", () => {
    const { module } = fakeCallKit();
    const session = nativeCallSessionFrom(module, fakeAndroid().native);
    session.answered("c-1");
    session.declined("c-2");
    session.ended("c-3");
    expect(module.answer).toHaveBeenCalledWith("c-1");
    expect(module.end.mock.calls).toEqual([["c-2"], ["c-3"]]);
  });

  it("swallows a refused CallKit request (a call CallKit no longer holds)", async () => {
    const { module } = fakeCallKit();
    module.answer.mockRejectedValueOnce(new Error("gone"));
    module.end.mockRejectedValueOnce(new Error("gone"));
    const session = nativeCallSessionFrom(module, fakeAndroid().native);
    session.answered("c-1");
    session.ended("c-1");
    await Promise.resolve();
    expect(module.end).toHaveBeenCalledTimes(1);
  });

  it("reads ringing, hold and the system's answer from the module", () => {
    const session = nativeCallSessionFrom(fakeCallKit().module, fakeAndroid().native);
    expect(session.ringing()).toBe(true);
    expect(session.isHeld()).toBe(true);
    expect(session.takeAnswered("c-1")).toBe(true);
    expect(session.takeAnswered("c-2")).toBe(false);
  });

  it("hands over the events from before the app listened, dropping what it cannot read", () => {
    const session = nativeCallSessionFrom(fakeCallKit().module, fakeAndroid().native);
    expect(session.takePending()).toEqual([{ type: "answered", call: CALL }]);
  });

  it("passes on each event it can read, and stops when unsubscribed", () => {
    const { module, emit, remove } = fakeCallKit();
    const listener = vi.fn();
    const off = nativeCallSessionFrom(module, fakeAndroid().native).subscribe(listener);
    emit({ type: "declined", ...CALL });
    emit({ type: "audio", active: "yes" });
    expect(listener.mock.calls).toEqual([[{ type: "declined", call: CALL }]]);
    off();
    expect(remove).toHaveBeenCalled();
  });
});

describe("the Android half (the call notification)", () => {
  it("takes the ringing notification down when the app answers, declines or ends the call", () => {
    const { native } = fakeAndroid();
    const session = nativeCallSessionFrom(null, native);
    session.answered("c-1");
    session.declined("c-2");
    session.ended("c-3");
    expect(native.cancelIncomingCall.mock.calls).toEqual([["c-1"], ["c-2"], ["c-3"]]);
    expect(session.ringing()).toBe(false);
    expect(session.takePending()).toEqual([]);
  });

  it("reads the notification's Answer and the phone's own call from the module", () => {
    const { native, hold, off } = fakeAndroid();
    const session = nativeCallSessionFrom(null, native);
    expect(session.takeAnswered("c-1")).toBe(true);
    expect(session.isHeld()).toBe(true);
    const listener = vi.fn();
    const stop = session.subscribe(listener);
    hold(true);
    expect(listener).toHaveBeenCalledWith({ type: "held", callId: "", held: true });
    stop();
    expect(off).toHaveBeenCalled();
  });
});

describe("voipPushFrom", () => {
  it("is null without PushKit: no module, or a build without calls", () => {
    expect(voipPushFrom(null)).toBeNull();
    expect(voipPushFrom(fakeCallKit(false).module)).toBeNull();
  });

  it("reads the token, its APNs environment and the bundle id, and hears a new token", () => {
    const { module, emit, remove } = fakeCallKit();
    const source = voipPushFrom(module);
    expect(source?.token()).toBe("ab12");
    expect(source?.environment()).toBe("sandbox");
    expect(source?.bundleId()).toBe("com.uniworkos.chat.dev");
    module.voipToken.mockReturnValueOnce(null).mockReturnValueOnce("");
    expect(source?.token()).toBeNull();
    expect(source?.token()).toBeNull();
    const listener = vi.fn();
    const off = source?.onToken(listener);
    emit({ type: "answered", ...CALL });
    emit({ type: "token", token: "cd34" });
    expect(listener.mock.calls).toEqual([["cd34"]]);
    off?.();
    expect(remove).toHaveBeenCalled();
  });
});

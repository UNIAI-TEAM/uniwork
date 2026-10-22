// The native ring path's JavaScript half: the config it rings with (the switch and session, the scheme, the
// words in the app's language), written once per change; and what it did while JavaScript was not running,
// counted as product events.
import { describe, expect, it, vi } from "vitest";
import { installNativeRingSync, nativeRingConfig, reportNativeRings, type NativeRingSyncEnv } from "./native-ring";

const t = (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key);

function env(overrides: Partial<NativeRingSyncEnv> = {}) {
  let listener = () => undefined as void;
  const off = vi.fn();
  const state = { callsOn: true };
  const base: NativeRingSyncEnv = {
    native: { available: true, configureRing: vi.fn() },
    t,
    scheme: "uniworkchat",
    callsOn: () => state.callsOn,
    subscribe: (next) => {
      listener = next;
      return off;
    },
    ...overrides,
  };
  return { env: base, state, off, fire: () => listener() };
}

describe("nativeRingConfig", () => {
  it("names a ring as the JavaScript path does, the group line with the room left for the native side", () => {
    expect(nativeRingConfig(t, { enabled: true, scheme: "uniworkchat" })).toEqual({
      enabled: true,
      scheme: "uniworkchat",
      incomingVoice: "mobile.call_notify.incoming_voice",
      incomingVideo: "mobile.call_notify.incoming_video",
      incomingGroup: 'mobile.call_notify.incoming_group:{"room":"{room}"}',
      groupFallback: "mobile.call_notify.group_fallback",
      unknownCaller: "mobile.call_notify.unknown_caller",
      answerLabel: "chat.voice_call_accept",
      declineLabel: "chat.voice_call_decline",
    });
  });
});

describe("installNativeRingSync", () => {
  it("writes the config at once and again only when it changes", () => {
    const { env: e, state, fire, off } = env();
    const stop = installNativeRingSync(e);
    expect(e.native.configureRing).toHaveBeenCalledTimes(1);
    expect(e.native.configureRing).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    fire();
    expect(e.native.configureRing).toHaveBeenCalledTimes(1);
    state.callsOn = false;
    fire();
    expect(e.native.configureRing).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    fire();
    expect(e.native.configureRing).toHaveBeenCalledTimes(2);
    stop();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a build without the native module", () => {
    const subscribe = vi.fn();
    const { env: e } = env({ native: { available: false, configureRing: vi.fn() }, subscribe });
    installNativeRingSync(e)();
    expect(e.native.configureRing).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });
});

describe("reportNativeRings", () => {
  it("counts each native outcome, a ring's latency when known, and nothing it does not know", () => {
    const track = vi.fn();
    const native = {
      takeRingReports: () => [
        { result: "native", latencyMs: 1200 },
        { result: "native", latencyMs: -1 },
        { result: "ignored", latencyMs: -1 },
        { result: "cleared", latencyMs: -1 },
        { result: "from-a-newer-module", latencyMs: 5 },
      ],
    };
    reportNativeRings(native, track);
    expect(track.mock.calls.map(([event]) => event)).toEqual([
      { name: "call_push", result: "native" },
      { name: "call_ring", result: "native", duration_ms: 1200 },
      { name: "call_push", result: "native" },
      { name: "call_push", result: "ignored" },
      { name: "call_push", result: "cleared" },
    ]);
  });
});

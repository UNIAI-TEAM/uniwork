// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WSClient } from "./ws-client";
import type { WSMessage } from "./ws-types";

// A ten-line renderHook: the app has no DOM renderer, and the hook only
// needs refs that survive a re-render and effects that re-run on dep change.
const harness = vi.hoisted(() => {
  type Effect = { fn: () => void | (() => void); deps?: readonly unknown[]; cleanup?: () => void; ran?: readonly unknown[] };
  const refs: { current: unknown }[] = [];
  const effects: Effect[] = [];
  let refIndex = 0;
  let effectIndex = 0;
  return {
    useRef: (initial: unknown) => (refs[refIndex++] ??= { current: initial }),
    useEffect: (fn: Effect["fn"], deps?: readonly unknown[]) => {
      const slot = (effects[effectIndex++] ??= { fn });
      slot.fn = fn;
      slot.deps = deps;
    },
    render<P>(hook: (props: P) => void, props: P) {
      refIndex = 0;
      effectIndex = 0;
      hook(props);
      for (const effect of effects) {
        const same = effect.ran && effect.deps?.every((d, i) => Object.is(d, effect.ran![i]));
        if (same) continue;
        effect.cleanup?.();
        effect.cleanup = effect.fn() ?? undefined;
        effect.ran = effect.deps;
      }
    },
    unmount() {
      for (const effect of effects) effect.cleanup?.();
      refs.length = 0;
      effects.length = 0;
    },
  };
});

vi.mock("react", () => ({ useEffect: harness.useEffect, useRef: harness.useRef }));

const listeners = new Set<(msg: WSMessage) => void>();
const reconnectListeners = new Set<() => void>();
const subscribe = vi.fn();
const unsubscribe = vi.fn();
const client = {
  subscribe,
  unsubscribe,
  onAny: (handler: (msg: WSMessage) => void) => {
    listeners.add(handler);
    return () => listeners.delete(handler);
  },
  onReconnect: (handler: () => void) => {
    reconnectListeners.add(handler);
    return () => reconnectListeners.delete(handler);
  },
} as unknown as WSClient;
let current: WSClient | null = client;

vi.mock("./realtime-provider", () => ({ useWSClient: () => current }));

const { LOOKUP_RETRY_DELAYS_MS, lookupRetryDelayMs, useChatScopes } = await import("./use-chat-scopes");

function emit(type: string, payload: unknown) {
  for (const handler of [...listeners]) handler({ type, payload });
}

const render = (ids: readonly string[]) => harness.render(useChatScopes, ids);

describe("useChatScopes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    current = client;
    subscribe.mockClear();
    unsubscribe.mockClear();
  });

  afterEach(() => {
    harness.unmount();
    listeners.clear();
    reconnectListeners.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("diffs subscriptions when the room set changes", () => {
    render(["a", "b"]);
    expect(subscribe.mock.calls).toEqual([["chat", "a"], ["chat", "b"]]);

    subscribe.mockClear();
    render(["b", "c"]);
    expect(unsubscribe.mock.calls).toEqual([["chat", "a"]]);
    expect(subscribe.mock.calls).toEqual([["chat", "c"]]);

    // Same set in another order: no churn.
    subscribe.mockClear();
    unsubscribe.mockClear();
    render(["c", "b"]);
    expect(subscribe).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();

    render([]);
    expect(unsubscribe.mock.calls).toEqual([["chat", "b"], ["chat", "c"]]);
    unsubscribe.mockClear();
    harness.unmount();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("unsubscribes every active room on unmount", () => {
    render(["a", "b"]);
    harness.unmount();
    expect(unsubscribe.mock.calls).toEqual([["chat", "a"], ["chat", "b"]]);
    expect(listeners.size).toBe(0);
    expect(reconnectListeners.size).toBe(0);
  });

  it("retries a lookup_failed subscribe with the backoff table and stops after it", () => {
    render(["a"]);
    subscribe.mockClear();

    emit("subscribe_error", { scope: "chat", id: "a", error: "lookup_failed" });
    // Duplicate error while a retry is pending does not stack timers.
    emit("subscribe_error", { scope: "chat", id: "a", error: "lookup_failed" });
    vi.advanceTimersByTime(1_999);
    expect(subscribe).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(subscribe.mock.calls).toEqual([["chat", "a"]]);

    for (const delay of LOOKUP_RETRY_DELAYS_MS.slice(1)) {
      subscribe.mockClear();
      emit("subscribe_error", { scope: "chat", id: "a", error: "lookup_failed" });
      vi.advanceTimersByTime(delay);
      expect(subscribe.mock.calls).toEqual([["chat", "a"]]);
    }

    // The table ran out: the next reconnect replays it instead.
    subscribe.mockClear();
    emit("subscribe_error", { scope: "chat", id: "a", error: "lookup_failed" });
    vi.advanceTimersByTime(60_000);
    expect(subscribe).not.toHaveBeenCalled();

    for (const handler of reconnectListeners) handler();
    emit("subscribe_error", { scope: "chat", id: "a", error: "lookup_failed" });
    vi.advanceTimersByTime(2_000);
    expect(subscribe.mock.calls).toEqual([["chat", "a"]]);
  });

  it("a reconnect replays every scope, so pending retries are dropped", () => {
    render(["a"]);
    subscribe.mockClear();
    emit("subscribe_error", { scope: "chat", id: "a", error: "lookup_failed" });
    for (const handler of reconnectListeners) handler();
    vi.advanceTimersByTime(60_000);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("an ack clears the retry; forbidden, other scopes and unknown rooms are ignored", () => {
    render(["a"]);
    subscribe.mockClear();

    emit("subscribe_error", { scope: "chat", id: "a", error: "forbidden" });
    emit("subscribe_error", { scope: "chat", id: "zzz", error: "lookup_failed" });
    emit("subscribe_error", { scope: "meeting", id: "a", error: "lookup_failed" });
    emit("subscribe_error", { scope: "chat", id: 7, error: "lookup_failed" });
    emit("subscribe_error", null);
    emit("subscribe_error", { scope: "chat", id: "a" });
    emit("chat.message.created", { scope: "chat", id: "a" });
    vi.advanceTimersByTime(60_000);
    expect(subscribe).not.toHaveBeenCalled();

    emit("subscribe_error", { scope: "chat", id: "a", error: "lookup_failed" });
    emit("subscribe_ack", { scope: "chat", id: "a" });
    // The pending timer still fires once, then the attempt counter starts over.
    vi.advanceTimersByTime(2_000);
    expect(subscribe.mock.calls).toEqual([["chat", "a"]]);
    subscribe.mockClear();
    emit("subscribe_error", { scope: "chat", id: "a", error: "lookup_failed" });
    vi.advanceTimersByTime(2_000);
    expect(subscribe.mock.calls).toEqual([["chat", "a"]]);
  });

  it("drops the retry when the room leaves the set before the timer fires", () => {
    render(["a", "b"]);
    subscribe.mockClear();
    emit("subscribe_error", { scope: "chat", id: "a", error: "lookup_failed" });
    emit("subscribe_error", { scope: "chat", id: "b", error: "lookup_failed" });

    render(["b"]);
    expect(unsubscribe.mock.calls).toEqual([["chat", "a"]]);
    vi.advanceTimersByTime(2_000);
    expect(subscribe.mock.calls).toEqual([["chat", "b"]]);

    // A room that left after its timer was armed is not resubscribed.
    emit("subscribe_error", { scope: "chat", id: "b", error: "lookup_failed" });
    render([]);
    vi.advanceTimersByTime(60_000);
    expect(subscribe.mock.calls).toEqual([["chat", "b"]]);
  });

  it("does nothing without a client and resubscribes when one arrives", () => {
    current = null;
    render(["a"]);
    expect(subscribe).not.toHaveBeenCalled();

    current = client;
    render(["a"]);
    expect(subscribe.mock.calls).toEqual([["chat", "a"]]);

    current = null;
    render(["a"]);
    expect(unsubscribe.mock.calls).toEqual([["chat", "a"]]);
  });
});

describe("lookupRetryDelayMs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("jitters ±20 % around the table and clamps the attempt to its last row", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(lookupRetryDelayMs(0)).toBe(1_600);
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(lookupRetryDelayMs(1)).toBe(6_000);
    expect(lookupRetryDelayMs(99)).toBe(36_000);
  });
});

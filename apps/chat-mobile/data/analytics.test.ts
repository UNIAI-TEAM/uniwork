import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";

const appState = vi.hoisted(() => ({ currentState: "active", listener: null as ((state: string) => void) | null, remove: vi.fn() }));
const apiMock = vi.hoisted(() => ({ request: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>() }));
const sends = vi.hoisted(() => ({ observer: null as ((outcome: "sent" | "failed", ms: number) => void) | null, stop: vi.fn() }));
const crumbs = vi.hoisted(() => [] as string[]);

vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
    addEventListener: (_: string, listener: (state: string) => void) => {
      appState.listener = listener;
      return { remove: appState.remove };
    },
  },
}));
vi.mock("./api", () => ({ api: apiMock }));
vi.mock("./chat-send", () => ({
  observeChatSends: (observer: (outcome: "sent" | "failed", ms: number) => void) => {
    sends.observer = observer;
    return sends.stop;
  },
}));
const callStore = vi.hoisted(() => ({ store: null as unknown }));
vi.mock("./calls/call-store", async () => {
  const { createStore: create } = await import("zustand/vanilla");
  callStore.store = create(() => ({ call: { status: "idle" } as Record<string, unknown> }));
  return { callEngine: { store: callStore.store } };
});
vi.mock("./report", async (original) => ({
  ...(await original<typeof import("./report")>()),
  bestEffort: (_scope: string, what: string) => () => void crumbs.push(what),
}));

import { BATCH_SIZE, FLUSH_EVERY_MS, MAX_QUEUE, createAnalytics, pushOpenResult, startAnalytics, track, type ProductEvent } from "./analytics";

type CallState = StoreApi<{ call: Record<string, unknown> }>;
const calls = () => callStore.store as CallState;
const sentBodies = () => apiMock.request.mock.calls.map(([path, init]) => ({ path, method: init?.method, events: JSON.parse(String(init?.body)).events as ProductEvent[] }));

beforeEach(() => {
  crumbs.splice(0);
  apiMock.request.mockReset().mockResolvedValue(undefined);
});

describe("createAnalytics", () => {
  const open: ProductEvent = { name: "app_open", result: "cold" };

  it("sends what is queued in batches, once signed in, and keeps at most MAX_QUEUE events", async () => {
    const send = vi.fn(async (_batch: ProductEvent[]) => undefined);
    let signedIn = false;
    const sink = createAnalytics({ send, enabled: () => true, signedIn: () => signedIn });
    for (let i = 0; i < MAX_QUEUE + 5; i++) sink.track({ name: "message_send", result: "sent", duration_ms: i });
    expect(sink.pending()).toBe(MAX_QUEUE);
    await sink.flush();
    expect(send).not.toHaveBeenCalled();
    signedIn = true;
    await sink.flush();
    expect(send.mock.calls.map(([batch]) => batch.length)).toEqual([BATCH_SIZE, BATCH_SIZE, BATCH_SIZE]);
    // The oldest were dropped: the first kept is the sixth written.
    expect(send.mock.calls[0]?.[0][0]).toEqual({ name: "message_send", result: "sent", duration_ms: 5 });
    expect(sink.pending()).toBe(0);
    await sink.flush();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("records nothing, and drops what waits, once the person turns the counters off", async () => {
    const send = vi.fn(async () => undefined);
    let enabled = true;
    const sink = createAnalytics({ send, enabled: () => enabled, signedIn: () => true });
    sink.track(open);
    enabled = false;
    sink.track(open);
    expect(sink.pending()).toBe(1);
    await sink.flush();
    expect(sink.pending()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends one flush at a time, and a failed batch is a breadcrumb, never a retry", async () => {
    let release: () => void = () => undefined;
    const send = vi.fn(() => new Promise<unknown>((resolve) => (release = () => resolve(undefined))));
    const sink = createAnalytics({ send, enabled: () => true, signedIn: () => true });
    sink.track(open);
    const first = sink.flush();
    // An event written while a batch is on the wire joins the flush under way, not a second one.
    sink.track(open);
    const second = sink.flush();
    expect(second).toBe(first);
    expect(send).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    release();
    await first;
    send.mockImplementationOnce(() => Promise.reject(new TypeError("Network request failed")));
    sink.track(open);
    await sink.flush();
    expect(crumbs).toEqual(["batch not sent"]);
    expect(sink.pending()).toBe(0);
  });
});

describe("pushOpenResult", () => {
  it("tells a call push from a chat push by what the server put in it", () => {
    expect(pushOpenResult({ type: "call_invite", call_id: "c1", room_id: "r1" })).toBe("call");
    expect(pushOpenResult({ room_id: "r1", message_id: "m1", url: "https://app/x" })).toBe("chat");
    expect(pushOpenResult({ url: "https://app/x" })).toBe("other");
    expect(pushOpenResult(null)).toBe("other");
    expect(pushOpenResult("x")).toBe("other");
  });
});

describe("startAnalytics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appState.currentState = "active";
    calls().setState({ call: { status: "idle" } });
  });
  afterEach(() => vi.useRealTimers());

  it("counts the cold open and what came before it, a warm one after the background, and flushes on the way out and every minute", async () => {
    track({ name: "push_open", result: "chat" });
    let now = 0;
    const stop = startAnalytics({ enabled: () => true, signedIn: () => true }, () => now);
    appState.listener?.("inactive");
    appState.listener?.("background");
    await vi.advanceTimersByTimeAsync(0);
    expect(sentBodies()).toEqual([{ path: "/api/v1/mobile/events", method: "POST", events: [{ name: "push_open", result: "chat" }, { name: "app_open", result: "cold" }] }]);
    appState.listener?.("active");
    appState.listener?.("active");
    sends.observer?.("sent", 420);
    sends.observer?.("failed", 0);
    track({ name: "first_screen", result: "ok", duration_ms: 900 });
    // A call: connecting, then connected 2.1 s later; another that never connects.
    calls().setState({ call: { status: "connecting" } });
    now = 2_100;
    calls().setState({ call: { status: "active" } });
    calls().setState({ call: { status: "active", muted: true } });
    calls().setState({ call: { status: "idle" } });
    calls().setState({ call: { status: "connecting" } });
    calls().setState({ call: { status: "ended", reason: "start_failed" } });
    calls().setState({ call: { status: "connecting" } });
    calls().setState({ call: { status: "ended", reason: "declined" } });
    calls().setState({ call: { status: "active" } });
    appState.currentState = "background";
    await vi.advanceTimersByTimeAsync(FLUSH_EVERY_MS);
    expect(apiMock.request).toHaveBeenCalledTimes(1);
    appState.currentState = "active";
    await vi.advanceTimersByTimeAsync(FLUSH_EVERY_MS);
    expect(sentBodies()[1]?.events).toEqual([
      { name: "app_open", result: "warm" },
      { name: "message_send", result: "sent", duration_ms: 420 },
      { name: "message_send", result: "failed" },
      { name: "first_screen", result: "ok", duration_ms: 900 },
      { name: "call_connect", result: "connected", duration_ms: 2_100 },
      { name: "call_connect", result: "failed" },
    ]);
    stop();
    expect(appState.remove).toHaveBeenCalled();
    expect(sends.stop).toHaveBeenCalled();
    // After teardown an event waits for the next sink.
    track({ name: "app_open", result: "warm" });
    calls().setState({ call: { status: "connecting" } });
    const again = startAnalytics({ enabled: () => true, signedIn: () => true });
    appState.listener?.("background");
    await vi.advanceTimersByTimeAsync(0);
    expect(sentBodies()[2]?.events).toEqual([{ name: "app_open", result: "warm" }, { name: "app_open", result: "cold" }]);
    again();
  });

  it("keeps at most MAX_QUEUE events before the sink is wired", async () => {
    for (let i = 0; i < MAX_QUEUE + 3; i++) track({ name: "app_open", result: "warm" });
    const stop = startAnalytics({ enabled: () => true, signedIn: () => true });
    appState.listener?.("background");
    await vi.advanceTimersByTimeAsync(0);
    expect(sentBodies().flatMap((b) => b.events)).toHaveLength(MAX_QUEUE);
    stop();
  });
});

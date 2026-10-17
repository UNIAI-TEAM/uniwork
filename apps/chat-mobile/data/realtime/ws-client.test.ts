// @vitest-environment node
// Ported from usf apps/mobile/data/realtime/ws-client.test.ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WSClient, type WSClientOptions } from "./ws-client";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event?: { code?: number }) => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  send(frame: string) {
    this.sent.push(frame);
  }

  close(code?: number) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(code === undefined ? undefined : { code });
  }

  frames(): unknown[] {
    return this.sent.map((frame) => JSON.parse(frame) as unknown);
  }
}

const latest = () => MockWebSocket.instances[MockWebSocket.instances.length - 1]!;

function makeClient(overrides: Partial<WSClientOptions> = {}) {
  return new WSClient({
    url: "wss://example.test/ws",
    getToken: () => "token",
    workspaceSlug: "org/ws",
    clientOs: "ios",
    ...overrides,
  });
}

function connectAuthenticatedClient(overrides: Partial<WSClientOptions> = {}) {
  const client = makeClient(overrides);
  client.connect();
  const socket = MockWebSocket.instances[0]!;
  socket.open();
  socket.receive({ type: "auth_ack" });
  return { client, socket };
}

function useMockSocket() {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}

describe("WSClient application heartbeat", () => {
  useMockSocket();

  it("reconnects a stale OPEN socket through the jittered backoff path", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { client, socket } = connectAuthenticatedClient();

    expect(socket.frames()).toEqual([
      { type: "auth", payload: { token: "token" } },
      { type: "ping" },
    ]);

    // No pong arrives even though the JS-visible readyState remains OPEN.
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(1);

    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it("keeps a healthy socket connected when its pong arrives", () => {
    const { client, socket } = connectAuthenticatedClient();
    socket.receive({ type: "pong" });
    // A stray pong with nothing in flight is ignored.
    socket.receive({ type: "pong" });

    vi.advanceTimersByTime(10_000);

    expect(MockWebSocket.instances).toHaveLength(1);
    client.disconnect();
  });

  it("treats a failing send as a dead socket and backs off", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { client, socket } = connectAuthenticatedClient();
    socket.receive({ type: "pong" });
    socket.send = () => {
      throw new Error("closed");
    };

    vi.advanceTimersByTime(25_000);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    // A heartbeat failure on a client that is no longer active does nothing.
    const next = latest();
    next.open();
    next.receive({ type: "auth_ack" });
    next.send = () => {
      throw new Error("closed");
    };
    client.pause();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });
});

// A phone reconnects constantly — after every backgrounding, every network
// switch. By the time it does, the session may have been refreshed, so the
// token is read at auth-frame time, never captured at construction.
describe("WSClient token re-read", () => {
  useMockSocket();

  it("authenticates each connection with the current token", () => {
    let current = "token-v1";
    const client = makeClient({ getToken: () => current });

    client.connect();
    MockWebSocket.instances[0]!.open();
    expect(MockWebSocket.instances[0]!.frames()[0]).toEqual({
      type: "auth",
      payload: { token: "token-v1" },
    });

    current = "token-v2";
    client.forceReconnect();
    const reconnected = latest();
    reconnected.open();

    expect(reconnected.frames()[0]).toEqual({
      type: "auth",
      payload: { token: "token-v2" },
    });
    client.disconnect();
  });

  it("awaits an asynchronous token reader before sending the auth frame", async () => {
    const client = makeClient({ getToken: () => Promise.resolve("async-token") });
    client.connect();
    const socket = latest();
    socket.open();
    expect(socket.sent).toEqual([]);

    await Promise.resolve();
    expect(socket.frames()).toEqual([{ type: "auth", payload: { token: "async-token" } }]);
    client.disconnect();
  });

  it("drops the auth frame when the socket was replaced while the token resolved", async () => {
    let resolveToken: (token: string) => void = () => {};
    const client = makeClient({
      getToken: () => new Promise<string>((resolve) => { resolveToken = resolve; }),
    });
    client.connect();
    const stale = latest();
    stale.open();
    client.forceReconnect();

    resolveToken("late");
    await Promise.resolve();
    expect(stale.sent).toEqual([]);
    client.disconnect();
  });

  it("sends no auth frame without a token and lets the server close the socket", () => {
    const warn = vi.fn();
    const client = makeClient({
      getToken: () => null,
      logger: { info: vi.fn(), warn, debug: vi.fn() },
    });
    client.connect();
    latest().open();
    expect(latest().sent).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no token"));
    client.disconnect();
  });
});

describe("WSClient frame validation", () => {
  useMockSocket();

  it.each([
    null,
    false,
    42,
    "event",
    [],
    {},
    { error: "unauthorized" },
    { type: null },
    { type: 42 },
    { type: {} },
    { type: "" },
  ])("ignores invalid envelopes and still delivers the next event: %j", (frame) => {
    const { client, socket } = connectAuthenticatedClient();
    const onAny = vi.fn();
    const onCreated = vi.fn();
    client.onAny(onAny);
    client.on("chat.message.created", onCreated);

    expect(() => socket.receive(frame)).not.toThrow();
    expect(onAny).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();

    const payload = { message_id: "msg-1", room_id: "room-1", workspace_id: "ws-1" };
    const message = { type: "chat.message.created", payload, actor_id: "actor-1", actor_type: "human" };
    socket.receive(message);

    expect(onCreated).toHaveBeenCalledExactlyOnceWith(payload, "actor-1", "human");
    expect(onAny).toHaveBeenCalledExactlyOnceWith(message);
    client.disconnect();
  });

  it("ignores a non-JSON frame and keeps the handler registry intact", () => {
    const { client, socket } = connectAuthenticatedClient();
    const onCreated = vi.fn();
    const off = client.on("chat.message.created", onCreated);
    const offSecond = client.on("chat.message.created", vi.fn());
    expect(() => socket.onmessage?.({ data: "{not json" })).not.toThrow();
    // onerror is a deliberate no-op: onclose owns recovery.
    expect(() => socket.onerror?.()).not.toThrow();
    offSecond();

    off();
    socket.receive({ type: "chat.message.created", payload: {} });
    expect(onCreated).not.toHaveBeenCalled();
    client.disconnect();
  });

  it("passes subscribe_error and too_many_scopes frames to onAny untouched", () => {
    const { client, socket } = connectAuthenticatedClient();
    const onAny = vi.fn();
    client.onAny(onAny);

    const lookup = { type: "subscribe_error", payload: { scope: "chat", id: "room-1", error: "lookup_failed" } };
    const full = { type: "subscribe_error", payload: { scope: "chat", id: "room-2", error: "too_many_scopes" } };
    const ack = { type: "subscribe_ack", payload: { scope: "chat", id: "room-3" } };
    socket.receive(lookup);
    socket.receive(full);
    socket.receive(ack);

    expect(onAny.mock.calls).toEqual([[lookup], [full], [ack]]);
    client.disconnect();
  });
});

describe("WSClient scope subscriptions", () => {
  useMockSocket();

  it("replays subscribed scopes after the next auth_ack and skips workspace/user", () => {
    const { client, socket } = connectAuthenticatedClient();
    client.subscribe("chat", "room-1");
    client.subscribe("workspace", "ws-1");
    client.subscribe("user", "user-1");
    client.subscribe("", "room-x");
    client.subscribe("chat", "");
    expect(socket.frames().slice(2)).toEqual([
      { type: "subscribe", payload: { scope: "chat", id: "room-1" } },
      { type: "subscribe", payload: { scope: "workspace", id: "ws-1" } },
      { type: "subscribe", payload: { scope: "user", id: "user-1" } },
    ]);

    client.forceReconnect();
    const next = latest();
    next.open();
    next.receive({ type: "auth_ack" });
    expect(next.frames()).toEqual([
      { type: "auth", payload: { token: "token" } },
      { type: "ping" },
      { type: "subscribe", payload: { scope: "chat", id: "room-1" } },
    ]);
    client.disconnect();
  });

  it("unsubscribe removes the scope from the replay set", () => {
    const { client, socket } = connectAuthenticatedClient();
    client.subscribe("chat", "room-1");
    client.subscribe("chat", "room-2");
    client.unsubscribe("chat", "room-1");
    client.unsubscribe("meeting", "never-subscribed");
    client.unsubscribe("", "room-2");
    expect(socket.frames().slice(4)).toEqual([
      { type: "unsubscribe", payload: { scope: "chat", id: "room-1" } },
      { type: "unsubscribe", payload: { scope: "meeting", id: "never-subscribed" } },
    ]);

    client.forceReconnect();
    const next = latest();
    next.open();
    next.receive({ type: "auth_ack" });
    expect(next.frames().slice(2)).toEqual([
      { type: "subscribe", payload: { scope: "chat", id: "room-2" } },
    ]);
    client.disconnect();
  });

  it("refuses a 26th chat scope locally without sending a frame", () => {
    const warn = vi.fn();
    const { client, socket } = connectAuthenticatedClient({
      logger: { info: vi.fn(), warn, debug: vi.fn() },
    });
    for (let i = 0; i < 25; i++) client.subscribe("chat", `room-${i}`);
    const before = socket.sent.length;

    client.subscribe("chat", "room-25");
    expect(socket.sent).toHaveLength(before);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("scope cap"), "chat", "room-25");

    // A repeat of a held scope and another scope type are not capped.
    client.subscribe("chat", "room-0");
    client.subscribe("meeting", "meeting-1");
    expect(socket.sent).toHaveLength(before + 2);
    client.disconnect();
  });

  it("queues nothing on a socket that is not open", () => {
    const client = makeClient();
    client.connect();
    client.subscribe("chat", "room-1");
    expect(latest().sent).toEqual([]);
    expect(client.isAuthenticated()).toBe(false);

    latest().open();
    latest().receive({ type: "auth_ack" });
    expect(client.isAuthenticated()).toBe(true);
    expect(latest().frames().slice(2)).toEqual([
      { type: "subscribe", payload: { scope: "chat", id: "room-1" } },
    ]);
    client.disconnect();
    expect(client.isAuthenticated()).toBe(false);
  });
});

describe("WSClient session end (close 4001)", () => {
  useMockSocket();

  it("hands the 4001 to onSessionEnded once and resubscribes with the new token on forceReconnect", () => {
    let token = "v1";
    const onSessionEnded = vi.fn();
    const onReconnect = vi.fn();
    const { client, socket } = connectAuthenticatedClient({
      getToken: () => token,
      onSessionEnded,
    });
    client.onReconnect(onReconnect);
    client.subscribe("chat", "room-1");

    socket.close(4001);
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    expect(client.isAuthenticated()).toBe(false);
    // The host owns the recovery: no self-redial with the dead token.
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);

    token = "v2";
    client.forceReconnect();
    expect(MockWebSocket.instances).toHaveLength(2);
    const next = latest();
    next.open();
    expect(next.frames()[0]).toEqual({ type: "auth", payload: { token: "v2" } });
    next.receive({ type: "auth_ack" });
    expect(next.frames().filter((f) => (f as { type: string }).type === "subscribe")).toEqual([
      { type: "subscribe", payload: { scope: "chat", id: "room-1" } },
    ]);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    client.disconnect();
  });

  it.each([1006, 1012])("close %i does not end the session and reconnects through the jitter backoff", (code) => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const onSessionEnded = vi.fn();
    const { client, socket } = connectAuthenticatedClient({ onSessionEnded });

    socket.close(code);
    expect(onSessionEnded).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
    // attempt 1: ceiling 2s, jitter 0.5 → 1s
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    // attempt 2: ceiling 4s → 2s
    latest().close(code);
    vi.advanceTimersByTime(1_999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);
    client.disconnect();
  });

  it("4001 while the app is paused schedules nothing; resume opens exactly one socket", () => {
    const onSessionEnded = vi.fn();
    const { client, socket } = connectAuthenticatedClient({ onSessionEnded });

    socket.close(4001);
    client.pause();
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);

    client.resume();
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    client.disconnect();
  });

  it("ignores a close event from a socket it already discarded", () => {
    const onSessionEnded = vi.fn();
    const { client, socket } = connectAuthenticatedClient({ onSessionEnded });
    const onclose = socket.onclose!;
    client.forceReconnect();
    onclose({ code: 4001 });
    expect(onSessionEnded).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });
});

describe("WSClient identity", () => {
  useMockSocket();

  it("reports client_os/client_platform from the options on the upgrade URL", () => {
    const client = makeClient({ clientOs: "android", clientVersion: "1.2.3" });
    client.connect();
    const url = new URL(latest().url);
    expect(url.searchParams.get("client_os")).toBe("android");
    expect(url.searchParams.get("client_platform")).toBe("mobile");
    expect(url.searchParams.get("client_version")).toBe("1.2.3");
    expect(url.searchParams.get("workspace_slug")).toBe("org/ws");
    expect(url.searchParams.has("token")).toBe(false);
    client.disconnect();

    const tablet = makeClient({ clientPlatform: "tablet" });
    tablet.connect();
    const tabletUrl = new URL(latest().url);
    expect(tabletUrl.searchParams.get("client_platform")).toBe("tablet");
    expect(tabletUrl.searchParams.has("client_version")).toBe(false);
    tablet.disconnect();
  });

  it("never imports react-native, so the module runs under node", () => {
    const source = fs.readFileSync(path.join(__dirname, "ws-client.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'](?:react-native|expo-)/);
  });
});

describe("WSClient foreground recovery", () => {
  useMockSocket();

  it.each(["paused", "active"])("opens one fresh socket on returning from %s", (state) => {
    const { client, socket } = connectAuthenticatedClient();
    const onReconnect = vi.fn();
    client.onReconnect(onReconnect);
    if (state === "paused") client.pause();

    client.resume();

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    expect(onReconnect).not.toHaveBeenCalled();
    const resumed = MockWebSocket.instances[1]!;
    resumed.open();
    resumed.receive({ type: "auth_ack" });
    resumed.receive({ type: "pong" });
    expect(onReconnect).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_001);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it("cancels a pending reconnect when returning to the foreground", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { client, socket } = connectAuthenticatedClient();
    socket.close();

    client.resume();

    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(2_000);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it("does not resume after disconnect or wake a paused client on a network edge", () => {
    const { client } = connectAuthenticatedClient();
    client.connect();
    client.pause();
    client.pause();
    client.forceReconnect();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);

    client.disconnect();
    client.resume();
    client.forceReconnect();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("survives a reconnect callback that throws and a close() that throws", () => {
    const warn = vi.fn();
    const { client, socket } = connectAuthenticatedClient({
      logger: { info: vi.fn(), warn, debug: vi.fn() },
    });
    const off = client.onReconnect(() => {
      throw new Error("boom");
    });
    const offAny = client.onAny(() => {});
    socket.close = () => {
      throw new Error("already closed");
    };

    client.resume();
    const next = latest();
    next.open();
    expect(() => next.receive({ type: "auth_ack" })).not.toThrow();
    expect(warn).toHaveBeenCalledWith("[ws] onReconnect callback threw", expect.any(Error));
    off();
    offAny();
    client.disconnect();
  });
});

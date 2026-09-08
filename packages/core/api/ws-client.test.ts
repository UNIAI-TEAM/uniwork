import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WSClient } from "./ws-client";

class FakeWebSocket {
  static lastUrl: string | null = null;
  static lastInstance: FakeWebSocket | null = null;
  static sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = WebSocket.OPEN;
  constructor(url: string) {
    FakeWebSocket.lastUrl = url;
    FakeWebSocket.lastInstance = this;
  }
  close() {}
  send(data: string) {
    FakeWebSocket.sent.push(data);
  }
}

describe("WSClient scoped subscribe", () => {
  beforeEach(() => {
    FakeWebSocket.lastUrl = null;
    FakeWebSocket.lastInstance = null;
    FakeWebSocket.sent = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends subscribe and unsubscribe frames for chat rooms", () => {
    const ws = new WSClient("ws://example.test/ws");
    ws.setAuth("tok", "acme/ws");
    ws.connect();
    FakeWebSocket.sent = [];

    ws.subscribe("chat", "room-1");
    expect(JSON.parse(FakeWebSocket.sent.at(-1)!)).toEqual({
      type: "subscribe",
      payload: { scope: "chat", id: "room-1" },
    });

    ws.unsubscribe("chat", "room-1");
    expect(JSON.parse(FakeWebSocket.sent.at(-1)!)).toEqual({
      type: "unsubscribe",
      payload: { scope: "chat", id: "room-1" },
    });
  });

  it("replays scoped subscriptions after reconnect", () => {
    vi.useFakeTimers();
    const ws = new WSClient("ws://example.test/ws");
    ws.setAuth("tok", "acme/ws");
    ws.connect();
    FakeWebSocket.lastInstance!.onmessage?.({
      data: JSON.stringify({ type: "auth_ack" }),
    });

    ws.subscribe("chat", "room-1");
    FakeWebSocket.sent = [];

    FakeWebSocket.lastInstance!.onclose?.();
    vi.runOnlyPendingTimers();
    FakeWebSocket.lastInstance!.onmessage?.({
      data: JSON.stringify({ type: "auth_ack" }),
    });

    const payloads = FakeWebSocket.sent.map((raw) => JSON.parse(raw));
    expect(payloads).toContainEqual({
      type: "subscribe",
      payload: { scope: "chat", id: "room-1" },
    });
    vi.useRealTimers();
  });

  it("notifies connection state listeners", () => {
    const ws = new WSClient("ws://example.test/ws");
    const states: string[] = [];
    ws.onConnectionStateChange((state) => states.push(state));

    ws.setAuth("tok", "acme/ws");
    ws.connect();
    expect(states).toContain("connecting");

    FakeWebSocket.lastInstance!.onmessage?.({
      data: JSON.stringify({ type: "auth_ack" }),
    });
    expect(states).toContain("connected");

    FakeWebSocket.lastInstance!.onclose?.();
    expect(states.at(-1)).toBe("disconnected");
  });

  it("reconnectNow starts a fresh connection attempt", () => {
    vi.useFakeTimers();
    const ws = new WSClient("ws://example.test/ws");
    ws.setAuth("tok", "acme/ws");
    ws.connect();
    FakeWebSocket.lastInstance!.onclose?.();
    FakeWebSocket.lastUrl = null;

    ws.reconnectNow();
    expect(FakeWebSocket.lastUrl).toContain("ws://example.test/ws");
    vi.useRealTimers();
  });
});

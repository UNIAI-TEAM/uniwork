import { describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../analytics", () => analytics);

const { callLinkTracker, createCallLinkTracker } = await import("./call-link");

describe("call link tracker", () => {
  it("counts a drop that recovered with how long it took, from its first notice", () => {
    let now = 1_000;
    const track = vi.fn();
    const link = createCallLinkTracker({ track, now: () => now });
    link.reconnected();
    expect(track).not.toHaveBeenCalled();
    link.reconnecting();
    now += 400;
    link.reconnecting();
    now += 1_100;
    link.reconnected();
    expect(track).toHaveBeenCalledWith({ name: "call_reconnect", result: "recovered", duration_ms: 1_500 });
  });

  it("counts a drop the room never came back from, and nothing for an ordinary hang-up", () => {
    const track = vi.fn();
    const link = createCallLinkTracker({ track, now: () => 0 });
    link.disconnected();
    expect(track).not.toHaveBeenCalled();
    link.reconnecting();
    link.disconnected();
    link.disconnected();
    expect(track.mock.calls).toEqual([[{ name: "call_reconnect", result: "dropped" }]]);
  });

  it("reports through the app's product events", () => {
    callLinkTracker.reconnecting();
    callLinkTracker.disconnected();
    expect(analytics.track).toHaveBeenCalledWith({ name: "call_reconnect", result: "dropped" });
  });
});

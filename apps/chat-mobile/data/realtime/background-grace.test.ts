// Audit "background-teardown-no-grace": an app switch no longer costs a reconnect and a resync.
import { describe, expect, it, vi } from "vitest";
import { BACKGROUND_GRACE_MS, createBackgroundGrace, type GraceSocket } from "./background-grace";
import type { ConnectionState } from "./ws-types";

function setup({ hold = false, state = "online" as ConnectionState, authenticated = true } = {}) {
  let clock = 0;
  const timers: { run: () => void; at: number; cleared: boolean }[] = [];
  const live = { state, authenticated };
  const socket = {
    pause: vi.fn(),
    resume: vi.fn(),
    probe: vi.fn(),
    getConnectionState: (): ConnectionState => live.state,
    isAuthenticated: () => live.authenticated,
  } satisfies GraceSocket;
  const holdOpen = { value: hold };
  const grace = createBackgroundGrace(socket, {
    holdOpen: () => holdOpen.value,
    now: () => clock,
    setTimer: (run, ms) => {
      const timer = { run, at: clock + ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => void ((timer as { cleared: boolean }).cleared = true),
  });
  /** Moves the clock; `fire` runs the timers that came due (false: JavaScript was suspended). */
  const advance = (ms: number, fire = true) => {
    clock += ms;
    if (!fire) return;
    for (const timer of timers) {
      if (!timer.cleared && timer.at <= clock) {
        timer.cleared = true;
        timer.run();
      }
    }
  };
  return { socket, live, grace, advance, holdOpen };
}

describe("the background grace", () => {
  it("a quick switch away and back keeps the socket, and asks it for a pong at once", () => {
    const { socket, grace, advance } = setup();
    grace.onAppState("background");
    advance(BACKGROUND_GRACE_MS - 1);
    grace.onAppState("active");
    advance(BACKGROUND_GRACE_MS);
    expect(socket.pause).not.toHaveBeenCalled();
    expect(socket.resume).not.toHaveBeenCalled();
    expect(socket.probe).toHaveBeenCalledTimes(1);
  });

  it("still away when the grace runs out: paused, and the return opens one fresh socket", () => {
    const { socket, live, grace, advance } = setup();
    grace.onAppState("background");
    // A second background event does not restart the grace.
    advance(10_000);
    grace.onAppState("background");
    advance(BACKGROUND_GRACE_MS - 10_000);
    expect(socket.pause).toHaveBeenCalledTimes(1);
    live.state = "offline";
    live.authenticated = false;
    grace.onAppState("active");
    expect(socket.resume).toHaveBeenCalledTimes(1);
    expect(socket.probe).not.toHaveBeenCalled();
  });

  it("away past the grace while JavaScript was suspended (no pause ran): the socket left is replaced", () => {
    const { socket, grace, advance } = setup();
    grace.onAppState("background");
    advance(5 * 60_000, false);
    grace.onAppState("active");
    expect(socket.pause).not.toHaveBeenCalled();
    expect(socket.resume).toHaveBeenCalledTimes(1);
  });

  it("an inactive blip changes nothing; a return over a socket that never authenticated redials", () => {
    const { socket, grace } = setup({ authenticated: false });
    grace.onAppState("inactive");
    expect(socket.resume).not.toHaveBeenCalled();
    grace.onAppState("active");
    expect(socket.resume).toHaveBeenCalledTimes(1);
  });

  it("a call holding the socket open is never paused by it", () => {
    const { socket, grace, advance, holdOpen } = setup({ hold: true });
    grace.onAppState("background");
    advance(10 * BACKGROUND_GRACE_MS);
    expect(socket.pause).not.toHaveBeenCalled();
    grace.onAppState("active");
    expect(socket.probe).toHaveBeenCalledTimes(1);
    holdOpen.value = false;
  });

  it("dispose cancels a pending pause", () => {
    const { socket, grace, advance } = setup();
    grace.onAppState("background");
    grace.dispose();
    advance(BACKGROUND_GRACE_MS);
    expect(socket.pause).not.toHaveBeenCalled();
    grace.dispose();
  });
});

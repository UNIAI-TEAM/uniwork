import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSocketRecovery, type SocketRecoveryDeps } from "./socket-recovery";

const makeDeps = () => ({
  refreshSession: vi.fn<SocketRecoveryDeps["refreshSession"]>(),
  reconnect: vi.fn<SocketRecoveryDeps["reconnect"]>(),
  disconnect: vi.fn<SocketRecoveryDeps["disconnect"]>(),
  warn: vi.fn<SocketRecoveryDeps["warn"]>(),
});
let deps: ReturnType<typeof makeDeps>;

beforeEach(() => {
  vi.useFakeTimers();
  deps = makeDeps();
});
afterEach(() => vi.useRealTimers());

const recovery = () => createSocketRecovery({ ...deps, random: () => 0.5 });

describe("socket recovery", () => {
  it("4001 or an invalid token: a refreshed token redials, no session disconnects", async () => {
    const r = recovery();
    deps.refreshSession.mockResolvedValueOnce("t2").mockResolvedValueOnce(null);
    r.sessionEnded();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.reconnect).toHaveBeenCalledTimes(1);
    r.sessionEnded("invalid token");
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.disconnect).toHaveBeenCalledTimes(1);
  });

  it("a refresh that hits a dead spot retries on the 2/5/15/60 s backoff until it works (audit R3)", async () => {
    const r = recovery();
    deps.refreshSession.mockRejectedValueOnce(new TypeError("offline")).mockRejectedValueOnce("5xx").mockResolvedValueOnce("t2");
    r.sessionEnded();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.warn).toHaveBeenCalledWith("refresh failed after 4001, retrying", { error: "TypeError", attempt: 0 });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(deps.refreshSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.refreshSession).toHaveBeenCalledTimes(2);
    expect(deps.warn).toHaveBeenLastCalledWith("refresh failed after 4001, retrying", { error: "string", attempt: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.reconnect).toHaveBeenCalledTimes(1);
  });

  it("a server shedding connections is redialled later; another refusal waits for the next signal", async () => {
    const r = recovery();
    r.sessionEnded("too many connections");
    r.sessionEnded("too many connections");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(deps.reconnect).toHaveBeenCalledTimes(1);
    r.sessionEnded("not a member of this workspace");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(deps.reconnect).toHaveBeenCalledTimes(1);
    expect(deps.warn).toHaveBeenLastCalledWith("socket refused, waiting for the next foreground return", { error: "not a member of this workspace" });
  });

  it("back online (or unmounted), the pending retry goes and the next one starts short again", async () => {
    const r = recovery();
    r.sessionEnded("too many connections");
    r.reset();
    r.reset();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(deps.reconnect).not.toHaveBeenCalled();
    r.sessionEnded("too many connections");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(deps.reconnect).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_PRESENCE_HEARTBEAT_MS,
  acquirePresenceHeartbeat,
  resetPresenceHeartbeatCoordinatorForTests,
} from "./presence-heartbeat-coordinator";

const beatChatPresence = vi.fn<(workspaceId: string, visible: boolean) => Promise<string[] | null>>();
const signalChatPresence = vi.fn<
  (workspaceId: string, state: "online" | "offline", opts?: { keepalive?: boolean }) => Promise<boolean>
>();

vi.mock("../api/endpoints/chat-presence", () => ({
  beatChatPresence: (workspaceId: string, visible: boolean) => beatChatPresence(workspaceId, visible),
}));
vi.mock("../api/endpoints/chat", () => ({
  signalChatPresence: (
    workspaceId: string,
    state: "online" | "offline",
    opts?: { keepalive?: boolean },
  ) => signalChatPresence(workspaceId, state, opts),
}));
vi.mock("../platform/host-focus", () => ({
  isHostFocused: () => true,
}));

const LEAVE_SKIP_IF_BEAT_WITHIN_MS = 4_000;

describe("acquirePresenceHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    beatChatPresence.mockReset().mockResolvedValue([]);
    signalChatPresence.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    resetPresenceHeartbeatCoordinatorForTests();
    vi.useRealTimers();
  });

  it("beats once on first subscriber and shares one interval for two subscribers", async () => {
    beatChatPresence.mockResolvedValue(["U1"]);
    const a = vi.fn();
    const b = vi.fn();
    const releaseA = acquirePresenceHeartbeat("ws1", a);
    const releaseB = acquirePresenceHeartbeat("ws1", b);
    expect(beatChatPresence).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CHAT_PRESENCE_HEARTBEAT_MS);
    expect(beatChatPresence).toHaveBeenCalledTimes(2);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();

    releaseA();
    await vi.advanceTimersByTimeAsync(CHAT_PRESENCE_HEARTBEAT_MS);
    expect(beatChatPresence).toHaveBeenCalledTimes(3);
    releaseB();
  });

  it("skips a tick while a beat is still in flight", async () => {
    let resolve: (ids: string[]) => void = () => undefined;
    beatChatPresence.mockImplementation(
      () =>
        new Promise<string[]>((r) => {
          resolve = r;
        }),
    );
    acquirePresenceHeartbeat("ws1", vi.fn());
    expect(beatChatPresence).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CHAT_PRESENCE_HEARTBEAT_MS);
    expect(beatChatPresence).toHaveBeenCalledTimes(1);

    resolve([]);
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(CHAT_PRESENCE_HEARTBEAT_MS);
    expect(beatChatPresence).toHaveBeenCalledTimes(2);
  });

  it("leaves when the last subscriber releases", async () => {
    beatChatPresence.mockResolvedValue([]);
    const release = acquirePresenceHeartbeat("ws1", vi.fn());
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(LEAVE_SKIP_IF_BEAT_WITHIN_MS);
    release();
    await vi.advanceTimersByTimeAsync(250);
    expect(signalChatPresence).toHaveBeenCalledWith("ws1", "offline", undefined);
  });

  it("coalesces a dev remount without offline or a second beat", async () => {
    beatChatPresence.mockResolvedValue([]);
    const release = acquirePresenceHeartbeat("ws1", vi.fn());
    await vi.runOnlyPendingTimersAsync();
    const beatsBeforeRemount = beatChatPresence.mock.calls.length;
    release();
    await vi.advanceTimersByTimeAsync(250);
    expect(signalChatPresence).not.toHaveBeenCalled();
    acquirePresenceHeartbeat("ws1", vi.fn());
    expect(beatChatPresence.mock.calls.length).toBe(beatsBeforeRemount);
  });
});

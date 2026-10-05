import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMeetingLobbySync } from "./use-meeting-lobby-sync";

/** The lobby socket surface the hook uses: `on(event, handler)` returning an unsubscribe. */
const lobby = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    client: {
      on(event: string, handler: (payload: unknown) => void) {
        const set = handlers.get(event) ?? new Set<(payload: unknown) => void>();
        set.add(handler);
        handlers.set(event, set);
        return () => {
          set.delete(handler);
        };
      },
    },
    emit(event: string, payload: unknown) {
      handlers.get(event)?.forEach((h) => h(payload));
    },
    listeners(): number {
      let n = 0;
      for (const set of handlers.values()) n += set.size;
      return n;
    },
  };
});

vi.mock("./meeting-lobby-provider", () => ({
  useOptionalMeetingLobbyWS: () => ({ client: lobby.client }),
}));

function setup() {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const view = renderHook(() => useMeetingLobbySync("m1", true), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
  return { invalidate, unmount: view.unmount };
}

const keysCalled = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

const motions = JSON.stringify(["meeting-motions", "m1"]);
const tallies = JSON.stringify(["meeting-motions", "m1", "list"]);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useMeetingLobbySync › motions (guests have no workspace socket)", () => {
  it.each(["motion.created", "motion.updated", "motion.deleted", "motion.opened", "motion.closed", "participant.updated"])(
    "refreshes the guest's motions and roll on %s",
    (event) => {
      const { invalidate } = setup();
      lobby.emit(event, { meeting_id: "m1", motion_id: "mo1" });
      vi.advanceTimersByTime(250);
      expect(keysCalled(invalidate)).toContain(motions);
    },
  );

  it("refetches the tallies at most once a second while a room votes, and never the guest's own roll", () => {
    const { invalidate } = setup();
    for (let i = 0; i < 40; i++) lobby.emit("motion.ballot_cast", { meeting_id: "m1", motion_id: "mo1" });
    vi.advanceTimersByTime(999);
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(keysCalled(invalidate)).toEqual([tallies]);
    for (let i = 0; i < 40; i++) lobby.emit("motion.ballot_cast", { meeting_id: "m1", motion_id: "mo1" });
    vi.advanceTimersByTime(1000);
    expect(keysCalled(invalidate)).toEqual([tallies, tallies]);
  });

  it("ignores another meeting's motions", () => {
    const { invalidate } = setup();
    lobby.emit("motion.opened", { meeting_id: "m2", motion_id: "mo9" });
    lobby.emit("motion.ballot_cast", { meeting_id: "m2", motion_id: "mo9" });
    vi.advanceTimersByTime(2000);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("drops every listener and pending refetch on unmount", () => {
    const { invalidate, unmount } = setup();
    expect(lobby.listeners()).toBeGreaterThan(0);
    lobby.emit("motion.ballot_cast", { meeting_id: "m1", motion_id: "mo1" });
    unmount();
    expect(lobby.listeners()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("useMeetingLobbySync › the rest of the room", () => {
  it("coalesces a chat burst into one refetch", () => {
    const { invalidate } = setup();
    for (let i = 0; i < 20; i++) lobby.emit("chat.message", { meeting_id: "m1" });
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(keysCalled(invalidate)).toEqual([JSON.stringify(["meeting-chat", "m1"])]);
  });

  it.each([
    ["participant.invited", "participants"],
    ["participant.removed", "participants"],
    ["recording.started", "recordings"],
    ["recording.stopped", "recordings"],
    ["recording.ready", "recordings"],
  ])("refreshes on %s", (event, what) => {
    const { invalidate } = setup();
    lobby.emit(event, { meeting_id: "m1" });
    vi.advanceTimersByTime(250);
    expect(keysCalled(invalidate).some((k) => k.includes(what) && k.includes("m1"))).toBe(true);
  });
});

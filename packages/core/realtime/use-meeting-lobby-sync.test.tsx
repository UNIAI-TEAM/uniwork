import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useMeetingLobbySync } from "./use-meeting-lobby-sync";

/** The lobby socket surface the hook uses: `on(event, handler)` and `onReconnect(handler)`, each returning an unsubscribe. */
const lobby = vi.hoisted(() => {
  const RECONNECT = "__reconnect__";
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
      onReconnect(handler: () => void) {
        const set = handlers.get(RECONNECT) ?? new Set<(payload: unknown) => void>();
        set.add(handler);
        handlers.set(RECONNECT, set);
        return () => {
          set.delete(handler);
        };
      },
    },
    reconnect() {
      handlers.get(RECONNECT)?.forEach((h) => h(undefined));
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

describe("useMeetingLobbySync › motions (guests have no workspace socket)", () => {
  it.each([
    "motion.created",
    "motion.updated",
    "motion.deleted",
    "motion.opened",
    "motion.closed",
    "motion.ballot_cast",
    "participant.updated",
  ])("refreshes the guest's motion list on %s", (event) => {
    const { invalidate } = setup();
    lobby.emit(event, { meeting_id: "m1", motion_id: "mo1" });
    expect(keysCalled(invalidate)).toContain(motions);
  });

  it("ignores another meeting's motions", () => {
    const { invalidate } = setup();
    lobby.emit("motion.opened", { meeting_id: "m2", motion_id: "mo9" });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refreshes the guest's in-room data after the lobby socket reconnects", () => {
    const { invalidate } = setup();
    lobby.reconnect();
    expect(keysCalled(invalidate)).toEqual(
      expect.arrayContaining([
        JSON.stringify(["meeting-participants", "m1"]),
        motions,
        JSON.stringify(["meeting-chat", "m1"]),
        JSON.stringify(["meeting-recordings", "m1"]),
      ]),
    );
  });

  it("drops every listener on unmount", () => {
    const { unmount } = setup();
    expect(lobby.listeners()).toBeGreaterThan(0);
    unmount();
    expect(lobby.listeners()).toBe(0);
  });
});

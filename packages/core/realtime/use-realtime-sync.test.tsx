import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { WSClient } from "../api/ws-client";
import type { WSMessage } from "../api/ws-types";
import { useRealtimeSync } from "./use-realtime-sync";

/**
 * A stand-in for WSClient that lets the test push frames and reconnects by
 * hand. Only the surface useRealtimeSync consumes is implemented.
 */
function fakeClient() {
  const anyHandlers = new Set<(msg: WSMessage) => void>();
  const reconnectHandlers = new Set<() => void>();
  const client = {
    onAny: (h: (msg: WSMessage) => void) => {
      anyHandlers.add(h);
      return () => anyHandlers.delete(h);
    },
    onReconnect: (h: () => void) => {
      reconnectHandlers.add(h);
      return () => reconnectHandlers.delete(h);
    },
    emit: (msg: WSMessage) => anyHandlers.forEach((h) => h(msg)),
    reconnect: () => reconnectHandlers.forEach((h) => h()),
  };
  return client as unknown as WSClient & typeof client;
}

function setup() {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const client = fakeClient();
  renderHook(() => useRealtimeSync(client, "ws1"), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
  return { qc, invalidate, client };
}

const keysCalled = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

describe("useRealtimeSync", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes the task list and the task on task.updated", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "task.updated", payload: { task_id: "t1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toEqual(
      expect.arrayContaining([JSON.stringify(["tasks", "ws1"]), JSON.stringify(["task", "t1"])]),
    );
  });

  it("refreshes comments on comment.created", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "comment.created", payload: { task_id: "t1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["comments", "t1"]));
  });

  it("refreshes the meeting list on meeting.* events", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "meeting.created", payload: {} });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["meetings", "ws1"]));
  });

  it("refreshes join requests on join_request.created", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "join_request.created", payload: { meeting_id: "m1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["meeting-join-requests", "m1"]));
  });

  it("refreshes invite-link list on invite_link.revoked", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "invite_link.revoked", payload: { meeting_id: "m1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["meeting-invite-links", "m1"]));
  });

  it("ignores an event this client does not know", () => {
    const { invalidate, client } = setup();
    client.emit({ type: "agent.run_started", payload: {} });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("never writes the payload anywhere — the cache is refreshed from the API", () => {
    vi.useFakeTimers();
    const { qc, client } = setup();
    client.emit({ type: "task.updated", payload: { task_id: "t1", title: "smuggled" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(qc.getQueryData(["task", "t1"])).toBeUndefined();
  });

  it("invalidates every workspace key after a reconnect", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.reconnect();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toEqual(
      expect.arrayContaining([
        JSON.stringify(["tasks", "ws1"]),
        JSON.stringify(["meetings", "ws1"]),
        JSON.stringify(["meeting-stats", "ws1"]),
        JSON.stringify(["meeting-join-requests"]),
      ]),
    );
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { WSClient } from "../api/ws-client";
import type { WSMessage } from "../api/ws-types";
import { chatKeys } from "../chat/hooks";
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

  it("refreshes the task's activity list on task.updated", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "task.updated", payload: { task_id: "t1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    // The Activity tab reads the audit log's slice of this task, so the event
    // that changed the task made its history stale too.
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["audit", "history", "ws1", "task", "t1"]));
  });

  it("refreshes the inbox lists and the badge on notification.created", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "notification.created", payload: { notification_id: "n1", user_id: "u1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toEqual(
      expect.arrayContaining([
        JSON.stringify(["notifications", "list"]),
        JSON.stringify(["notifications", "unread-count"]),
      ]),
    );
  });

  it("refreshes comments on task.comment_added", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "task.comment_added", payload: { task_id: "t1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["comments", "t1"]));
  });

  // comment.created was renamed to task.comment_added with the catalogue. The
  // old name is accepted for one release so a client that reconnects mid-deploy
  // still refreshes.
  it("still honours the old comment.created name", () => {
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

  it("refreshes only the affected room on chat.message.created", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "chat.message.created", payload: { room_id: "dm1", message_id: "m1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toEqual(
      expect.arrayContaining([
        JSON.stringify(["chat", "rooms", "ws1"]),
        JSON.stringify(["chat", "room", "ws1"]),
        JSON.stringify(["chat", "room-messages", "ws1", "dm1"]),
      ]),
    );
    expect(keysCalled(invalidate)).not.toContain(JSON.stringify(["chat", "messages", "ws1"]));
  });

  it("refreshes workspace messages when the event targets the workspace room", () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.room("ws1"), { workspace_id: "ws1", room_id: "ws-room" });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const client = fakeClient();
    renderHook(() => useRealtimeSync(client, "ws1"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    client.emit({ type: "chat.message.created", payload: { room_id: "ws-room", message_id: "m1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["chat", "messages", "ws1"]));
  });

  it("refreshes the room list on chat.room.activity", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "chat.room.activity", payload: { room_id: "dm1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["chat", "rooms", "ws1"]));
  });

  it("invalidates workspace keys after a reconnect without every message list", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.reconnect();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toEqual(
      expect.arrayContaining([
        JSON.stringify(["tasks", "ws1"]),
        JSON.stringify(["chat", "rooms", "ws1"]),
        JSON.stringify(["chat", "room", "ws1"]),
        JSON.stringify(["meetings", "ws1"]),
        JSON.stringify(["meeting-stats", "ws1"]),
        JSON.stringify(["meeting-join-requests"]),
      ]),
    );
    expect(keysCalled(invalidate)).not.toContain(JSON.stringify(["chat", "messages", "ws1"]));
    expect(keysCalled(invalidate)).not.toContain(JSON.stringify(["chat", "room-messages", "ws1"]));
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import * as chatApi from "../api/endpoints/chat";
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

  it("invalidates Work Management list roots on task.updated via planCacheUpdate", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "task.updated", payload: { task_id: "t1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toEqual(
      expect.arrayContaining([
        JSON.stringify(["tasks", "ws1"]),
        JSON.stringify(["my-tasks", "ws1"]),
        JSON.stringify(["tasks-query", "ws1"]),
        JSON.stringify(["tasks-table", "ws1"]),
        JSON.stringify(["task", "t1"]),
        JSON.stringify(["task-children", "t1"]),
      ]),
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

  it("invalidates projects on project.created", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "project.created", payload: { project_id: "p1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toEqual(
      expect.arrayContaining([
        JSON.stringify(["projects", "ws1"]),
        JSON.stringify(["project", "ws1", "p1"]),
      ]),
    );
  });

  it("invalidates catalog statuses on task_status.created", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "task_status.created", payload: { status_id: "s1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["task-statuses", "ws1"]));
  });

  it("invalidates view prefs on task_view_preference.updated", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "task_view_preference.updated", payload: {} });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["task-view-prefs", "ws1"]));
  });

  it("invalidates subscribers on task.subscribed without writing the frame", () => {
    vi.useFakeTimers();
    const { qc, invalidate, client } = setup();
    client.emit({
      type: "task.subscribed",
      payload: { task_id: "t1", user_id: "smuggled-user" },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toEqual(
      expect.arrayContaining([
        JSON.stringify(["task", "t1"]),
        JSON.stringify(["task-subscribers", "t1"]),
      ]),
    );
    expect(qc.getQueryData(["task", "t1"])).toBeUndefined();
    expect(qc.getQueryData(["task-subscribers", "t1"])).toBeUndefined();
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

  it("refreshes AI usage and the quota line on ai.usage.updated", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "ai.usage.updated", payload: { organization_id: "o1", workspace_id: "ws1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toEqual(
      expect.arrayContaining([
        JSON.stringify(["ai", "usage"]),
        JSON.stringify(["ai", "capabilities", "ws1"]),
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

  it("patches room messages on chat.message.created without list invalidation", async () => {
    vi.useFakeTimers();
    vi.spyOn(chatApi, "getChatRoomMessage").mockResolvedValue({
      id: "m1",
      room_id: "dm1",
      workspace_id: "ws1",
      sender_id: "u2",
      sender_display_name: "Bob",
      kind: "text",
      body: "hi",
      created_at: "2026-01-01T10:00:00Z",
      pinned: false,
      mentioned_user_ids: [],
      reactions: {},
      reply_count: 0,
      thread_unread: false,
    });
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.roomMessages("ws1", "dm1"), []);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const client = fakeClient();
    renderHook(() => useRealtimeSync(client, "ws1"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    client.emit({ type: "chat.message.created", payload: { room_id: "dm1", message_id: "m1" } });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(qc.getQueryData<chatApi.ChatMessageRecord[]>(chatKeys.roomMessages("ws1", "dm1"))).toHaveLength(1);
    vi.useRealTimers();
  });

  it("patches workspace messages when the event targets the workspace room", async () => {
    vi.useFakeTimers();
    vi.spyOn(chatApi, "getChatRoomMessage").mockResolvedValue({
      id: "m1",
      room_id: "ws-room",
      workspace_id: "ws1",
      sender_id: "u2",
      sender_display_name: "Bob",
      kind: "text",
      body: "hi",
      created_at: "2026-01-01T10:00:00Z",
      pinned: false,
      mentioned_user_ids: [],
      reactions: {},
      reply_count: 0,
      thread_unread: false,
    });
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.room("ws1"), { workspace_id: "ws1", room_id: "ws-room" });
    qc.setQueryData(chatKeys.messages("ws1"), []);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const client = fakeClient();
    renderHook(() => useRealtimeSync(client, "ws1"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    client.emit({ type: "chat.message.created", payload: { room_id: "ws-room", message_id: "m1" } });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(qc.getQueryData<chatApi.ChatMessageRecord[]>(chatKeys.messages("ws1"))).toHaveLength(1);
    vi.useRealTimers();
  });

  it("routes chat.thread.replied into the thread cache, not the main timeline", async () => {
    vi.useFakeTimers();
    vi.spyOn(chatApi, "getChatRoomMessage").mockResolvedValue({
      id: "r1",
      room_id: "dm1",
      workspace_id: "ws1",
      sender_id: "u2",
      sender_display_name: "Bob",
      kind: "text",
      body: "thread reply",
      thread_root_id: "root1",
      created_at: "2026-01-01T10:01:00Z",
      pinned: false,
      mentioned_user_ids: [],
      reactions: {},
      reply_count: 0,
      thread_unread: false,
    });
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.roomMessages("ws1", "dm1"), [
      {
        id: "root1",
        room_id: "dm1",
        workspace_id: "ws1",
        sender_id: "u1",
        sender_display_name: "Ada",
        kind: "text",
        body: "root",
        created_at: "2026-01-01T10:00:00Z",
        pinned: false,
        mentioned_user_ids: [],
        reactions: {},
        reply_count: 0,
        thread_unread: false,
      },
    ]);
    const client = fakeClient();
    renderHook(() => useRealtimeSync(client, "ws1"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    client.emit({
      type: "chat.thread.replied",
      payload: { room_id: "dm1", thread_root_id: "root1", message_id: "r1" },
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(
      qc.getQueryData<chatApi.ChatMessageRecord[]>(chatKeys.roomMessages("ws1", "dm1"))?.map((m) => m.id),
    ).toEqual(["root1"]);
    expect(
      qc.getQueryData<chatApi.ChatMessageRecord[]>(chatKeys.roomMessages("ws1", "dm1"))?.[0]?.reply_count,
    ).toBe(1);
    expect(
      qc.getQueryData<chatApi.ChatMessageRecord[]>(chatKeys.threadMessages("ws1", "dm1", "root1")),
    ).toHaveLength(1);
    vi.useRealTimers();
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
        JSON.stringify(["my-tasks", "ws1"]),
        JSON.stringify(["tasks-query", "ws1"]),
        JSON.stringify(["tasks-table", "ws1"]),
        JSON.stringify(["task-statuses", "ws1"]),
        JSON.stringify(["projects", "ws1"]),
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

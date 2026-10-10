import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import * as chatApi from "../api/endpoints/chat";
import type { WSClient } from "../api/ws-client";
import type { WSMessage } from "../api/ws-types";
import { chatKeys } from "../chat/hooks";
import { flattenRoomTimeline, type RoomTimeline } from "../chat/room-timeline";
import { graphKeys } from "../graph/keys";
import type { Task } from "../types/task";
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

const timelineRows = (qc: QueryClient, roomId: string) => {
  const data = qc.getQueryData<RoomTimeline>(chatKeys.roomMessages("ws1", roomId));
  return data ? flattenRoomTimeline(data) : [];
};

const keysCalled = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

/** A task detail record as `GET /api/v1/tasks/{id}` caches it under `["task", id]`. */
const detail = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  organization_id: "o1",
  workspace_id: "ws1",
  number: 1,
  identifier: "ALP-1",
  revision: 5,
  title: "Tiêu đề cũ",
  description: "Mô tả của người khác",
  status: "todo",
  priority: "medium",
  assignee_kind: "human",
  due_date: "2026-09-01",
  position: 0,
  kind: "normal",
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  ...over,
});

/** A task.updated frame as the server emits it for a title change (every value a string). */
const patchFrame = (over: Record<string, string> = {}): Record<string, string> => ({
  task_id: "t1",
  workspace_id: "ws1",
  revision_before: "5",
  revision: "7",
  title: "Tiêu đề mới",
  ...over,
});

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

  describe("work graph refresh", () => {
    // Task A's Related panel lists neighbour B by title and status, so an
    // event about B must reach A's cached graph, not only B's own node.
    const panelA = graphKeys.neighbors("ws1", "TASK", "tA");
    const otherWorkspace = graphKeys.neighbors("ws2", "TASK", "tA");
    const page = { node: null, items: [], next_cursor: "" };
    const invalidated = (qc: QueryClient, key: readonly unknown[]) =>
      qc.getQueryState(key)?.isInvalidated === true;

    it.each([
      ["task.updated", { task_id: "tB" }],
      ["task.created", { task_id: "tB" }],
      ["task.deleted", { task_id: "tB" }],
      ["chat.thread.linked", { room_id: "r1", thread_root_id: "m1", task_id: "tA" }],
      ["chat.thread.unlinked", { room_id: "r1", thread_root_id: "m1", task_id: "tA" }],
    ])("%s refreshes an open graph panel now and again after the projector lag", (type, payload) => {
      vi.useFakeTimers();
      const { qc, client } = setup();
      qc.setQueryData(panelA, page);
      qc.setQueryData(otherWorkspace, page);
      client.emit({ type, payload });
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(invalidated(qc, panelA)).toBe(true);
      // Settle the panel as its refetch would, then wait out the projector.
      qc.setQueryData(panelA, page);
      act(() => {
        vi.advanceTimersByTime(2_749);
      });
      expect(invalidated(qc, panelA)).toBe(false);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(invalidated(qc, panelA)).toBe(true);
      expect(invalidated(qc, otherWorkspace)).toBe(false);
    });
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

  it("invalidates subscribers on task.subscribed without writing the frame, even a patch-shaped one", () => {
    vi.useFakeTimers();
    const { qc, invalidate, client } = setup();
    const cached = detail();
    qc.setQueryData(["task", "t1"], cached);
    client.emit({
      type: "task.subscribed",
      payload: { ...patchFrame(), user_id: "smuggled-user" },
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
    expect(qc.getQueryData(["task", "t1"])).toBe(cached);
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

  it("invalidates calendar queries on task.updated and meeting.created", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "task.updated", payload: { task_id: "t1", workspace_id: "ws1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["calendar", "ws1"]));

    invalidate.mockClear();
    client.emit({ type: "meeting.created", payload: { meeting_id: "m1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["calendar", "ws1"]));
  });

  it("invalidates calendar queries on participant.invited", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "participant.invited", payload: { meeting_id: "m1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["calendar", "ws1"]));
  });

  it("skips calendar invalidation when frame workspace_id mismatches hook wsId", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({
      type: "task.updated",
      payload: { task_id: "t1", workspace_id: "other-ws" },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).not.toContain(JSON.stringify(["calendar", "ws1"]));
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

  it("writes nothing from a task.updated frame without the revision pair, even one carrying a Patch field", () => {
    vi.useFakeTimers();
    const { qc, invalidate, client } = setup();
    const cached = detail();
    qc.setQueryData(["task", "t1"], cached);
    client.emit({ type: "task.updated", payload: { task_id: "t1", workspace_id: "ws1", title: "smuggled" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(qc.getQueryData(["task", "t1"])).toBe(cached);
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["task", "t1"]));
  });

  // ADR 0015: the task.updated row lists title, status, priority and due_date in
  // Patch. A frame carrying them beside revision_before/revision patches a detail
  // entry that already sits at revision_before; everything else still refetches.
  describe("task.updated patch", () => {
    const listRoots = [
      JSON.stringify(["tasks", "ws1"]),
      JSON.stringify(["my-tasks", "ws1"]),
      JSON.stringify(["tasks-query", "ws1"]),
      JSON.stringify(["tasks-table", "ws1"]),
      JSON.stringify(["task-children", "t1"]),
      JSON.stringify(["audit", "history", "ws1", "task", "t1"]),
    ];

    it("patches the detail entry and list rows at once, leaves the detail key out of the wave; lists still invalidate", () => {
      vi.useFakeTimers();
      const { qc, invalidate, client } = setup();
      qc.setQueryData(["task", "t1"], detail());
      qc.setQueryData(["tasks-query", "ws1", "infinite", "h"], {
        pages: [{ tasks: [detail()], total: 1, limit: 50, offset: 0 }],
        pageParams: [0],
      });
      client.emit({ type: "task.updated", payload: patchFrame({ status: "in_progress" }) });
      // Before the debounced wave: the patch is not waiting for a refetch.
      const expected = detail({ title: "Tiêu đề mới", status: "in_progress", revision: 7 });
      expect(qc.getQueryData(["task", "t1"])).toEqual(expected);
      expect(
        qc.getQueryData<{ pages: { tasks: Task[] }[] }>(["tasks-query", "ws1", "infinite", "h"])?.pages[0]?.tasks,
      ).toEqual([expected]);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(keysCalled(invalidate)).not.toContain(JSON.stringify(["task", "t1"]));
      expect(keysCalled(invalidate)).toEqual(expect.arrayContaining(listRoots));
      // The graph trails the task (ADR 0019): a patched detail never skips it.
      expect(keysCalled(invalidate)).toContain(JSON.stringify(["graph", "ws1"]));
    });

    it("does not patch, keeps the cached revision and invalidates when the frame carries a content key outside Patch", () => {
      // What a bundle built before a later ADR added start_date to Patch would
      // see. Patching the title and taking the revision would leave start_date
      // stale behind a current revision, so the frame falls back to a refetch.
      vi.useFakeTimers();
      const { qc, invalidate, client } = setup();
      const cached = detail();
      const rows = [detail()];
      qc.setQueryData(["task", "t1"], cached);
      qc.setQueryData(["tasks", "ws1"], rows);
      client.emit({ type: "task.updated", payload: patchFrame({ start_date: "2026-10-01" }) });
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(qc.getQueryData(["task", "t1"])).toBe(cached);
      expect(qc.getQueryData<{ revision: number }>(["task", "t1"])?.revision).toBe(5);
      expect(qc.getQueryData(["tasks", "ws1"])).toBe(rows);
      expect(keysCalled(invalidate)).toEqual(
        expect.arrayContaining([JSON.stringify(["task", "t1"]), ...listRoots]),
      );
    });

    it("patches list rows but still invalidates the detail key when the detail entry is behind", () => {
      vi.useFakeTimers();
      const { qc, invalidate, client } = setup();
      const behind = detail({ revision: 4 });
      qc.setQueryData(["task", "t1"], behind);
      qc.setQueryData(["tasks", "ws1"], [detail()]);
      client.emit({ type: "task.updated", payload: patchFrame() });
      expect(qc.getQueryData(["tasks", "ws1"])).toEqual([detail({ title: "Tiêu đề mới", revision: 7 })]);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(qc.getQueryData(["task", "t1"])).toBe(behind);
      expect(keysCalled(invalidate)).toEqual(
        expect.arrayContaining([JSON.stringify(["task", "t1"]), ...listRoots]),
      );
    });

    it("invalidates the detail entry as before when its revision is not revision_before", () => {
      vi.useFakeTimers();
      const { qc, invalidate, client } = setup();
      const cached = detail({ revision: 6 });
      qc.setQueryData(["task", "t1"], cached);
      client.emit({ type: "task.updated", payload: patchFrame() });
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(qc.getQueryData(["task", "t1"])).toBe(cached);
      expect(keysCalled(invalidate)).toEqual(
        expect.arrayContaining([JSON.stringify(["task", "t1"]), ...listRoots]),
      );
    });

    it("never creates a detail entry from a frame", () => {
      vi.useFakeTimers();
      const { qc, invalidate, client } = setup();
      client.emit({ type: "task.updated", payload: patchFrame() });
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(qc.getQueryCache().find({ queryKey: ["task", "t1"] })).toBeUndefined();
      expect(keysCalled(invalidate)).toContain(JSON.stringify(["task", "t1"]));
    });

    it("keeps the cached revision and invalidates when the revisions match but no Patch field is present", () => {
      // What an outbox row written before f00f289 looks like (mixed input).
      vi.useFakeTimers();
      const { qc, invalidate, client } = setup();
      const cached = detail();
      qc.setQueryData(["task", "t1"], cached);
      const { title: _title, ...noPatchField } = patchFrame();
      client.emit({ type: "task.updated", payload: noPatchField });
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(qc.getQueryData(["task", "t1"])).toBe(cached);
      expect(qc.getQueryData<{ revision: number }>(["task", "t1"])?.revision).toBe(5);
      expect(keysCalled(invalidate)).toContain(JSON.stringify(["task", "t1"]));
    });

    it("invalidates, not patches, a detail entry whose settle refetch already landed at the frame's revision", () => {
      // usePutTask and useUpdateTask never write the server's response into the
      // cache; they invalidate on settle. When that refetch lands before the
      // outbox frame, the entry already sits at (or past) the frame's revision,
      // so the guard skips it.
      vi.useFakeTimers();
      const { qc, invalidate, client } = setup();
      const fromRefetch = detail({ title: "Tiêu đề mới", revision: 7 });
      qc.setQueryData(["task", "t1"], fromRefetch);
      client.emit({ type: "task.updated", payload: patchFrame() });
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(qc.getQueryData(["task", "t1"])).toBe(fromRefetch);
      expect(keysCalled(invalidate)).toEqual(
        expect.arrayContaining([JSON.stringify(["task", "t1"]), ...listRoots]),
      );
    });

    it.each(["task.created", "task.deleted"])("only invalidates on %s, even with a patch-shaped payload", (type) => {
      vi.useFakeTimers();
      const { qc, invalidate, client } = setup();
      const cached = detail();
      qc.setQueryData(["task", "t1"], cached);
      client.emit({ type, payload: patchFrame() });
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(qc.getQueryData(["task", "t1"])).toBe(cached);
      expect(keysCalled(invalidate)).toEqual(
        expect.arrayContaining([JSON.stringify(["task", "t1"]), ...listRoots]),
      );
    });
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
    qc.setQueryData(chatKeys.roomMessages("ws1", "dm1"), { pages: [[]], pageParams: [null] });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const client = fakeClient();
    renderHook(() => useRealtimeSync(client, "ws1"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    client.emit({ type: "chat.message.created", payload: { room_id: "dm1", message_id: "m1" } });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(keysCalled(invalidate)).toEqual([
      JSON.stringify(chatKeys.voiceRecordings("ws1", "dm1")),
    ]);
    expect(timelineRows(qc, "dm1")).toHaveLength(1);
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
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    // The room's own timeline is not loaded here, so it is marked stale for the
    // next open (UNI-950) while the loaded workspace list is patched in place.
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(keysCalled(invalidate)).toEqual([
      JSON.stringify(chatKeys.voiceRecordings("ws1", "ws-room")),
      JSON.stringify(chatKeys.roomMessages("ws1", "ws-room")),
    ]);
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
    qc.setQueryData(chatKeys.roomMessages("ws1", "dm1"), {
      pageParams: [null],
      pages: [[{
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
      }]],
    });
    const client = fakeClient();
    renderHook(() => useRealtimeSync(client, "ws1"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    client.emit({
      type: "chat.thread.replied",
      payload: { room_id: "dm1", thread_root_id: "root1", message_id: "r1" },
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(timelineRows(qc, "dm1").map((m) => m.id)).toEqual(["root1"]);
    expect(timelineRows(qc, "dm1")[0]?.reply_count).toBe(1);
    expect(
      qc.getQueryData<chatApi.ChatMessageRecord[]>(chatKeys.threadMessages("ws1", "dm1", "root1")),
    ).toHaveLength(1);
    vi.useRealTimers();
  });

  // C3: a sidebar refetch costs the server a query per room; a frame must not
  // abort one in flight (the server keeps running it) to start another.
  it("sends every sidebar refresh through the chat scheduler without cancelling one in flight", async () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "chat.room.created", payload: { room_id: "r1" } } as WSMessage);
    client.emit({ type: "chat.room.activity", payload: { room_id: "dm1" } });
    client.reconnect();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const rooms = JSON.stringify(chatKeys.rooms("ws1"));
    const roomCalls = invalidate.mock.calls.filter(
      (call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey) === rooms,
    );
    expect(roomCalls).toEqual([[{ queryKey: chatKeys.rooms("ws1") }, { cancelRefetch: false }]]);
    vi.useRealTimers();
  });

  it("refreshes the room list on chat.room.activity", async () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "chat.room.activity", payload: { room_id: "dm1" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(keysCalled(invalidate)).toContain(JSON.stringify(["chat", "rooms", "ws1"]));
    vi.useRealTimers();
  });

  // C10: one invite is one frame, which refreshes the room list and members.
  it("refreshes the room list and members on chat.room.members_added", async () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "chat.room.members_added", payload: { room_id: "g1" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const called = keysCalled(invalidate);
    expect(called).toContain(JSON.stringify(chatKeys.rooms("ws1")));
    expect(called).toContain(JSON.stringify(chatKeys.roomMembers("ws1", "g1")));
    vi.useRealTimers();
  });

  it("invalidates message links on chat.message.linked without dropping message cache", () => {
    const qc = new QueryClient();
    const messages = [
      {
        id: "m1",
        room_id: "dm1",
        workspace_id: "ws1",
        sender_id: "u1",
        sender_display_name: "Ada",
        kind: "text",
        body: "hello",
        created_at: "2026-01-01T10:00:00Z",
        pinned: false,
        mentioned_user_ids: [],
        reactions: {},
        reply_count: 0,
        thread_unread: false,
      },
    ];
    qc.setQueryData(chatKeys.roomMessages("ws1", "dm1"), { pages: [messages], pageParams: [null] });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const client = fakeClient();
    renderHook(() => useRealtimeSync(client, "ws1"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    client.emit({
      type: "chat.message.linked",
      payload: { room_id: "dm1", message_id: "m1", target_id: "t1" },
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatKeys.messageLinks("ws1", "m1"),
    });
    expect(timelineRows(qc, "dm1")).toEqual(messages);
  });

  // Documents frames are ids-only: the workspace root is the prefix of every
  // document key (detail, versions, downloadMeta), so each of the nine wired
  // topics pushes exactly that root.
  describe("documents", () => {
    const docRoot = JSON.stringify(["documents", "ws1"]);

    it.each([
      "document.created",
      "document.updated",
      "document.version_created",
      "document.shared",
      "document.share_revoked",
      "document.link_created",
      "document.link_revoked",
      "document.favorited",
      "document.unfavorited",
    ] as const)("invalidates the workspace documents root on %s", (type) => {
      vi.useFakeTimers();
      const { invalidate, client } = setup();
      client.emit({ type, payload: { document_id: "d1", workspace_id: "ws1" } } as WSMessage);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(keysCalled(invalidate)).toContain(docRoot);
    });

    it("ignores a document frame stamped with another workspace", () => {
      vi.useFakeTimers();
      const { invalidate, client } = setup();
      client.emit({
        type: "document.updated",
        payload: { document_id: "d1", workspace_id: "ws2" },
      } as WSMessage);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(keysCalled(invalidate)).not.toContain(docRoot);
    });

    // Comment frames change nothing but the thread: exactly the comment key of
    // the document the frame names is invalidated, never the document root.
    it.each([
      "document.comment_added",
      "document.comment_updated",
      "document.comment_deleted",
      "document.comment_resolved",
      "document.comment_unresolved",
      "document.comment_reaction_added",
      "document.comment_reaction_removed",
    ] as const)("invalidates only the comment key on %s", (type) => {
      vi.useFakeTimers();
      const { invalidate, client } = setup();
      client.emit({
        type,
        payload: { document_id: "d1", comment_id: "c1", workspace_id: "ws1" },
      } as WSMessage);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      const keys = keysCalled(invalidate);
      expect(keys).toContain(JSON.stringify(["documents", "ws1", "doc", "d1", "comments"]));
      expect(keys).not.toContain(docRoot);
      vi.useRealTimers();
    });

    it("ignores a comment frame stamped with another workspace", () => {
      vi.useFakeTimers();
      const { invalidate, client } = setup();
      client.emit({
        type: "document.comment_added",
        payload: { document_id: "d1", comment_id: "c1", workspace_id: "ws2" },
      } as WSMessage);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(keysCalled(invalidate).filter((k) => k.startsWith('["documents"'))).toEqual([]);
      vi.useRealTimers();
    });

    it.each(["document.favorited", "document.unfavorited"] as const)(
      "refreshes the favorites prefix on %s",
      (type) => {
        vi.useFakeTimers();
        const { invalidate, client } = setup();
        client.emit({
          type,
          payload: { document_id: "d1", workspace_id: "ws1" },
        } as WSMessage);
        act(() => {
          vi.advanceTimersByTime(250);
        });
        expect(keysCalled(invalidate)).toContain(JSON.stringify(["documents", "favorites"]));
        vi.useRealTimers();
      },
    );
  });

  it("invalidates workspace keys and open chat timelines after a reconnect", async () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.reconnect();
    // The sidebar comes through the chat scheduler: debounce plus jitter.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
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
        JSON.stringify(["chat", "room-messages", "ws1"]),
        JSON.stringify(["chat", "messages", "ws1"]),
        JSON.stringify(["chat", "thread-messages", "ws1"]),
        JSON.stringify(["meetings", "ws1"]),
        JSON.stringify(["meeting-stats", "ws1"]),
        JSON.stringify(["meeting-join-requests"]),
        JSON.stringify(["documents", "ws1"]),
      ]),
    );
  });

  it("coalesces transcript.appended until the longer debounce", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "transcript.appended", payload: { meeting_id: "m1" } });
    client.emit({ type: "transcript.appended", payload: { meeting_id: "m1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).not.toContain(JSON.stringify(["meeting-transcript", "m1"]));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(keysCalled(invalidate).filter((k) => k === JSON.stringify(["meeting-transcript", "m1"]))).toHaveLength(1);
  });
});

describe("useRealtimeSync › home summary", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const home = JSON.stringify(["home", "ws1", "summary"]);

  it.each([
    { type: "task.created", payload: { task_id: "t1" } },
    { type: "task.updated", payload: { task_id: "t1" } },
    { type: "task.deleted", payload: { task_id: "t1" } },
    { type: "meeting.started", payload: { meeting_id: "m1" } },
    { type: "participant.invited", payload: { meeting_id: "m1" } },
    { type: "notification.created", payload: { notification_id: "n1" } },
  ])("refreshes the home summary on $type", ({ type, payload }) => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type, payload } as WSMessage);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toContain(home);
  });

  it("leaves the home summary alone for chat traffic", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "chat.room.created", payload: { room_id: "r1" } } as WSMessage);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).not.toContain(home);
  });
});

describe("useRealtimeSync › meeting attendance", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const attendance = JSON.stringify(["meeting-attendance", "m1"]);
  const participants = JSON.stringify(["meeting-participants", "m1"]);
  const activity = JSON.stringify(["meeting-activity", "m1"]);

  it.each([
    { type: "attendance.marked", extra: [] as string[] },
    { type: "attendance.updated", extra: [] as string[] },
    { type: "attendance.finalized", extra: [activity] },
    { type: "attendance.reopened", extra: [activity] },
    { type: "participant.updated", extra: [participants] },
    // A roster change moves someone onto or off the roll.
    { type: "participant.invited", extra: [participants] },
    { type: "participant.removed", extra: [participants] },
    { type: "invitation.responded", extra: [participants] },
    { type: "join_request.approved", extra: [participants] },
    // The quorum lives on the meeting.
    { type: "meeting.updated", extra: [] as string[] },
  ])("refreshes the roll on $type", ({ type, extra }) => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type, payload: { meeting_id: "m1" } } as WSMessage);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    const keys = keysCalled(invalidate);
    expect(keys).toContain(attendance);
    for (const k of extra) expect(keys).toContain(k);
  });
});


describe("useRealtimeSync › meeting motions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const motions = JSON.stringify(["meeting-motions", "m1"]);
  const activity = JSON.stringify(["meeting-activity", "m1"]);

  it.each([
    { type: "motion.created", extra: [] as string[] },
    { type: "motion.updated", extra: [] as string[] },
    { type: "motion.deleted", extra: [] as string[] },
    // Opening and closing are timeline rows.
    { type: "motion.opened", extra: [activity] },
    { type: "motion.closed", extra: [activity] },
    // Standing decides who joins the next roll and what my_ballot says.
    { type: "participant.updated", extra: [] as string[] },
    // Ending the meeting closes and counts every open motion.
    { type: "meeting.ended", extra: [] as string[] },
  ])("refreshes the motion list on $type", ({ type, extra }) => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type, payload: { meeting_id: "m1", motion_id: "mo1" } } as WSMessage);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    const keys = keysCalled(invalidate);
    expect(keys).toContain(motions);
    for (const k of extra) expect(keys).toContain(k);
  });

  it("refreshes only the tallies on a ballot, at most once a second", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    const list = JSON.stringify(["meeting-motions", "m1", "list"]);
    for (let i = 0; i < 20; i++) {
      client.emit({ type: "motion.ballot_cast", payload: { meeting_id: "m1", motion_id: "mo1" } } as WSMessage);
    }
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).not.toContain(list);
    act(() => {
      vi.advanceTimersByTime(750);
    });
    const keys = keysCalled(invalidate);
    expect(keys.filter((k) => k === list)).toHaveLength(1);
    expect(keys).not.toContain(motions);
  });

  it("keeps the timeline still for a ballot", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "motion.ballot_cast", payload: { meeting_id: "m1", motion_id: "mo1" } } as WSMessage);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).not.toContain(activity);
  });
});

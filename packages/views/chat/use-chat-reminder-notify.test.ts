import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { toast } from "sonner";
import { useChatReminderNotifications } from "./use-chat-reminder-notify";

vi.mock("sonner", () => ({
  toast: { info: vi.fn() },
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(toast.info).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

const WORKSPACE_ID = "ws1";
const ROOM_KEY = ["chat", "room-messages", WORKSPACE_ID, "room1"];
const OTHER_ROOM_KEY = ["chat", "room-messages", WORKSPACE_ID, "room2"];

function reminderRow(id: string, remindAt: string, body = "Họp team"): ChatMessageRecord {
  return {
    id,
    room_id: "room1",
    workspace_id: WORKSPACE_ID,
    sender_id: "u1",
    sender_display_name: "A",
    kind: "reminder",
    body,
    created_at: new Date().toISOString(),
    pinned: false,
    mentioned_user_ids: [],
    reactions: {},
    reply_count: 0,
    thread_unread: false,
    reminder: { body, remind_at: remindAt, repeat: "none" },
  };
}

function textRow(id: string): ChatMessageRecord {
  const row = reminderRow(id, new Date(Date.now() + 60_000).toISOString(), "hello");
  delete row.reminder;
  return { ...row, kind: "text" };
}

function reminderKindWithoutPayload(id: string): ChatMessageRecord {
  const row = reminderRow(id, new Date(Date.now() + 60_000).toISOString());
  delete row.reminder;
  return row;
}

function renderReminders(qc: QueryClient) {
  return renderHook(() => useChatReminderNotifications(WORKSPACE_ID), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  });
}

function futureIso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe("useChatReminderNotifications", () => {
  it("fires a toast when a cached reminder becomes due", () => {
    const qc = new QueryClient();
    qc.setQueryData(ROOM_KEY, [reminderRow("r1", futureIso(60_000))]);
    renderReminders(qc);

    expect(toast.info).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("ignores non-reminder rows, missing payloads, non-array data, and invalid or past due dates", () => {
    const qc = new QueryClient();
    qc.setQueryData(ROOM_KEY, [
      textRow("t1"),
      reminderKindWithoutPayload("r-missing"),
      reminderRow("r-bad-date", "not-a-date"),
      reminderRow("r-past", new Date(Date.now() - 60_000).toISOString()),
    ]);
    qc.setQueryData(OTHER_ROOM_KEY, "not-an-array");
    renderReminders(qc);

    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("fires only once for duplicate entries and skips already-fired reminders on resync", () => {
    const qc = new QueryClient();
    const due = futureIso(60_000);
    qc.setQueryData(ROOM_KEY, [reminderRow("r1", due)]);
    qc.setQueryData(OTHER_ROOM_KEY, [reminderRow("r1", due)]);
    renderReminders(qc);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(toast.info).toHaveBeenCalledTimes(1);

    qc.setQueryData(ROOM_KEY, [reminderRow("r1", due), reminderRow("r2", futureIso(120_000))]);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(toast.info).toHaveBeenCalledTimes(2);
  });

  it("does not schedule duplicate timers when the cache sync produces the same snapshot", () => {
    const qc = new QueryClient();
    const due = futureIso(60_000);
    qc.setQueryData(ROOM_KEY, [reminderRow("r1", due)]);
    renderReminders(qc);

    qc.setQueryData(ROOM_KEY, [reminderRow("r1", due)]);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("clears pending timers on unmount", () => {
    const qc = new QueryClient();
    qc.setQueryData(ROOM_KEY, [reminderRow("r1", futureIso(60_000))]);
    const { unmount } = renderReminders(qc);

    unmount();
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(toast.info).not.toHaveBeenCalled();
  });
});

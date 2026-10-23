import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { toast } from "sonner";
import { useChatReminderNotifications } from "./use-chat-reminder-notify";

vi.mock("sonner", () => ({
  toast: { info: vi.fn() },
}));

type Handler = (payload: unknown) => void;

const wsState = vi.hoisted(() => ({
  client: null as { on: (event: string, cb: Handler) => () => void } | null,
}));

vi.mock("@uniwork/core/realtime", () => ({
  useOptionalWS: () => (wsState.client ? { client: wsState.client } : null),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  wsState.client = null;
  vi.mocked(toast.info).mockClear();
});

const WORKSPACE_ID = "ws1";

function installClient() {
  const calls: Array<{ event: string; cb: Handler }> = [];
  const off = vi.fn();
  wsState.client = {
    on: (event: string, cb: Handler) => {
      calls.push({ event, cb });
      return off;
    },
  };
  return {
    calls,
    off,
    emit: (payload: unknown) => {
      for (const { cb } of calls) cb(payload);
    },
  };
}

function reminderRow(id: string, body: string): ChatMessageRecord {
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
    reminder: { body, remind_at: new Date().toISOString(), repeat: "none" },
  };
}

function renderReminders(qc: QueryClient) {
  return renderHook(() => useChatReminderNotifications(WORKSPACE_ID), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  });
}

describe("useChatReminderNotifications", () => {
  it("does nothing without a WS client", () => {
    renderReminders(new QueryClient());
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("never fires from a client timer: only the server's chat.reminder.due toasts", () => {
    vi.useFakeTimers();
    try {
      const qc = new QueryClient();
      qc.setQueryData(["chat", "room-messages", WORKSPACE_ID, "room1"], { pages: [[reminderRow("r1", "Họp team")]], pageParams: [null] });
      const { calls } = installClient();
      renderReminders(qc);
      vi.advanceTimersByTime(24 * 60 * 60_000);
      expect(toast.info).not.toHaveBeenCalled();
      expect(calls.map((c) => c.event)).toEqual(["chat.reminder.due"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("toasts the cached reminder body when the server says it is due", () => {
    const qc = new QueryClient();
    qc.setQueryData(["chat", "room-messages", WORKSPACE_ID, "room1"], { pages: [[reminderRow("r1", "Họp team")]], pageParams: [null] });
    const { emit } = installClient();
    renderReminders(qc);
    emit({ room_id: "room1", message_id: "r1" });
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.info).mock.calls[0]?.[0]).toContain("Họp team");
  });

  it("still toasts when the message is not cached, and ignores frames without a message id", () => {
    const { emit } = installClient();
    renderReminders(new QueryClient());
    emit({ room_id: "room9" });
    expect(toast.info).not.toHaveBeenCalled();
    emit({ room_id: "room9", message_id: "unknown" });
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes on unmount", () => {
    const { off } = installClient();
    const { unmount } = renderReminders(new QueryClient());
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });
});

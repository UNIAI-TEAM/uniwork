import { renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import {
  resetChatRoomPreferencesForTests,
  useChatRoomPreferencesStore,
} from "@uniwork/core/chat/room-preferences-store";
import { toast } from "sonner";
import { useChatMentionNotify } from "./use-chat-mention-notify";

vi.mock("sonner", () => ({
  toast: { info: vi.fn() },
}));

type MentionHandler = (payload: unknown) => void;

const wsState = vi.hoisted(() => ({
  client: null as { on: (event: string, cb: MentionHandler) => () => void } | null,
}));

vi.mock("@uniwork/core/realtime", () => ({
  useOptionalWS: () => (wsState.client ? { client: wsState.client } : null),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  wsState.client = null;
  resetChatRoomPreferencesForTests();
  vi.mocked(toast.info).mockClear();
});

function installClient() {
  const calls: Array<{ event: string; cb: MentionHandler }> = [];
  const off = vi.fn();
  wsState.client = {
    on: (event: string, cb: MentionHandler) => {
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

function renderMentionNotify(activeRoomId: string | null, currentUserId = "u1") {
  return renderHook(() => useChatMentionNotify({ currentUserId, activeRoomId }));
}

describe("useChatMentionNotify", () => {
  it("does not crash when there is no WS client", () => {
    renderMentionNotify("room-active");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("does not subscribe when currentUserId is empty", () => {
    const { calls } = installClient();
    renderMentionNotify("room-active", "");
    expect(calls).toHaveLength(0);
  });

  it("subscribes to mention events and toasts for another room", () => {
    const { calls, emit } = installClient();
    renderMentionNotify("room-active");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.event).toBe("chat.mention.created");
    emit({ room_id: "room-other" });
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("toasts for room ids with surrounding whitespace", () => {
    const { emit } = installClient();
    renderMentionNotify("room-active");
    emit({ room_id: "  room-other  " });
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("ignores mentions for the active room", () => {
    const { emit } = installClient();
    renderMentionNotify("room-active");
    emit({ room_id: "room-active" });
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("ignores mentions in muted rooms", () => {
    useChatRoomPreferencesStore.getState().toggleNotificationsMuted("room-muted");
    const { emit } = installClient();
    renderMentionNotify("room-active");
    emit({ room_id: "room-muted" });
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("ignores malformed payloads without crashing", () => {
    const { emit } = installClient();
    renderMentionNotify("room-active");
    const malformed: unknown[] = [
      null,
      undefined,
      {},
      { room_id: 123 },
      { room_id: null },
      { room_id: "" },
      { room_id: "   " },
    ];
    for (const payload of malformed) {
      expect(() => emit(payload)).not.toThrow();
    }
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const { off } = installClient();
    const { unmount } = renderMentionNotify("room-active");
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });
});

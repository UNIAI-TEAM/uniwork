import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import * as chat from "../api/endpoints/chat";
import { resetChatSendOutboxForTests, useChatSendOutboxStore } from "./send-outbox-store";
import { useChatSendOutboxFlush } from "./use-chat-send-outbox-flush";

vi.mock("../api/endpoints/chat", () => ({
  sendChatRoomMessage: vi.fn(),
  sendChatThreadMessage: vi.fn(),
}));

vi.mock("../realtime", () => ({
  useOptionalWS: () => null,
  useWSReconnect: () => undefined,
}));

describe("useChatSendOutboxFlush", () => {
  it("reports entries the server refused for good", async () => {
    resetChatSendOutboxForTests();
    useChatSendOutboxStore.getState().enqueue({
      workspaceId: "ws1",
      senderId: "u1",
      roomId: "room1",
      body: "removed from room",
      client_msg_id: "cmid-403",
      queued_at: new Date().toISOString(),
    });
    vi.mocked(chat.sendChatRoomMessage).mockRejectedValue(new ApiError("forbidden", "forbidden", 403));
    const qc = new QueryClient();
    const onDropped = vi.fn();

    renderHook(() => useChatSendOutboxFlush("ws1", "u1", onDropped), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(onDropped).toHaveBeenCalledWith(1));
    expect(useChatSendOutboxStore.getState().listForWorkspace("ws1", "u1")).toEqual([]);
  });
});

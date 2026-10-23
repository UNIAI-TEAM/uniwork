import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import * as chat from "../api/endpoints/chat";
import { resetChatSendOutboxForTests, useChatSendOutboxStore } from "./send-outbox-store";
import { useChatSendOutboxFlush, useRetryChatSend } from "./use-chat-send-outbox-flush";

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

describe("useRetryChatSend", () => {
  const wrapper = (qc: QueryClient) =>
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    };

  it("re-sends a failed entry with its own client_msg_id and clears it once sent", async () => {
    resetChatSendOutboxForTests();
    useChatSendOutboxStore.getState().enqueue({
      workspaceId: "ws1",
      senderId: "u1",
      roomId: "room1",
      body: "try again",
      client_msg_id: "cmid-retry",
      queued_at: new Date().toISOString(),
      failed_at: new Date().toISOString(),
    });
    vi.mocked(chat.sendChatRoomMessage).mockReset().mockResolvedValue(null);
    const { result } = renderHook(() => useRetryChatSend("ws1"), { wrapper: wrapper(new QueryClient()) });

    await expect(result.current("cmid-retry")).resolves.toEqual({ outcome: "sent" });
    expect(chat.sendChatRoomMessage).toHaveBeenCalledWith(
      "ws1",
      "room1",
      expect.objectContaining({ client_msg_id: "cmid-retry", body: "try again" }),
    );
    expect(useChatSendOutboxStore.getState().entries).toEqual([]);
  });

  it("keeps the entry failed when the server fails again, and does nothing for an unknown id", async () => {
    resetChatSendOutboxForTests();
    useChatSendOutboxStore.getState().enqueue({
      workspaceId: "ws1",
      senderId: "u1",
      roomId: "room1",
      body: "still down",
      client_msg_id: "cmid-down",
      queued_at: new Date().toISOString(),
      failed_at: new Date().toISOString(),
    });
    const tooFast = new ApiError("slow down", "rate_limited", 429, undefined, undefined, undefined, 60);
    vi.mocked(chat.sendChatRoomMessage).mockReset().mockRejectedValue(tooFast);
    const { result } = renderHook(() => useRetryChatSend("ws1"), { wrapper: wrapper(new QueryClient()) });

    await expect(result.current("cmid-down")).resolves.toEqual({ outcome: "failed", error: tooFast });
    expect(useChatSendOutboxStore.getState().entries[0]?.failed_at).toEqual(expect.any(String));
    await expect(result.current("cmid-none")).resolves.toBeNull();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api/http";
import { resetChatSendOutboxForTests, useChatSendOutboxStore } from "@uniwork/core/chat/send-outbox-store";
import { requestMock } from "../test/request-mock";
import { useChatSendOutboxToast } from "./use-chat-send-outbox-toast";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// The socket reports "connected" as soon as the page subscribes, so the flush
// runs at mount, while the page still shows the workspace room.
vi.mock("@uniwork/core/realtime", () => ({
  useOptionalWS: () => ({
    client: {
      onConnectionStateChange: (cb: (state: string) => void) => {
        cb("connected");
        return () => undefined;
      },
    },
  }),
  useWSReconnect: () => undefined,
}));

beforeEach(() => {
  resetChatSendOutboxForTests();
  vi.mocked(toast.error).mockClear();
});

describe("useChatSendOutboxToast", () => {
  it("toasts a queued send the server refused for good, whatever room is open", async () => {
    useChatSendOutboxStore.getState().enqueue({
      workspaceId: "ws1",
      senderId: "u1",
      roomId: "room1",
      body: "removed from room",
      client_msg_id: "cmid-403",
      queued_at: new Date().toISOString(),
    });
    requestMock.mockRejectedValue(new ApiError("forbidden", "forbidden", 403));
    const qc = new QueryClient();

    renderHook(() => useChatSendOutboxToast("ws1", "u1"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "1 tin nhắn chờ gửi không gửi được và đã bị bỏ khỏi hàng chờ.",
      ),
    );
    expect(useChatSendOutboxStore.getState().listForWorkspace("ws1", "u1")).toEqual([]);
  });
});

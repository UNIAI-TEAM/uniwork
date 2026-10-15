import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ApiError } from "@uniwork/core/api";
import { CHAT_FILE_MAX_BYTES } from "./chat-file-accept";
import { useChatMediaSend } from "./use-chat-media-send";

initI18n();

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@uniwork/core/chat/client-msg-id", () => ({
  newChatClientMsgId: () => "client-msg-1",
}));

import { toast } from "sonner";

describe("useChatMediaSend", () => {
  const ensureRoom = { mutateAsync: vi.fn() };
  const sendVoiceMessage = { mutateAsync: vi.fn() };
  const sendFileMessage = { mutateAsync: vi.fn() };
  const clearReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setup(over: Partial<Parameters<typeof useChatMediaSend>[0]> = {}) {
    return renderHook(() =>
      useChatMediaSend({
        activeRoomId: "room1",
        targetKind: "dm",
        replyToId: "reply1",
        ensureRoom,
        sendVoiceMessage,
        sendFileMessage,
        clearReply,
        ...over,
      }),
    );
  }

  it("sends voice to the active room and clears reply", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.handleSendVoice({
        blob: new Blob(["a"]),
        durationMs: 1200,
      });
    });
    expect(sendVoiceMessage.mutateAsync).toHaveBeenCalledWith({
      roomId: "room1",
      file: expect.any(Blob),
      duration_ms: 1200,
      client_msg_id: "client-msg-1",
      reply_to_message_id: "reply1",
    });
    expect(clearReply).toHaveBeenCalled();
  });

  it("ensures a workspace room when activeRoomId is null", async () => {
    ensureRoom.mutateAsync.mockResolvedValue({ room_id: "ws-room" });
    const { result } = setup({ activeRoomId: null, targetKind: "workspace", replyToId: undefined });
    await act(async () => {
      await result.current.handleSendVoice({ blob: new Blob(["a"]), durationMs: 1 });
    });
    expect(ensureRoom.mutateAsync).toHaveBeenCalled();
    expect(sendVoiceMessage.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: "ws-room", reply_to_message_id: undefined }),
    );
  });

  it("throws when voice send has no resolvable room", async () => {
    const { result } = setup({ activeRoomId: null, targetKind: "dm" });
    await expect(
      act(async () => {
        await result.current.handleSendVoice({ blob: new Blob(["a"]), durationMs: 1 });
      }),
    ).rejects.toThrow();
  });

  it("toasts and returns when file send has no room", async () => {
    const { result } = setup({ activeRoomId: null, targetKind: "group" });
    await act(async () => {
      await result.current.handleSendFile(new File(["x"], "note.txt"));
    });
    expect(toast.error).toHaveBeenCalled();
    expect(sendFileMessage.mutateAsync).not.toHaveBeenCalled();
  });

  it("sends a file and clears reply on success", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.handleSendFile(new File(["x"], "note.txt"));
    });
    expect(sendFileMessage.mutateAsync).toHaveBeenCalledWith({
      roomId: "room1",
      file: expect.any(File),
      filename: "note.txt",
      client_msg_id: "client-msg-1",
      reply_to_message_id: "reply1",
    });
    expect(clearReply).toHaveBeenCalled();
  });

  it("toasts when file upload fails", async () => {
    sendFileMessage.mutateAsync.mockRejectedValueOnce(new Error("fail"));
    const { result } = setup();
    await act(async () => {
      await result.current.handleSendFile(new File(["x"], "note.txt"));
    });
    expect(toast.error).toHaveBeenCalledWith("Không gửi được tệp. Thử lại.");
    expect(clearReply).not.toHaveBeenCalled();
  });

  it("says the file is over the size limit before uploading", async () => {
    const { result } = setup();
    const file = new File([new Uint8Array(1)], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: CHAT_FILE_MAX_BYTES + 1 });
    await act(async () => {
      await result.current.handleSendFile(file);
    });
    expect(sendFileMessage.mutateAsync).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Tệp lớn hơn mức cho phép. Dung lượng tối đa là 25 MB.");
  });

  it("says the file is over the size limit when the server refuses it", async () => {
    sendFileMessage.mutateAsync.mockRejectedValueOnce(new ApiError("file must be at most 25 MiB", "too_large", 413));
    const { result } = setup();
    await act(async () => {
      await result.current.handleSendFile(new File(["x"], "note.pdf", { type: "application/pdf" }));
    });
    expect(toast.error).toHaveBeenCalledWith("Tệp lớn hơn mức cho phép. Dung lượng tối đa là 25 MB.");
  });
});

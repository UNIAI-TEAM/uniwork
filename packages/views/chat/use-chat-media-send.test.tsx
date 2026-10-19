import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ApiError } from "@uniwork/core/api";
import { CHAT_DOCUMENT_MAX_BYTES, CHAT_FILE_MAX_BYTES } from "./chat-file-accept";

initI18n();

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@uniwork/core/chat/client-msg-id", () => ({
  newChatClientMsgId: vi.fn(() => "client-msg-1"),
}));

import { toast } from "sonner";
import { newChatClientMsgId } from "@uniwork/core/chat/client-msg-id";
import { useChatMediaSend } from "./use-chat-media-send";

describe("useChatMediaSend", () => {
  const ensureRoom = { mutateAsync: vi.fn() };
  const sendVoiceMessage = { mutateAsync: vi.fn() };
  const sendFileMessage = { mutateAsync: vi.fn() };
  const clearReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(newChatClientMsgId).mockReset().mockReturnValue("client-msg-1");
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

  it("reuses the client_msg_id when the same recording is sent again", async () => {
    vi.mocked(newChatClientMsgId).mockReturnValueOnce("a").mockReturnValueOnce("b");
    sendVoiceMessage.mutateAsync.mockRejectedValueOnce(new Error("network"));
    const { result } = setup();
    const blob = new Blob(["a"]);
    await expect(
      act(async () => {
        await result.current.handleSendVoice({ blob, durationMs: 1200 });
      }),
    ).rejects.toThrow("network");
    await act(async () => {
      await result.current.handleSendVoice({ blob, durationMs: 1200 });
    });
    expect(sendVoiceMessage.mutateAsync).toHaveBeenCalledTimes(2);
    expect(sendVoiceMessage.mutateAsync.mock.calls.map(([input]) => input.client_msg_id)).toEqual(["a", "a"]);
  });

  it("gives a new recording a new client_msg_id", async () => {
    vi.mocked(newChatClientMsgId).mockReturnValueOnce("a").mockReturnValueOnce("b");
    const { result } = setup();
    await act(async () => {
      await result.current.handleSendVoice({ blob: new Blob(["a"]), durationMs: 1 });
      await result.current.handleSendVoice({ blob: new Blob(["a"]), durationMs: 1 });
    });
    expect(sendVoiceMessage.mutateAsync.mock.calls.map(([input]) => input.client_msg_id)).toEqual(["a", "b"]);
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

  const sendDocumentMessage = { mutateAsync: vi.fn() };

  it("sends a document at the picked share level and clears reply", async () => {
    const { result } = setup({ sendDocumentMessage });
    await act(async () => {
      await result.current.handleSendDocument(new File(["x"], "plan.docx"), "comment");
    });
    expect(sendDocumentMessage.mutateAsync).toHaveBeenCalledWith({
      roomId: "room1",
      file: expect.any(File),
      filename: "plan.docx",
      share_level: "comment",
      client_msg_id: "client-msg-1",
      reply_to_message_id: "reply1",
    });
    expect(clearReply).toHaveBeenCalled();
  });

  it("a document over the chat cap but under the document cap still sends", async () => {
    const { result } = setup({ sendDocumentMessage });
    const file = new File([new Uint8Array(1)], "deck.pptx", { type: "application/vnd.ms-powerpoint" });
    Object.defineProperty(file, "size", { value: CHAT_FILE_MAX_BYTES + 1 });
    await act(async () => {
      await result.current.handleSendDocument(file, "view");
    });
    expect(sendDocumentMessage.mutateAsync).toHaveBeenCalled();
  });

  it("refuses a document over the document cap before uploading", async () => {
    const { result } = setup({ sendDocumentMessage });
    const file = new File([new Uint8Array(1)], "deck.pptx", { type: "application/vnd.ms-powerpoint" });
    Object.defineProperty(file, "size", { value: CHAT_DOCUMENT_MAX_BYTES + 1 });
    await act(async () => {
      await result.current.handleSendDocument(file, "view");
    });
    expect(sendDocumentMessage.mutateAsync).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Tệp lớn hơn mức cho phép. Dung lượng tối đa là 200 MB.");
  });

  it("maps the document send refusal codes to their own sentences", async () => {
    const cases: Array<[ApiError, string]> = [
      [new ApiError("quota", "quota_exceeded", 403), "Tổ chức đã hết dung lượng lưu trữ. Hãy giải phóng dung lượng hoặc nâng cấp gói."],
      [new ApiError("batch", "share_batch_too_large", 422), "Cuộc trò chuyện có quá nhiều người để chia sẻ tài liệu. Hãy chia sẻ từ trang Tài liệu."],
      [new ApiError("fmt", "unsupported_media_type", 415, undefined, { reason: "format" }), "Định dạng tệp này chưa được hỗ trợ."],
    ];
    for (const [err, text] of cases) {
      sendDocumentMessage.mutateAsync.mockRejectedValueOnce(err);
      const { result } = setup({ sendDocumentMessage });
      await act(async () => {
        await result.current.handleSendDocument(new File(["x"], "a.pdf"), "edit");
      });
      expect(toast.error).toHaveBeenLastCalledWith(text);
      expect(clearReply).not.toHaveBeenCalled();
    }
  });

  it("falls back to the generic send copy for other failures", async () => {
    sendDocumentMessage.mutateAsync.mockRejectedValueOnce(new Error("fail"));
    const { result } = setup({ sendDocumentMessage });
    await act(async () => {
      await result.current.handleSendDocument(new File(["x"], "a.pdf"), "view");
    });
    expect(toast.error).toHaveBeenCalledWith("Không gửi được tệp. Thử lại.");
  });

  it("toasts and returns when document send has no room", async () => {
    const { result } = setup({ activeRoomId: null, targetKind: "group", sendDocumentMessage });
    await act(async () => {
      await result.current.handleSendDocument(new File(["x"], "a.pdf"), "view");
    });
    expect(toast.error).toHaveBeenCalled();
    expect(sendDocumentMessage.mutateAsync).not.toHaveBeenCalled();
  });
});

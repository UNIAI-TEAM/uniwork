import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { ChatMessage } from "./chat-messages";
import { useChatInlineEdit } from "./use-chat-inline-edit";

const editMessage = vi.fn();

vi.mock("@uniwork/core/chat", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/chat")>()),
  useEditChatMessage: () => ({ mutateAsync: editMessage, isPending: false }),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  editMessage.mockReset();
});

const MESSAGE = { id: "m2", body: "Reply", sender: "self", ts: 0 } as unknown as ChatMessage;

function setup(roomId = "room1") {
  return renderHook(({ room }) => useChatInlineEdit({ workspaceId: "ws1", roomId: room, nameContext: [] }), {
    initialProps: { room: roomId },
  });
}

describe("useChatInlineEdit", () => {
  it("saves through the edit mutation and leaves edit mode", async () => {
    editMessage.mockResolvedValueOnce(undefined);
    const { result } = setup();
    act(() => result.current.start(MESSAGE));
    expect(result.current.message).toBe(MESSAGE);

    await act(async () => {
      await result.current.save("  Reply edited ");
    });

    expect(editMessage).toHaveBeenCalledWith({ roomId: "room1", messageId: "m2", body: "Reply edited" });
    expect(result.current.message).toBeNull();
  });

  it("stays in edit mode with the reason when the save fails", async () => {
    editMessage.mockRejectedValueOnce(new Error("boom"));
    const { result } = setup();
    act(() => result.current.start(MESSAGE));

    await act(async () => {
      await result.current.save("Reply edited");
    });

    expect(result.current.message).toBe(MESSAGE);
    expect(result.current.error).toBe("Chưa lưu được thay đổi. Thử lại.");
  });

  it("sends nothing for an unchanged or empty edit", async () => {
    const { result } = setup();
    act(() => result.current.start(MESSAGE));
    await act(async () => {
      await result.current.save("   ");
    });
    expect(result.current.message).toBe(MESSAGE);

    await act(async () => {
      await result.current.save(" Reply ");
    });
    expect(editMessage).not.toHaveBeenCalled();
    expect(result.current.message).toBeNull();
  });

  it("leaves edit mode when the room changes", () => {
    const { result, rerender } = setup();
    act(() => result.current.start(MESSAGE));
    rerender({ room: "room2" });
    expect(result.current.message).toBeNull();
  });
});

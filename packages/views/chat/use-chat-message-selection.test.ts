import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { joinSelectedChatMessageText, useChatMessageSelection } from "./use-chat-message-selection";

describe("useChatMessageSelection", () => {
  it("enters with the first message selected", () => {
    const { result } = renderHook(() => useChatMessageSelection("room-a"));
    act(() => result.current.enter("m1"));
    expect(result.current.active).toBe(true);
    expect(result.current.isSelected("m1")).toBe(true);
  });

  it("toggles messages and clears when the last is deselected", () => {
    const { result } = renderHook(() => useChatMessageSelection("room-a"));
    act(() => result.current.enter("m1"));
    act(() => result.current.toggle("m2"));
    expect([...result.current.selectedIds].sort()).toEqual(["m1", "m2"]);
    act(() => result.current.toggle("m1"));
    act(() => result.current.toggle("m2"));
    expect(result.current.active).toBe(false);
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("resets when the room changes", () => {
    const { result, rerender } = renderHook(({ roomId }) => useChatMessageSelection(roomId), {
      initialProps: { roomId: "room-a" },
    });
    act(() => result.current.enter("m1"));
    rerender({ roomId: "room-b" });
    expect(result.current.active).toBe(false);
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("clear leaves selection mode", () => {
    const { result } = renderHook(() => useChatMessageSelection("room-a"));
    act(() => result.current.enter("m1"));
    act(() => result.current.clear());
    expect(result.current.active).toBe(false);
  });
});

describe("joinSelectedChatMessageText", () => {
  it("joins selected bodies in timeline order", () => {
    const text = joinSelectedChatMessageText(
      [
        { id: "b", body: "second", ts: 2 },
        { id: "a", body: "first", ts: 1 },
        { id: "c", body: "skip", ts: 3 },
      ],
      new Set(["b", "a"]),
      (message) => message.body,
    );
    expect(text).toBe("first\nsecond");
  });
});

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WSClient } from "../api/ws-client";
import { useChatRoomScopes } from "./use-chat-room-scopes";

const subscribe = vi.fn();
const unsubscribe = vi.fn();
const client = { subscribe, unsubscribe } as unknown as WSClient;

vi.mock("./provider", () => ({
  useOptionalWS: () => ({ client }),
}));

describe("useChatRoomScopes", () => {
  beforeEach(() => {
    subscribe.mockClear();
    unsubscribe.mockClear();
  });

  it("diffs subscriptions when the room set changes", () => {
    const { rerender, unmount } = renderHook(({ ids }) => useChatRoomScopes(ids), {
      initialProps: { ids: ["a", "b"] },
    });

    expect(subscribe).toHaveBeenCalledWith("chat", "a");
    expect(subscribe).toHaveBeenCalledWith("chat", "b");

    subscribe.mockClear();
    unsubscribe.mockClear();
    rerender({ ids: ["b", "c"] });

    expect(unsubscribe).toHaveBeenCalledWith("chat", "a");
    expect(subscribe).toHaveBeenCalledWith("chat", "c");
    expect(subscribe).not.toHaveBeenCalledWith("chat", "b");

    unmount();
    expect(unsubscribe).toHaveBeenCalledWith("chat", "b");
    expect(unsubscribe).toHaveBeenCalledWith("chat", "c");
  });
});

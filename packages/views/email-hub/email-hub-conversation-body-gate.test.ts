import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetEmailHubConversationBodyGateForTests,
  useEmailHubConversationBodySlot,
} from "./email-hub-conversation-body-gate";

afterEach(() => {
  resetEmailHubConversationBodyGateForTests();
});

describe("useEmailHubConversationBodySlot", () => {
  it("grants at most two concurrent slots", async () => {
    const first = renderHook(() => useEmailHubConversationBodySlot(true));
    const second = renderHook(() => useEmailHubConversationBodySlot(true));
    const third = renderHook(() => useEmailHubConversationBodySlot(true));

    await waitFor(() => {
      expect(first.result.current).toBe(true);
      expect(second.result.current).toBe(true);
    });
    expect(third.result.current).toBe(false);
  });

  it("releases a slot when the holder unmounts", async () => {
    const first = renderHook(() => useEmailHubConversationBodySlot(true));
    const second = renderHook(() => useEmailHubConversationBodySlot(true));
    await waitFor(() => expect(first.result.current).toBe(true));

    first.unmount();
    const third = renderHook(() => useEmailHubConversationBodySlot(true));
    await waitFor(() => expect(third.result.current).toBe(true));
    expect(second.result.current).toBe(true);
  });
});

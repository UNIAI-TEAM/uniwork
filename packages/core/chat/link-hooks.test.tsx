import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as chatApi from "../api/endpoints/chat";
import { resetAuthStoreForTests, setSessionUser } from "../auth";
import type { User } from "../types/user";
import { chatKeys } from "./chat-keys";
import { useChatRoomMessageLinks } from "./link-hooks";
import { patchChatMessageLinked } from "./realtime-cache";

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

function wrapper(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("useChatRoomMessageLinks", () => {
  beforeEach(() => {
    setSessionUser(user);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetAuthStoreForTests();
  });

  it("fetches again only the message a link frame names", async () => {
    const list = vi.spyOn(chatApi, "listChatRoomMessageLinks").mockResolvedValue([]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ids = ["m1", "m2"];
    renderHook(() => useChatRoomMessageLinks("ws1", "room1", ids), { wrapper: wrapper(qc) });
    await waitFor(() => expect(list).toHaveBeenCalledWith("ws1", "room1", ["m1", "m2"]));
    await waitFor(() =>
      expect(qc.getQueryData<Map<string, unknown[]>>(chatKeys.roomMessageLinksRoom("ws1", "room1"))?.size).toBe(2),
    );

    act(() => {
      patchChatMessageLinked(qc, "ws1", "room1", "m1");
    });

    await waitFor(() => expect(list).toHaveBeenLastCalledWith("ws1", "room1", ["m1"]));
    expect(list).toHaveBeenCalledTimes(2);
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, useAuthStore } from "../auth/store";
import type { User } from "../types/user";
import { chatKeys } from "./chat-keys";
import { useSyncChatRoomsOnAuth } from "./use-sync-chat-rooms-on-auth";

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

describe("useSyncChatRoomsOnAuth", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
  });

  it("re-runs ensure + invalidates rooms after auth is lost and regained", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ensureRoom = { mutateAsync: vi.fn().mockResolvedValue({ room_id: "ws-room" }) };
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { rerender } = renderHook(
      () => useSyncChatRoomsOnAuth("ws1", ensureRoom),
      { wrapper: wrapper(qc) },
    );

    useAuthStore.getState().setUser(user);
    rerender();
    await waitFor(() => expect(ensureRoom.mutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: chatKeys.rooms("ws1") }),
    );

    useAuthStore.setState({ user: null, status: "anon" });
    rerender();
    useAuthStore.getState().setUser(user);
    rerender();

    await waitFor(() => expect(ensureRoom.mutateAsync).toHaveBeenCalledTimes(2));
  });
});

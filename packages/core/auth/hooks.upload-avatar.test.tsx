import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../types/user";
import { workspaceKeys } from "../workspaces/keys";

vi.mock("../api/endpoints/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/endpoints/auth")>();
  return {
    ...actual,
    uploadAvatar: vi.fn(),
  };
});

import * as auth from "../api/endpoints/auth";
import { useUploadAvatar } from "./hooks";
import { resetAuthStoreForTests, useAuthStore } from "./store";

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  avatar_url: "https://cdn/a.png",
  onboarded_at: null,
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

describe("useUploadAvatar", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    vi.mocked(auth.uploadAvatar).mockReset();
  });

  it("updates the session user and refreshes workspace member lists", async () => {
    vi.mocked(auth.uploadAvatar).mockResolvedValue(user);
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useUploadAvatar(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    await result.current.mutateAsync(new File(["x"], "a.png", { type: "image/png" }));

    await waitFor(() => expect(useAuthStore.getState().user?.avatar_url).toBe("https://cdn/a.png"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: workspaceKeys.allMembers() });
  });
});

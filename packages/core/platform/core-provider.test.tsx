import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/endpoints/auth", () => ({
  refreshSession: vi.fn().mockResolvedValue(null),
  logout: vi.fn(),
}));

import * as auth from "../api/endpoints/auth";
import { resetAuthStoreForTests, useAuthStore } from "../auth/store";
import { useCommentDraftStore } from "../tasks/stores/comment-draft-store";
import type { User } from "../types/user";
import { CoreProvider } from "./core-provider";
import { defaultStorage } from "./storage";

// Drafts are only written while someone is signed in.
const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

describe("CoreProvider", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    vi.mocked(auth.refreshSession).mockClear();
  });

  it("resolves the session exactly once even under StrictMode's double mount", async () => {
    // The refresh endpoint rotates the cookie, so a second call would present
    // an already-revoked token and log the user out for no reason.
    render(
      <StrictMode>
        <CoreProvider>
          <div>app</div>
        </CoreProvider>
      </StrictMode>,
    );
    await vi.waitFor(() => expect(auth.refreshSession).toHaveBeenCalledTimes(1));
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("renders its children", () => {
    const { getByText } = render(
      <CoreProvider>
        <div>app</div>
      </CoreProvider>,
    );
    expect(getByText("app")).toBeInTheDocument();
  });
  it("clears registered draft stores' in-memory state on logout", async () => {
    // Cross-user leak on a shared device: logout navigates client-side
    // (`replace(paths.login())`), so the Zustand singleton is never torn down
    // and the next user on the same tab would otherwise open the same task and
    // read the previous user's unsent comment. Deliberately routed through the
    // real seam — render the provider, then call the store's own `logout` —
    // because invoking the reset callback by hand would still pass if nothing
    // in production ever registered it, which was the actual bug.
    useAuthStore.getState().setUser(user);
    render(
      <CoreProvider>
        <div>app</div>
      </CoreProvider>,
    );

    useCommentDraftStore.getState().setDraft("task-1", "user A's unsent text");
    expect(useCommentDraftStore.getState().draftFor("task-1")).toBe("user A's unsent text");

    await useAuthStore.getState().logout();

    expect(useCommentDraftStore.getState().drafts).toEqual({});
    expect(useCommentDraftStore.getState().draftFor("task-1")).toBe("");
  });

  it("removes registered global draft keys from storage on logout, not only from memory", async () => {
    // Memory alone is half the leak: the persisted key survives logout, so the
    // next user on the same browser reloads the page, zustand rehydrates it
    // and the previous user's unsent comment is back. Same real seam as above.
    useAuthStore.getState().setUser(user);
    render(
      <CoreProvider>
        <div>app</div>
      </CoreProvider>,
    );

    useCommentDraftStore.getState().setDraft("task-1", "user A's unsent text");
    expect(defaultStorage.getItem("uniwork_task_comment_drafts")).toContain("user A's unsent text");

    await useAuthStore.getState().logout();

    expect(useCommentDraftStore.getState().drafts).toEqual({});
    // Null, not an empty persisted state: resetting memory writes through
    // `persist`, so storage must be cleared after the reset, not before it.
    expect(defaultStorage.getItem("uniwork_task_comment_drafts")).toBeNull();
  });

  it("clears the query cache on logout even when callers use the auth store directly", async () => {
    useAuthStore.getState().setUser(user);
    let qc: QueryClient | null = null;

    function CaptureClient() {
      qc = useQueryClient();
      return null;
    }

    render(
      <CoreProvider>
        <CaptureClient />
      </CoreProvider>,
    );

    await waitFor(() => expect(qc).not.toBeNull());
    qc!.setQueryData(["chat", "rooms", "ws1"], [{ id: "room1" }]);
    await useAuthStore.getState().logout();
    expect(qc!.getQueryData(["chat", "rooms", "ws1"])).toBeUndefined();
  });
});

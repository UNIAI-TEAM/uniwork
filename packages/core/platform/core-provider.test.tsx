import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/endpoints/auth", () => ({
  refreshSession: vi.fn().mockResolvedValue(null),
  logout: vi.fn(),
}));

import * as auth from "../api/endpoints/auth";
import { resetAuthStoreForTests, useAuthStore } from "../auth/store";
import { useCommentDraftStore } from "../tasks/stores/comment-draft-store";
import { CoreProvider } from "./core-provider";

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
});

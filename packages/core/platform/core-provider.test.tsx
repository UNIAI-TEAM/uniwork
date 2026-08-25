import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/endpoints/auth", () => ({
  refreshSession: vi.fn().mockResolvedValue(null),
  logout: vi.fn(),
}));

import * as auth from "../api/endpoints/auth";
import { resetAuthStoreForTests } from "../auth/store";
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
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { InviteErrorBody } from "./invite-error";

const me: User = {
  id: "u1",
  email: "a@b.co",
  display_name: "A",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarded_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(me);
});

const logoutCalls = () => requestMock.mock.calls.filter(([path]) => String(path).endsWith("/auth/logout"));

describe("InviteErrorBody", () => {
  it("signs out once however often 'use another account' is pressed, and shows it working", async () => {
    // The sign-out never answers, so the button stays in its working state.
    requestMock.mockImplementation(() => new Promise(() => {}));
    render(wrapWithNav(<InviteErrorBody reason="wrongAccount" onRetry={() => {}} />));
    const button = screen.getByRole("button", { name: "Dùng tài khoản khác" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(logoutCalls()).toHaveLength(1));
  });

  it("leaves aria-disabled off the sign-out button while it is idle", () => {
    render(wrapWithNav(<InviteErrorBody reason="wrongAccount" onRetry={() => {}} />));
    const button = screen.getByRole("button", { name: "Dùng tài khoản khác" });
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("shows the retry working while the invitation is read again, and does not ask twice", () => {
    const onRetry = vi.fn();
    render(wrapWithNav(<InviteErrorBody reason="failed" onRetry={onRetry} retrying />));
    const retry = screen.getByRole("button", { name: "Thử lại" });
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(retry).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("retries on a press when nothing is being read", () => {
    const onRetry = vi.fn();
    render(wrapWithNav(<InviteErrorBody reason="rateLimited" onRetry={onRetry} />));
    const retry = screen.getByRole("button", { name: "Thử lại" });
    expect(retry).not.toHaveAttribute("aria-busy");
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

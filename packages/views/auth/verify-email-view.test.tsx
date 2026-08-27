import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { VerifyEmailView } from "./verify-email-view";

initI18n();

const user = {
  id: "u1", email: "a@b.co", display_name: "A",
  onboarded_at: null, email_verified_at: null, onboarding_questionnaire: {},
};

function otpInput() {
  return screen.getByLabelText("Mã xác thực");
}

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(user);
});
afterEach(() => vi.useRealTimers());

describe("VerifyEmailView", () => {
  it("shows the address the code went to and focuses the code input", () => {
    render(wrapWithNav(<VerifyEmailView onSuccess={() => {}} />));
    expect(screen.getByText(/a@b\.co/)).toBeInTheDocument();
    expect(otpInput()).toHaveFocus();
    expect(otpInput()).toHaveAttribute("autocomplete", "one-time-code");
  });

  it("submits as soon as six digits are in and hands the verified user to onSuccess", async () => {
    const onSuccess = vi.fn();
    requestMock.mockResolvedValue({ user: { ...user, email_verified_at: "2026-08-27T00:00:00Z" } });
    render(wrapWithNav(<VerifyEmailView onSuccess={onSuccess} />));
    fireEvent.change(otpInput(), { target: { value: "123456" } });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(requestMock).toHaveBeenCalledWith("/api/v1/me/email/verify", expect.objectContaining({ body: { code: "123456" } }));
    expect(onSuccess.mock.calls[0]![0].email_verified_at).toBe("2026-08-27T00:00:00Z");
  });

  it("marks the code invalid and clears it when the server rejects it", async () => {
    requestMock.mockRejectedValue(new ApiError("bad", "invalid_code", 400));
    render(wrapWithNav(<VerifyEmailView onSuccess={() => {}} />));
    fireEvent.change(otpInput(), { target: { value: "000000" } });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Mã không đúng hoặc đã hết hạn. Nhập lại hoặc gửi mã mới.");
    expect(otpInput()).toHaveAttribute("aria-invalid", "true");
    expect(otpInput()).toHaveValue("");
  });

  it("keeps resend locked for 60s after arriving, then sends and locks again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    requestMock.mockResolvedValue({ status: "ok" });
    render(wrapWithNav(<VerifyEmailView onSuccess={() => {}} />));
    const locked = screen.getByRole("button", { name: /Gửi lại sau 60s/ });
    expect(locked).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(locked);
    expect(requestMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const resend = screen.getByRole("button", { name: "Gửi lại mã" });
    fireEvent.click(resend);
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/me/email/resend", expect.anything()));
    await screen.findByText("Đã gửi mã mới.");
    expect(screen.getByRole("button", { name: /Gửi lại sau 60s/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("treats a 429 on resend as a fresh cooldown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    requestMock.mockRejectedValue(new ApiError("slow down", "rate_limited", 429));
    render(wrapWithNav(<VerifyEmailView onSuccess={() => {}} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi lại mã" }));
    await screen.findByText("Vừa gửi một mã rồi, chờ một phút rồi thử lại.");
    expect(screen.getByRole("button", { name: /Gửi lại sau/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("offers a way out for the wrong account", async () => {
    requestMock.mockResolvedValue({ status: "ok" });
    render(wrapWithNav(<VerifyEmailView onSuccess={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/auth/logout", expect.anything()));
  });
});

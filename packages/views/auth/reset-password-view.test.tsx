import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ResetPasswordView } from "./reset-password-view";

initI18n();

const user = { id: "u1", email: "a@b.c", display_name: "A" };

function fillMatchingPasswords() {
  fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "newpassword1" } });
  fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu"), { target: { value: "newpassword1" } });
}

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
});

describe("ResetPasswordView", () => {
  it("blocks submit when passwords differ and shows invalid token error", async () => {
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={vi.fn()} />));
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "newpassword1" } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu"), { target: { value: "newpassword2" } });
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(screen.getByText("Hai mật khẩu chưa khớp")).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
    // Editing either field clears the stale message.
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu"), { target: { value: "newpassword1" } });
    expect(screen.queryByText("Hai mật khẩu chưa khớp")).not.toBeInTheDocument();
  });

  it("rejects a short password before calling the server", () => {
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={vi.fn()} />));
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(screen.getByText("Mật khẩu cần ít nhất 8 ký tự")).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("shows the invalid-token state with a link back to forgot-password on invalid_token", async () => {
    requestMock.mockRejectedValue(new ApiError("bad token", "invalid_token", 400));
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={vi.fn()} />));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(await screen.findByText("Link đã hết hạn hoặc đã được dùng.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Yêu cầu link mới" })).toHaveAttribute("href", "/forgot-password");
  });

  it("hands the new session to onSuccess when the passwords match", async () => {
    requestMock.mockResolvedValue({ user, access_token: "tok-9" });
    const onSuccess = vi.fn();
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={onSuccess} />));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ access_token: "tok-9", user: expect.objectContaining(user) }),
    );
  });
});

describe("ResetPasswordView focus", () => {
  it("moves focus to the field that owns the error", () => {
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={vi.fn()} />));
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "newpassword1" } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu"), { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(screen.getByLabelText("Nhập lại mật khẩu")).toHaveFocus();
  });

  it("moves focus to the heading when the token turns out invalid", async () => {
    requestMock.mockRejectedValue(new ApiError("bad token", "invalid_token", 400));
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={vi.fn()} />));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Link không còn hiệu lực" })).toHaveFocus();
  });
});

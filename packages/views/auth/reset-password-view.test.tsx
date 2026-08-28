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
  });

  it("shows the invalid-token state with a link back to forgot-password on invalid_token", async () => {
    requestMock.mockRejectedValue(new ApiError("bad token", "invalid_token", 400));
    render(wrapWithNav(<ResetPasswordView token="t" onSuccess={vi.fn()} />));
    fillMatchingPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(await screen.findByText("Link đã hết hạn hoặc đã dùng. Yêu cầu link mới.")).toBeInTheDocument();
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

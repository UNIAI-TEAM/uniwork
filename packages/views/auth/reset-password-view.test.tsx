import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ResetPasswordView } from "./reset-password-view";

initI18n();

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
});

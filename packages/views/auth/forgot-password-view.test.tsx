import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ForgotPasswordView } from "./forgot-password-view";

initI18n();

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
});

describe("ForgotPasswordView", () => {
  it("shows the sent state with the email after submit", async () => {
    requestMock.mockResolvedValue({ status: "ok" });
    render(wrapWithNav(<ForgotPasswordView />));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi link đặt lại" }));
    expect(await screen.findByText(/Nếu a@b.c có tài khoản/)).toBeInTheDocument();
    // Resend is cooling down right after the first send; the mail may still be on its way.
    expect(screen.getByRole("button", { name: /Gửi lại sau/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Kiểm tra thư mục spam");
  });

  it("returns to the form with the typed email when the address was wrong", async () => {
    requestMock.mockResolvedValue({ status: "ok" });
    render(wrapWithNav(<ForgotPasswordView />));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi link đặt lại" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sửa email" }));
    expect(screen.getByLabelText("Email")).toHaveValue("a@b.c");
  });

  it("shows a generic error and keeps the form on a server failure", async () => {
    requestMock.mockRejectedValue(new ApiError("boom", "internal_error", 500));
    render(wrapWithNav(<ForgotPasswordView />));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi link đặt lại" }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});

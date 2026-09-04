import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { NavigationProvider } from "@uniwork/views/navigation";
import type { NavigationAdapter } from "@uniwork/views/navigation";
import { localeAdapter } from "../test/api-mock";
import { requestMock } from "../test/request-mock";
import { RegisterView } from "./register-view";

initI18n();

function adapter() {
  const push = vi.fn<(path: string) => void>();
  const value: NavigationAdapter = {
    push,
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/register",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => "http://app.test" + p,
  };
  return Object.assign(value, { push });
}

function wrap(ui: React.ReactElement, nav: NavigationAdapter = adapter()) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <LocaleAdapterProvider adapter={localeAdapter}>
        <NavigationProvider value={nav}>{ui}</NavigationProvider>
      </LocaleAdapterProvider>
    </QueryClientProvider>
  );
}

function fill() {
  fireEvent.change(screen.getByLabelText("Tên hiển thị"), { target: { value: "An" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
  fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "hunter22" } });
}

const SESSION = {
  access_token: "tok",
  user: { id: "u1", email: "a@b.co", display_name: "An" },
};

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
});

describe("RegisterView", () => {
  it("renders name, email and password fields with a submit", () => {
    render(wrap(<RegisterView onSuccess={() => {}} />));
    expect(screen.getByLabelText("Tên hiển thị")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đăng ký" })).toBeInTheDocument();
  });

  it("points a taken email at the email field and leaves the others clean", async () => {
    requestMock.mockRejectedValue(new ApiError("taken", "conflict", 409));
    render(wrap(<RegisterView onSuccess={() => {}} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng ký" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email đã được đăng ký");
    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email.getAttribute("aria-describedby")).toContain(alert.id);
    expect(screen.getByLabelText("Tên hiển thị")).not.toHaveAttribute("aria-invalid");
  });

  it("keeps the submit button reachable while the request is in flight", async () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    render(wrap(<RegisterView onSuccess={() => {}} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng ký" }));

    const button = await screen.findByRole("button", { name: "Đang tạo tài khoản…" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
  });

  it("tells the user the password minimum before they submit", () => {
    render(wrap(<RegisterView onSuccess={() => {}} />));
    const password = screen.getByLabelText("Mật khẩu");
    const describedBy = password.getAttribute("aria-describedby") ?? "";
    const hint = describedBy
      .split(" ")
      .map((id) => document.getElementById(id))
      .find((el) => el?.textContent === "Ít nhất 8 ký tự");
    expect(hint).toBeTruthy();
    expect(password).toHaveAttribute("minlength", "8");
  });

  it("carries the password manager hints browsers key autofill off", () => {
    render(wrap(<RegisterView onSuccess={() => {}} />));
    expect(screen.getByLabelText("Tên hiển thị")).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute("autocomplete", "new-password");
  });

  it("routes the log-in link through the navigation adapter instead of a page load", () => {
    const nav = adapter();
    render(wrap(<RegisterView onSuccess={() => {}} />, nav));

    fireEvent.click(screen.getByRole("link", { name: "Đăng nhập" }));

    expect(nav.push).toHaveBeenCalledWith("/login");
  });

  it("hands the session to onSuccess", async () => {
    const onSuccess = vi.fn();
    requestMock.mockResolvedValue(SESSION);
    render(wrap(<RegisterView onSuccess={onSuccess} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng ký" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });
});

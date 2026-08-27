import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { NavigationProvider } from "@uniwork/views/navigation";
import type { NavigationAdapter } from "@uniwork/views/navigation";
import { requestMock } from "../test/request-mock";
import { LoginView } from "./login-view";

initI18n();

function adapter() {
  const push = vi.fn<(path: string) => void>();
  const value: NavigationAdapter = {
    push,
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/login",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => "http://app.test" + p,
  };
  return Object.assign(value, { push });
}

function wrap(ui: React.ReactElement, nav: NavigationAdapter = adapter()) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <NavigationProvider value={nav}>{ui}</NavigationProvider>
    </QueryClientProvider>
  );
}

function fill() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
  fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "hunter22" } });
}

/** The Google button also asks /auth/providers, so count only the login call. */
function loginCalls() {
  return requestMock.mock.calls.filter(([path]) => path === "/api/v1/auth/login");
}

const SESSION = {
  access_token: "tok",
  user: { id: "u1", email: "a@b.co", display_name: "A" },
};

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
});

describe("LoginView", () => {
  it("renders email/password fields and submit", () => {
    render(wrap(<LoginView onSuccess={() => {}} />));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeInTheDocument();
  });

  it("marks both fields invalid and points them at the error when credentials are rejected", async () => {
    requestMock.mockRejectedValue(new ApiError("nope", "invalid_credentials", 401));
    render(wrap(<LoginView onSuccess={() => {}} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email hoặc mật khẩu không đúng");
    expect(alert.id).toBeTruthy();
    for (const label of ["Email", "Mật khẩu"]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field.getAttribute("aria-describedby")).toBe(alert.id);
    }
  });

  it("keeps the submit button reachable while the request is in flight", async () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    render(wrap(<LoginView onSuccess={() => {}} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));

    // aria-disabled, not disabled: a `disabled` button leaves the tab order,
    // so a keyboard user can never reach it to hear the pending state.
    const button = await screen.findByRole("button", { name: "Đang đăng nhập…" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
  });

  it("does not submit twice while a request is in flight", async () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    render(wrap(<LoginView onSuccess={() => {}} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    await screen.findByRole("button", { name: "Đang đăng nhập…" });
    fireEvent.click(screen.getByRole("button", { name: "Đang đăng nhập…" }));

    expect(loginCalls()).toHaveLength(1);
  });

  it("reveals the password without submitting the form", () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    render(wrap(<LoginView onSuccess={() => {}} />));
    fill();
    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Hiện mật khẩu" }));

    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ẩn mật khẩu" })).toHaveAttribute("aria-pressed", "true");
    // A bare <button> inside a <form> defaults to type="submit".
    expect(loginCalls()).toHaveLength(0);
  });

  it("carries the password manager hints browsers key autofill off", () => {
    render(wrap(<LoginView onSuccess={() => {}} />));
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute("autocomplete", "current-password");
  });

  it("routes the sign-up link through the navigation adapter instead of a page load", () => {
    const nav = adapter();
    render(wrap(<LoginView onSuccess={() => {}} />, nav));

    fireEvent.click(screen.getByRole("link", { name: "Đăng ký" }));

    expect(nav.push).toHaveBeenCalledWith("/register");
  });

  it("shows the Google error as a form-level alert without blaming the fields", () => {
    render(wrap(<LoginView onSuccess={() => {}} initialError="google_denied" />));
    expect(screen.getByRole("alert")).toHaveTextContent("Bạn đã hủy đăng nhập Google.");
    // The fields were never submitted; marking them invalid would send a
    // screen-reader user hunting for a typo that does not exist.
    for (const label of ["Email", "Mật khẩu"]) {
      expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-invalid");
    }
  });

  it("renders the Google sign-in as a real link, not a button acting as one", async () => {
    requestMock.mockResolvedValue({ google: true });
    render(wrap(<LoginView onSuccess={() => {}} />));
    const link = await screen.findByRole("link", { name: "Tiếp tục với Google" });
    expect(link.tagName).toBe("A");
    expect(link).not.toHaveAttribute("role");
    expect(link).not.toHaveAttribute("type");
  });

  it("offers Google when the deployment has it", async () => {
    requestMock.mockResolvedValue({ google: true });
    render(wrap(<LoginView onSuccess={() => {}} next="/acme/team" />));
    const link = await screen.findByRole("link", { name: "Tiếp tục với Google" });
    expect(link.getAttribute("href")).toContain("/api/v1/auth/google/start?next=%2Facme%2Fteam");
  });

  it("hands the session to onSuccess", async () => {
    const onSuccess = vi.fn();
    requestMock.mockResolvedValue(SESSION);
    render(wrap(<LoginView onSuccess={onSuccess} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });
});

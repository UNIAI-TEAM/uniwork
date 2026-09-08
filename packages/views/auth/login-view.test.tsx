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
      <LocaleAdapterProvider adapter={localeAdapter}>
        <NavigationProvider value={nav}>{ui}</NavigationProvider>
      </LocaleAdapterProvider>
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

  it("asks for the email before sending anything and moves focus there", () => {
    render(wrap(<LoginView onSuccess={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));

    expect(loginCalls()).toHaveLength(0);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Nhập email của bạn");
    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email.getAttribute("aria-describedby")).toBe(alert.id);
    expect(email).toHaveFocus();
    // The password was never judged; blaming it sends the user to the wrong box.
    const password = screen.getByLabelText("Mật khẩu");
    expect(password).not.toHaveAttribute("aria-invalid");
    // And the message sits under the email box, before the password box in
    // reading order — not under the field it is not about.
    expect(alert.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("rejects a malformed email before it reaches the network", () => {
    render(wrap(<LoginView onSuccess={() => {}} />));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));

    expect(loginCalls()).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Email chưa đúng, ví dụ ten@congty.vn");
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("asks for the password when only the email is filled", () => {
    render(wrap(<LoginView onSuccess={() => {}} />));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));

    expect(loginCalls()).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Nhập mật khẩu");
    expect(screen.getByLabelText("Mật khẩu")).toHaveFocus();
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
  });

  it.each([
    ["a lost connection", new TypeError("Failed to fetch"), "Không kết nối được. Kiểm tra mạng rồi thử lại."],
    ["a server failure", new ApiError("boom", "internal", 500), "UniWork đang gặp sự cố. Thử lại sau ít phút."],
    ["rate limiting", new ApiError("slow down", "rate_limited", 429), "Thử quá nhiều lần. Chờ một phút rồi thử lại."],
  ])("reports %s at form level without blaming the fields", async (_name, error, message) => {
    requestMock.mockRejectedValue(error);
    render(wrap(<LoginView onSuccess={() => {}} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    for (const label of ["Email", "Mật khẩu"]) {
      expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-invalid");
    }
    // Nothing the user typed is lost.
    expect(screen.getByLabelText("Email")).toHaveValue("a@b.co");
    expect(screen.getByLabelText("Mật khẩu")).toHaveValue("hunter22");
  });

  it("puts focus on the password after rejected credentials so the retry starts there", async () => {
    requestMock.mockRejectedValue(new ApiError("nope", "invalid_credentials", 401));
    render(wrap(<LoginView onSuccess={() => {}} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText("Mật khẩu")).toHaveFocus();
  });

  it("clears the error as soon as the user edits a field", async () => {
    requestMock.mockRejectedValue(new ApiError("nope", "invalid_credentials", 401));
    render(wrap(<LoginView onSuccess={() => {}} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    await screen.findByRole("alert");

    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "hunter23" } });

    expect(screen.queryByRole("alert")).toBeNull();
    for (const label of ["Email", "Mật khẩu"]) {
      expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-invalid");
    }
  });

  it("keeps focus on the language switch instead of jumping to the heading", async () => {
    const i18n = initI18n();
    render(wrap(<LoginView onSuccess={() => {}} />));
    // Two switches: one in the rail, one in the phone header; CSS hides one.
    const toEnglish = screen.getAllByRole("button", { name: "Chuyển sang English" })[0]!;
    toEnglish.focus();
    fireEvent.click(toEnglish);
    await screen.findByRole("heading", { name: "Log in" });

    expect(screen.getByRole("heading", { name: "Log in" })).not.toHaveFocus();
    expect(screen.getAllByRole("button", { name: "Switch to Tiếng Việt" })[0]).toHaveFocus();
    await i18n.changeLanguage("vi");
    document.documentElement.lang = "vi";
  });

  it("selects the rejected password so the retry replaces it in one keystroke", async () => {
    requestMock.mockRejectedValue(new ApiError("nope", "invalid_credentials", 401));
    render(wrap(<LoginView onSuccess={() => {}} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    await screen.findByRole("alert");

    const password = screen.getByLabelText("Mật khẩu") as HTMLInputElement;
    expect(password).toHaveFocus();
    expect(password.selectionStart).toBe(0);
    expect(password.selectionEnd).toBe("hunter22".length);
  });

  it("hands the session to onSuccess", async () => {
    const onSuccess = vi.fn();
    requestMock.mockResolvedValue(SESSION);
    render(wrap(<LoginView onSuccess={onSuccess} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("switches to the MFA step on a challenge and finishes sign-in with the code", async () => {
    const onSuccess = vi.fn();
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/login") return Promise.resolve({ mfa_required: true, mfa_token: "chal" });
      if (path === "/api/v1/auth/mfa/verify") return Promise.resolve(SESSION);
      return Promise.resolve({ google: false });
    });
    render(wrap(<LoginView onSuccess={onSuccess} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));

    const code = await screen.findByLabelText("Mã xác thực");
    expect(onSuccess).not.toHaveBeenCalled();
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));

    // mutate-level onSuccess also receives variables/context; only the session matters.
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess.mock.calls[0]?.[0]).toMatchObject({ access_token: "tok" });
    const verify = requestMock.mock.calls.find(([path]) => path === "/api/v1/auth/mfa/verify");
    expect(verify?.[1]).toMatchObject({ body: { mfa_token: "chal", code: "123456" } });
  });

  it("opens on the code step for /login?mfa=1 and sends the cookie-only shape", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/v1/auth/mfa/verify" ? SESSION : { google: false }),
    );
    render(wrap(<LoginView onSuccess={() => {}} initialMfa />));
    fireEvent.change(screen.getByLabelText("Mã xác thực"), { target: { value: "abcde-fghij" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() =>
      expect(requestMock.mock.calls.find(([path]) => path === "/api/v1/auth/mfa/verify")?.[1]).toMatchObject({
        body: { mfa_token: "", code: "abcde-fghij" },
      }),
    );
    // Back returns to the password form.
    fireEvent.click(screen.getByRole("button", { name: "Quay lại đăng nhập" }));
    expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument();
  });
});

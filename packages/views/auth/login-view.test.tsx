import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { NavigationProvider } from "@uniwork/views/navigation";
import type { NavigationAdapter } from "@uniwork/views/navigation";
import { localeAdapter } from "../test/api-mock";
import { requestMock } from "../test/request-mock";
import { LoginView } from "./login-view";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

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

/** The provider buttons also ask /auth/providers, so count only the login call. */
function loginCalls() {
  return requestMock.mock.calls.filter(([path]) => path === "/api/v1/auth/login");
}

const SESSION = {
  access_token: "tok",
  user: { id: "u1", email: "a@b.co", display_name: "A" },
};

beforeEach(async () => {
  requestMock.mockReset();
  toastMock.success.mockReset();
  toastMock.warning.mockReset();
  resetAuthStoreForTests();
  localeAdapter.persist.mockClear();
  await setLocale("vi");
  document.documentElement.lang = "vi";
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

  // S15 row 5: a comment deep link that met no session says so above the form.
  it.each([
    ["/acme/team/documents/d1?comment=c1", true],
    ["/acme/team/documents/d1?tab=x&comment=c1", true],
    ["/acme/team/documents/d1", false],
    ["/acme/team/documents/d1?comment=", false],
    ["/acme/team/tasks/t1?comment=c1", false],
  ])("says the session ended for next=%s only when it opens a comment (%s)", (next, shown) => {
    render(wrap(<LoginView onSuccess={() => {}} next={next} reason="session_expired" />));
    const sentence = screen.queryByText("Phiên đăng nhập đã hết. Hãy đăng nhập lại để mở bình luận này.");
    if (shown) expect(sentence).toBeInTheDocument();
    else expect(sentence).toBeNull();
  });

  // R10 F3: someone who never signed in here is not told their session ended.
  it("shows the plain sign-in for a comment link when no session existed", () => {
    render(wrap(<LoginView onSuccess={() => {}} next="/acme/team/documents/d1?comment=c1" />));
    expect(screen.queryByText("Phiên đăng nhập đã hết. Hãy đăng nhập lại để mở bình luận này.")).toBeNull();
    expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeInTheDocument();
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

  // The one table of /login?error= codes (spec §3.4, §4.2).
  it.each([
    ["google_failed", "Chưa đăng nhập được bằng Google. Thử lại, hoặc dùng email."],
    ["google_unverified", "Google chưa xác minh email của tài khoản này. Dùng tài khoản Google khác, hoặc đăng nhập bằng email."],
    ["apple_failed", "Chưa đăng nhập được bằng Apple. Thử lại, hoặc dùng email."],
    ["sign_in_conflict", "Email này đã có tài khoản UniWork dùng một cách đăng nhập khác. Đăng nhập bằng cách đó."],
    ["sign_in_unverified", "Email của tài khoản này chưa được xác minh. Dùng cách đăng nhập khác."],
    ["sign_in_account_unverified", 'Email này đã có tài khoản UniWork nhưng chưa được xác minh. Chọn "Quên mật khẩu?" để nhận link qua email và lấy lại tài khoản.'],
    ["sign_in_failed", "Chưa hoàn tất đăng nhập. Thử lại."],
  ])("shows ?error=%s as a form-level alert without blaming the fields", (code, sentence) => {
    render(wrap(<LoginView onSuccess={() => {}} redirectError={code} />));
    expect(screen.getByRole("alert")).toHaveTextContent(sentence);
    // The fields were never submitted; marking them invalid would send a
    // screen-reader user hunting for a typo that does not exist.
    for (const label of ["Email", "Mật khẩu"]) {
      expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-invalid");
    }
  });

  it.each([
    ["google_denied", "Bạn đã hủy đăng nhập Google."],
    ["apple_denied", "Bạn đã hủy đăng nhập Apple."],
  ])("says a cancelled provider sign-in (%s) as a status, not an alarm", (code, sentence) => {
    render(wrap(<LoginView onSuccess={() => {}} redirectError={code} />));
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(sentence);
    // A glyph keeps the quiet band from reading as a read-only field.
    expect(notice.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["google_", "apple_exploded", "<script>", "sign_in_failed "])(
    "ignores the unknown code %j rather than showing it",
    (code) => {
      const { container } = render(wrap(<LoginView onSuccess={() => {}} redirectError={code} />));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
      expect(container.textContent).not.toContain(code.trim());
    },
  );

  it("drops the provider's error once the form speaks for itself", () => {
    render(wrap(<LoginView onSuccess={() => {}} redirectError="google_failed" />));
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Nhập email của bạn");
  });

  it("puts the provider buttons above the form and keeps next on them", async () => {
    requestMock.mockResolvedValue({ google: true, apple: false, apple_web: true, google_native: false });
    render(wrap(<LoginView onSuccess={() => {}} next="/acme/team" />));
    const google = await screen.findByRole("link", { name: "Tiếp tục với Google" });
    expect(google.getAttribute("href")).toContain("/api/v1/auth/google/start?next=%2Facme%2Fteam");
    expect(screen.getByRole("link", { name: "Tiếp tục với Apple" }).getAttribute("href")).toContain(
      "/api/v1/auth/apple/start?next=%2Facme%2Fteam",
    );
    expect(google.compareDocumentPosition(screen.getByLabelText("Email")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Links, not buttons: the page keeps exactly one button named "Đăng nhập" (e2e/auth-nav.ts).
    expect(screen.getAllByRole("button", { name: /Đăng nhập/ })).toHaveLength(1);
  });

  it("keeps next on the way to register", () => {
    const nav = adapter();
    render(wrap(<LoginView onSuccess={() => {}} next="/auth/desktop/authorize?attempt_id=a1" />, nav));
    fireEvent.click(screen.getByRole("link", { name: "Đăng ký" }));
    expect(nav.push).toHaveBeenCalledWith("/register?next=%2Fauth%2Fdesktop%2Fauthorize%3Fattempt_id%3Da1");
  });

  it("says once, on the way out, that the provider waiting to be linked was not", async () => {
    const onSuccess = vi.fn();
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/v1/auth/mfa/verify" ? { ...SESSION, link_skipped: "sign_in_method_taken" } : {}),
    );
    render(wrap(<LoginView onSuccess={onSuccess} initialMfa />));
    fireEvent.change(screen.getByLabelText("Mã xác thực"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
    expect(toastMock.warning.mock.calls[0]?.[0]).toBe(
      "Bạn đã đăng nhập, nhưng chưa liên kết được cách đăng nhập vừa dùng. Liên kết lại trong Cài đặt.",
    );
  });

  it("says nothing extra after an ordinary sign-in", async () => {
    requestMock.mockResolvedValue(SESSION);
    const onSuccess = vi.fn();
    render(wrap(<LoginView onSuccess={onSuccess} />));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(toastMock.warning).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("starts at the top when Google or Apple is offered, and in the email field when the form is the only way", async () => {
    requestMock.mockResolvedValue({ google: false, apple: false, apple_web: true, google_native: false });
    const { unmount } = render(wrap(<LoginView onSuccess={() => {}} />));
    await screen.findByRole("link", { name: "Tiếp tục với Apple" });
    expect(document.activeElement).toBe(document.body);
    unmount();

    requestMock.mockResolvedValue({ google: false, apple: true, apple_web: false, google_native: true });
    render(wrap(<LoginView onSuccess={() => {}} />));
    // The iPhone's own Apple and the app's Google are not ways in on the web.
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveFocus());
  });

  it("keeps a join next on the register link", () => {
    const nav = adapter();
    const next = "/join/l1#secret=s3cret";
    render(wrap(<LoginView onSuccess={() => {}} next={next} />, nav));
    fireEvent.click(screen.getByRole("link", { name: "Đăng ký" }));
    expect(nav.push).toHaveBeenCalledWith(`/register?next=${encodeURIComponent(next)}`);
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
    render(wrap(<LoginView onSuccess={() => {}} />));
    // Two switches: desktop rail first, mobile header second; jsdom only lays out the latter.
    const toEnglish = screen.getAllByRole("radio", { name: "English" }).at(-1)!;
    toEnglish.focus();
    fireEvent.click(toEnglish);
    await screen.findByRole("heading", { name: "Sign in" });

    expect(screen.getByRole("heading", { name: "Sign in" })).not.toHaveFocus();
    // Whichever switch is visible/focused — not necessarily index 0 in DOM order.
    expect(document.activeElement).toHaveAccessibleName("English");
    expect(document.activeElement).toBeChecked();
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

  it("says how long a locked second factor waits, and holds the code until then", async () => {
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/auth/mfa/verify"
        ? Promise.reject(new ApiError("locked", "second_factor_locked", 429, undefined, { retry_after: 900 }))
        : Promise.resolve({ google: false }),
    );
    render(wrap(<LoginView onSuccess={() => {}} initialMfa />));
    fireEvent.change(screen.getByLabelText("Mã xác thực"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    // Not "wait a minute": the tenth wrong code locks it for fifteen.
    expect(await screen.findByText(/Xác thực hai lớp đang tạm khóa vì nhập sai nhiều lần\./)).toHaveTextContent(
      "Thử lại sau 15 phút.",
    );
    const submit = screen.getByRole("button", { name: "Xác nhận" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(screen.getByLabelText("Mã xác thực"), { target: { value: "654321" } });
    fireEvent.click(submit);
    const verifies = requestMock.mock.calls.filter(([path]) => path === "/api/v1/auth/mfa/verify");
    expect(verifies).toHaveLength(1);
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

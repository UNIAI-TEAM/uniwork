import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { toast } from "sonner";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { SignInMethodsSection } from "./security-sign-in-methods";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

initI18n();

/**
 * Settings › Sign-in methods (spec §4.5, §4.6): every proof the dialog
 * takes, the ten minutes a proof spares, the last way in and Apple's relay
 * held back with their reason, the UniChat shell linking through the
 * browser, and the result a provider round trip comes back with.
 */
const USER = {
  id: "u1", email: "an@company.vn", display_name: "An", onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z", onboarding_questionnaire: {}, locale: "vi", has_password: true,
};
const METHODS = {
  password: { set: true, changed_at: "2026-10-12T08:00:00Z" },
  google: { linked: true, email: "an@gmail.com", linked_at: "2026-10-01T08:00:00Z" },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: ["password", "email_code"],
};
const PROVIDERS = { google: true, apple: false, apple_web: true, google_native: false };
const GRANT = { step_up_token: "sut-1", expires_at: new Date(Date.now() + 600_000).toISOString(), method: "password" };
const CHANGE = (methods: unknown) => ({ user: USER, sign_in_methods: methods });
/** The sign-in a Settings link left waiting when the identity sits on an empty account. */
const APPLE_TICKET = { kind: "link_required", provider: "apple", email: "an@icloud.com", name: "", private_relay: false };

type Answer = unknown | ((body: Record<string, unknown> | undefined) => unknown);
function route(map: Record<string, Answer>) {
  requestMock.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    const key = `${opts?.method ?? "GET"} ${path}`;
    if (!(key in map)) throw new Error(`unexpected ${key}`);
    const answer = map[key];
    return typeof answer === "function" ? (answer as (body: unknown) => unknown)(opts?.body) : answer;
  });
}
const calls = (key: string) =>
  requestMock.mock.calls.filter(([path, opts]) => `${(opts as { method?: string } | undefined)?.method ?? "GET"} ${path}` === key);
const refusal = (code: string, status: number, fields?: Record<string, unknown>) => () =>
  Promise.reject(new ApiError(code, code, status, undefined, fields));

function open(url = "/acme/team/settings?tab=security") {
  const nav = fakeNav(url);
  render(wrapWithNav(<SignInMethodsSection />, nav));
  return nav;
}

async function proofDialog() {
  return within(await screen.findByRole("dialog", { name: "Xác nhận là bạn" }));
}

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.info).mockReset();
  resetAuthStoreForTests();
  setSessionUser(USER);
});

afterEach(() => {
  delete (window as unknown as { desktopAPI?: unknown }).desktopAPI;
  resetRuntimeConfig();
});

describe("SignInMethodsSection", () => {
  it("shows each way in with what it is, and hides a provider this deployment does not offer", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": { ...PROVIDERS, apple_web: false },
    });
    open();
    const list = await screen.findByRole("list", { name: "Phương thức đăng nhập" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Mật khẩu");
    expect(rows[0]).toHaveTextContent("Đã đặt");
    expect(rows[0]).toHaveTextContent(/an@company\.vn · Đổi lần cuối ngày/);
    expect(within(rows[0]!).getByRole("button", { name: "Đổi mật khẩu" })).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Google");
    expect(rows[1]).toHaveTextContent(/an@gmail\.com · Đã liên kết ngày/);
    expect(within(rows[1]!).getByRole("button", { name: "Gỡ liên kết Google" })).toBeInTheDocument();
    expect(screen.queryByText("Apple")).toBeNull();
  });

  it("holds the last way in back, and says why", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": { ...METHODS, password: { set: false, changed_at: null }, proofs: ["email_code"] },
      "GET /api/v1/auth/providers": PROVIDERS,
    });
    open();
    const unlink = await screen.findByRole("button", { name: "Gỡ liên kết Google" });
    expect(unlink).toHaveAttribute("aria-disabled", "true");
    const reason = screen.getByText("Đây là cách đăng nhập duy nhất. Đặt mật khẩu hoặc liên kết cách khác trước.");
    expect(unlink.getAttribute("aria-describedby")).toBe(reason.closest("[id]")?.id);
    expect(screen.getByRole("button", { name: "Đặt mật khẩu" })).toBeInTheDocument();
    expect(screen.getByText("Đặt mật khẩu để đăng nhập bằng email")).toBeInTheDocument();
    fireEvent.click(unlink);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps Apple on an account whose address is Apple's hidden one", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": {
        ...METHODS,
        apple: { linked: true, email: "x1@privaterelay.appleid.com", linked_at: null, private_relay: true },
        account_email_is_relay: true,
      },
      "GET /api/v1/auth/providers": PROVIDERS,
    });
    open();
    const unlink = await screen.findByRole("button", { name: "Gỡ liên kết Apple" });
    expect(unlink).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Email tài khoản của bạn là email ẩn của Apple, nên không gỡ liên kết Apple được.")).toBeInTheDocument();
    expect(screen.getAllByText("Email ẩn của Apple").length).toBeGreaterThan(0);
    expect(screen.queryByText(/privaterelay/)).toBeNull();
  });

  it("asks for the password once, then unlinks and links within the ten minutes without asking again", async () => {
    const tokens: unknown[] = [];
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/me/step-up": (body: Record<string, unknown> | undefined) =>
        body?.password === "password123" ? GRANT : Promise.reject(new ApiError("wrong", "password_incorrect", 403)),
      "POST /api/v1/me/sign-in-methods/google/unlink": (body: Record<string, unknown> | undefined) => {
        tokens.push(body?.step_up_token);
        return CHANGE({ ...METHODS, google: { linked: false, email: null, linked_at: null } });
      },
      "POST /api/v1/me/sign-in-methods/apple/link": (body: Record<string, unknown> | undefined) => {
        tokens.push(body?.step_up_token);
        return { authorization_url: "https://api.test/api/v1/auth/apple/start?intent=link&link_token=lt" };
      },
    });
    const nav = open();
    fireEvent.click(await screen.findByRole("button", { name: "Gỡ liên kết Google" }));

    const dialog = await proofDialog();
    expect(dialog.getByText("Để bảo vệ tài khoản, xác nhận là bạn trước khi gỡ liên kết Google.")).toBeInTheDocument();
    expect(dialog.getByText("Trong 10 phút tới, bạn không cần xác nhận lại.")).toBeInTheDocument();
    expect(dialog.getByRole("link", { name: "Quên mật khẩu?" })).toHaveAttribute("href", "/forgot-password");
    const field = dialog.getByLabelText("Mật khẩu hiện tại");
    // Opens on the field, not on "Quên mật khẩu?", which comes first in the label row.
    await waitFor(() => expect(field).toHaveFocus());
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    expect(await dialog.findByText("Nhập mật khẩu hiện tại.")).toBeInTheDocument();
    expect(field).toHaveFocus();

    fireEvent.change(field, { target: { value: "nope" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    expect(await dialog.findByText("Mật khẩu chưa đúng. Nhập lại.")).toBeInTheDocument();
    expect(field).toHaveValue("");
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(field, { target: { value: "password123" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    const confirm = within(await screen.findByRole("alertdialog"));
    expect(confirm.getByText("Gỡ liên kết Google?")).toBeInTheDocument();
    expect(
      confirm.getByText(
        "Bạn sẽ không đăng nhập bằng Google được nữa. Bạn vẫn đăng nhập được bằng mật khẩu. Các thiết bị khác sẽ đăng xuất.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(confirm.getByRole("button", { name: "Gỡ liên kết" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã gỡ liên kết Google."));

    // Apple is offered on the web; linking it now asks nothing.
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết Apple" }));
    await waitFor(() => expect(nav.openExternal).toHaveBeenCalledWith("https://api.test/api/v1/auth/apple/start?intent=link&link_token=lt"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls("POST /api/v1/me/step-up")).toHaveLength(2);
    expect(tokens).toEqual(["sut-1", "sut-1"]);
    expect(calls("POST /api/v1/me/sign-in-methods/apple/link")[0]![1]).toMatchObject({
      body: { step_up_token: "sut-1", return_to: "/acme/team/settings?tab=security" },
    });
    expect(screen.getByRole("button", { name: "Đang mở Apple…" })).toHaveAttribute("aria-busy", "true");
  });

  it("asks only the second factor when two-factor is on", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": { ...METHODS, proofs: ["totp"] },
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/me/step-up": { ...GRANT, method: "totp" },
      "POST /api/v1/me/sign-in-methods/apple/link": { authorization_url: "https://api.test/start" },
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết Apple" }));
    const dialog = await proofDialog();
    const field = dialog.getByLabelText("Mã từ ứng dụng xác thực");
    await waitFor(() => expect(field).toHaveFocus());
    expect(dialog.getByText("Mã 6 số, hoặc một mã khôi phục dạng xxxxx\u2011xxxxx.")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Dùng cách khác" })).toBeNull();
    fireEvent.change(field, { target: { value: "abcde-12345" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(calls("POST /api/v1/me/step-up")[0]![1]).toMatchObject({ body: { code: "abcde-12345" } }));
    await waitFor(() => expect(calls("POST /api/v1/me/sign-in-methods/apple/link")).toHaveLength(1));
  });

  it("mails a code for the one action, and says the code serves only that", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": { ...METHODS, password: { set: false, changed_at: null }, google: { ...METHODS.google }, proofs: ["email_code"] },
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/me/step-up/email-code": { status: "sent" },
      "POST /api/v1/me/step-up": { ...GRANT, method: "email_code" },
      "POST /api/v1/me/sign-in-methods/apple/link": { authorization_url: "https://api.test/start" },
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết Apple" }));
    const dialog = await proofDialog();
    expect(dialog.getByText("Mã trong email chỉ xác nhận việc này.")).toBeInTheDocument();
    // Until a code is on its way, sending it is the dialog's one action.
    expect(dialog.queryByRole("button", { name: "Xác nhận" })).toBeNull();
    await waitFor(() => expect(dialog.getByRole("button", { name: "Gửi mã tới an@company.vn" })).toHaveFocus());
    fireEvent.click(dialog.getByRole("button", { name: "Gửi mã tới an@company.vn" }));
    await waitFor(() => expect(calls("POST /api/v1/me/step-up/email-code")[0]![1]).toMatchObject({ body: { action: "link_apple" } }));
    expect(await dialog.findByText("Đã gửi mã tới an@company.vn. Mã có hiệu lực 10 phút.")).toBeInTheDocument();
    const field = dialog.getByLabelText("Mã trong email");
    await waitFor(() => expect(field).toHaveFocus());
    expect(dialog.getByRole("button", { name: /Gửi lại sau \d+ giây/ })).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(field, { target: { value: "12" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    expect(await dialog.findByText("Nhập mã 6 số trong email.")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "123 456" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() =>
      expect(calls("POST /api/v1/me/step-up")[0]![1]).toMatchObject({ body: { code: "123456", action: "link_apple" } }),
    );
    await waitFor(() => expect(calls("POST /api/v1/me/sign-in-methods/apple/link")).toHaveLength(1));
  });

  it("holds the dialog still while confirming is locked, and says for how long", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/me/step-up": () =>
        Promise.reject(new ApiError("locked", "second_factor_locked", 429, undefined, undefined, undefined, 900)),
      "POST /api/v1/me/step-up/email-code": () =>
        Promise.reject(new ApiError("slow", "rate_limited", 429, undefined, { retry_after: 3600 })),
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết Apple" }));
    const dialog = await proofDialog();
    fireEvent.change(dialog.getByLabelText("Mật khẩu hiện tại"), { target: { value: "password123" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    const said = await dialog.findByText(/Tạm khóa xác nhận vì nhập sai nhiều lần\./);
    expect(said).toHaveTextContent("Thử lại sau 15 phút.");
    expect(dialog.getByRole("button", { name: "Xác nhận" })).toHaveAttribute("aria-disabled", "true");

    // The mailed code has its own budget, and says so.
    fireEvent.click(dialog.getByRole("button", { name: "Dùng cách khác" }));
    fireEvent.click(dialog.getByRole("button", { name: "Gửi mã tới an@company.vn" }));
    // The lockout is still said; the mailed code's own budget is said beside it.
    expect(dialog.getByText(/Tạm khóa xác nhận vì nhập sai nhiều lần\./)).toBeInTheDocument();
    expect(await dialog.findByText(/Đã tạm dừng gửi mã tới email của bạn\./)).toHaveTextContent("Thử lại sau 60 phút.");
    expect(dialog.getByRole("button", { name: "Gửi mã tới an@company.vn" })).toHaveAttribute("aria-disabled", "true");
  });

  it("offers the other way to confirm", async () => {
    route({ "GET /api/v1/me/sign-in-methods": METHODS, "GET /api/v1/auth/providers": PROVIDERS });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết Apple" }));
    const dialog = await proofDialog();
    expect(dialog.getByLabelText("Mật khẩu hiện tại")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Dùng cách khác" }));
    expect(dialog.getByRole("button", { name: "Gửi mã tới an@company.vn" })).toBeInTheDocument();
    expect(dialog.queryByLabelText("Mật khẩu hiện tại")).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls("POST /api/v1/me/sign-in-methods/apple/link")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Liên kết Apple" })).not.toHaveAttribute("aria-busy");
  });

  it("asks again, on the proofs the server names, when a held token is refused", async () => {
    let links = 0;
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/me/step-up": (body: Record<string, unknown> | undefined) => ({ ...GRANT, step_up_token: `sut-${String(body?.code ?? body?.password)}` }),
      "POST /api/v1/me/sign-in-methods/apple/link": () => {
        links += 1;
        return links === 1
          ? Promise.reject(new ApiError("proof", "proof_required", 403, undefined, { proofs: ["totp"] }))
          : { authorization_url: "https://api.test/start" };
      },
    });
    const nav = open();
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết Apple" }));
    let dialog = await proofDialog();
    fireEvent.change(dialog.getByLabelText("Mật khẩu hiện tại"), { target: { value: "password123" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    // Two-factor was turned on elsewhere: the command's refusal names it.
    await waitFor(() => expect(screen.getByLabelText("Mã từ ứng dụng xác thực")).toBeInTheDocument());
    dialog = await proofDialog();
    fireEvent.change(dialog.getByLabelText("Mã từ ứng dụng xác thực"), { target: { value: "123456" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(nav.openExternal).toHaveBeenCalledWith("https://api.test/start"));
    expect(calls("POST /api/v1/me/sign-in-methods/apple/link")[1]![1]).toMatchObject({ body: { step_up_token: "sut-123456" } });
  });

  /** Through the proof dialog with the password, to the unlink confirmation. */
  async function proveThenAskUnlink() {
    fireEvent.click(await screen.findByRole("button", { name: "Gỡ liên kết Google" }));
    const dialog = await proofDialog();
    fireEvent.change(dialog.getByLabelText("Mật khẩu hiện tại"), { target: { value: "password123" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    return within(await screen.findByRole("alertdialog"));
  }

  it("says why the server refused an unlink, and closes the question", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/me/step-up": GRANT,
      // Another tab removed the password meanwhile: Google is the last way in.
      "POST /api/v1/me/sign-in-methods/google/unlink": refusal("sign_in_method_last", 409),
    });
    open();
    const confirm = await proveThenAskUnlink();
    fireEvent.click(confirm.getByRole("button", { name: "Gỡ liên kết" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Đây là cách đăng nhập duy nhất. Đặt mật khẩu hoặc liên kết cách khác trước."),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls("POST /api/v1/me/sign-in-methods/google/unlink")).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("sends nothing more when the person closes the proof a refused token asked for", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/me/step-up": GRANT,
      "POST /api/v1/me/sign-in-methods/google/unlink": refusal("proof_required", 403, { proofs: ["password"] }),
    });
    open();
    const confirm = await proveThenAskUnlink();
    fireEvent.click(confirm.getByRole("button", { name: "Gỡ liên kết" }));
    // The held token died: the dialog asks again, the question waits behind it.
    const again = await proofDialog();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(again.getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls("POST /api/v1/me/sign-in-methods/google/unlink")).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("puts the link button back and says why when the link cannot start", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/me/step-up": GRANT,
      "POST /api/v1/me/sign-in-methods/apple/link": refusal("internal", 503),
    });
    const nav = open();
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết Apple" }));
    const dialog = await proofDialog();
    fireEvent.change(dialog.getByLabelText("Mật khẩu hiện tại"), { target: { value: "password123" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("UniWork đang gặp trục trặc. Thử lại sau ít phút."));
    const link = await screen.findByRole("button", { name: "Liên kết Apple" });
    expect(link).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText("Đang mở Apple…")).toBeNull();
    expect(nav.openExternal).not.toHaveBeenCalled();
  });

  it("offers the proofs the step-up itself names when the account changed meanwhile", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      "POST /api/v1/me/step-up": (body: Record<string, unknown> | undefined) =>
        body?.password
          ? Promise.reject(new ApiError("proof", "proof_required", 403, undefined, { proofs: ["totp"] }))
          : { ...GRANT, step_up_token: "sut-totp" },
      "POST /api/v1/me/sign-in-methods/apple/link": { authorization_url: "https://api.test/start" },
    });
    const nav = open();
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết Apple" }));
    const dialog = await proofDialog();
    fireEvent.change(dialog.getByLabelText("Mật khẩu hiện tại"), { target: { value: "password123" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    // Two-factor was turned on elsewhere: the password is no longer a proof.
    const code = await dialog.findByLabelText("Mã từ ứng dụng xác thực");
    expect(dialog.queryByLabelText("Mật khẩu hiện tại")).toBeNull();
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(nav.openExternal).toHaveBeenCalledWith("https://api.test/start"));
    expect(calls("POST /api/v1/me/sign-in-methods/apple/link")[0]![1]).toMatchObject({ body: { step_up_token: "sut-totp" } });
  });

  it("says how a link came back, once, and takes the result off the URL", async () => {
    route({ "GET /api/v1/me/sign-in-methods": METHODS, "GET /api/v1/auth/providers": PROVIDERS });
    const nav = open("/acme/team/settings?tab=security&sign_in_method=google&result=linked");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã liên kết Google."));
    expect(nav.replace).toHaveBeenCalledWith("/acme/team/settings?tab=security");
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("says a link the person stopped as news, not an error", async () => {
    route({ "GET /api/v1/me/sign-in-methods": METHODS, "GET /api/v1/auth/providers": PROVIDERS });
    open("/settings?tab=security&sign_in_method=google&result=denied");
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Bạn đã dừng giữa chừng, Google chưa được liên kết."));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says a refused link as an error", async () => {
    route({ "GET /api/v1/me/sign-in-methods": METHODS, "GET /api/v1/auth/providers": PROVIDERS });
    open("/settings?tab=security&sign_in_method=apple&result=taken&masked_email=b%E2%80%A2%E2%80%A2%E2%80%A2%40icloud.com");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Tài khoản Apple này đang được dùng cho b•••@icloud.com. Đăng nhập vào đó và gỡ liên kết trước."),
    );
  });

  it("confirms moving a provider off an empty account, without asking the session that started the link again", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      "GET /api/v1/auth/sign-in-ticket": APPLE_TICKET,
      "POST /api/v1/auth/sign-in-ticket/link": CHANGE({ ...METHODS, apple: { ...METHODS.apple, linked: true } }),
    });
    const nav = open("/acme/team/settings?tab=security&sign_in_method=apple&result=movable&masked_email=b%E2%80%A2%E2%80%A2%E2%80%A2%40icloud.com");
    const confirm = within(await screen.findByRole("alertdialog"));
    expect(confirm.getByText("Chuyển Apple sang tài khoản này?")).toBeInTheDocument();
    expect(confirm.getByText(/tài khoản trống b•••@icloud\.com/)).toBeInTheDocument();
    expect(nav.replace).toHaveBeenCalledWith("/acme/team/settings?tab=security");
    fireEvent.click(confirm.getByRole("button", { name: "Chuyển sang đây" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã chuyển Apple sang tài khoản này."));
    expect(calls("POST /api/v1/auth/sign-in-ticket/link")[0]![1]).toMatchObject({ body: { move: true } });
    expect(calls("POST /api/v1/me/step-up")).toHaveLength(0);
  });

  it.each([
    ["is taken by an account with content", refusal("sign_in_method_taken", 409, { masked_email: "b•••@acme.vn" }),
      "Cách đăng nhập này đang được dùng cho b•••@acme.vn. Đăng nhập vào đó và gỡ liên kết trước."],
    ["expired meanwhile", refusal("sign_in_ticket_missing", 404), "Lượt đăng nhập này đã hết hạn. Bắt đầu lại."],
  ])("closes the move and says so when the identity %s", async (_name, answer, sentence) => {
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      "GET /api/v1/auth/sign-in-ticket": APPLE_TICKET,
      "POST /api/v1/auth/sign-in-ticket/link": answer,
    });
    open("/settings?tab=security&sign_in_method=apple&result=movable&masked_email=b%E2%80%A2%E2%80%A2%E2%80%A2%40icloud.com");
    const confirm = within(await screen.findByRole("alertdialog"));
    fireEvent.click(confirm.getByRole("button", { name: "Chuyển sang đây" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(sentence));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls("POST /api/v1/auth/sign-in-ticket/link")).toHaveLength(1);
  });

  it("drops the move when the proof the server asked for is closed", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      "GET /api/v1/auth/sign-in-ticket": APPLE_TICKET,
      "POST /api/v1/auth/sign-in-ticket/link": refusal("proof_required", 403, { proofs: ["password"] }),
    });
    open("/settings?tab=security&sign_in_method=apple&result=movable");
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Chuyển sang đây" }));
    const dialog = await proofDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls("POST /api/v1/auth/sign-in-ticket/link")).toHaveLength(1);
  });

  it("asks a move only of a sign-in the server holds waiting, whatever the URL says", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      // A crafted link: Google is named, but nothing of Google's waits.
      "GET /api/v1/auth/sign-in-ticket": APPLE_TICKET,
    });
    open("/settings?tab=security&sign_in_method=google&result=movable&masked_email=g%E2%80%A2%E2%80%A2%E2%80%A2%40gmail.com");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Chưa liên kết được Google. Thử lại."));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls("POST /api/v1/auth/sign-in-ticket/link")).toHaveLength(0);
  });

  it("drops the pending identity when the move is declined", async () => {
    route({
      "GET /api/v1/me/sign-in-methods": METHODS,
      "GET /api/v1/auth/providers": PROVIDERS,
      "GET /api/v1/auth/sign-in-ticket": { ...APPLE_TICKET, provider: "google", email: "an@gmail.com", private_relay: false },
      "DELETE /api/v1/auth/sign-in-ticket": undefined,
    });
    open("/settings?tab=security&sign_in_method=google&result=movable");
    const confirm = within(await screen.findByRole("alertdialog"));
    expect(confirm.getByText(/đang được dùng cho một tài khoản trống/)).toBeInTheDocument();
    fireEvent.click(confirm.getByRole("button", { name: "Không chuyển" }));
    await waitFor(() => expect(calls("DELETE /api/v1/auth/sign-in-ticket")).toHaveLength(1));
  });

  it("in the UniChat shell, links through the browser and reads the list again on focus", async () => {
    let onFocus: ((focused: boolean) => void) | undefined;
    const openExternal = vi.fn(() => Promise.resolve());
    (window as unknown as { desktopAPI: unknown }).desktopAPI = {
      app: "unichat",
      openExternal,
      onFocusChange: (cb: (focused: boolean) => void) => {
        onFocus = cb;
        return () => {};
      },
    };
    configureRuntime({ appUrl: "https://app.test" });
    route({ "GET /api/v1/me/sign-in-methods": METHODS, "GET /api/v1/auth/providers": PROVIDERS });
    open("/acme/team/chat/settings?tab=security");
    const link = await screen.findByRole("button", { name: "Liên kết trên web cho Apple" });
    expect(screen.getByText("Mở UniWork trong trình duyệt để liên kết Apple.")).toBeInTheDocument();
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith("https://app.test/settings?tab=security&expect_user=u1");
    expect(screen.queryByRole("dialog")).toBeNull();

    expect(calls("GET /api/v1/me/sign-in-methods")).toHaveLength(1);
    act(() => onFocus?.(true));
    await waitFor(() => expect(calls("GET /api/v1/me/sign-in-methods")).toHaveLength(2));
  });

  it("warns when the browser is signed in to another account than the one UniChat uses", async () => {
    route({ "GET /api/v1/me/sign-in-methods": METHODS, "GET /api/v1/auth/providers": PROVIDERS });
    open("/settings?tab=security&expect_user=u-other");
    expect(
      await screen.findByText("Trình duyệt đang đăng nhập an@company.vn, không phải tài khoản bạn dùng trong UniChat."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đăng xuất" })).toBeInTheDocument();
  });

  it("holds every change while the browser is signed in to the other account", async () => {
    route({ "GET /api/v1/me/sign-in-methods": METHODS, "GET /api/v1/auth/providers": PROVIDERS });
    open("/settings?tab=security&expect_user=u-other");
    const link = await screen.findByRole("button", { name: "Liên kết Apple" });
    const warning = screen.getByRole("note");
    for (const action of [link, screen.getByRole("button", { name: "Gỡ liên kết Google" }), screen.getByRole("button", { name: "Đổi mật khẩu" })]) {
      expect(action).toHaveAttribute("aria-disabled", "true");
      expect(action.getAttribute("aria-describedby")).toBe(warning.id);
      fireEvent.click(action);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(requestMock.mock.calls.filter(([, o]) => (o as { method?: string } | undefined)?.method)).toHaveLength(0);
  });

  it("asks nothing of the account UniChat named once the browser is signed in to it", async () => {
    route({ "GET /api/v1/me/sign-in-methods": METHODS, "GET /api/v1/auth/providers": PROVIDERS });
    open("/settings?tab=security&expect_user=u1");
    const link = await screen.findByRole("button", { name: "Liên kết Apple" });
    expect(screen.queryByRole("note")).toBeNull();
    expect(link).not.toHaveAttribute("aria-disabled");
  });

  it("says the list did not load, with a way to try again", async () => {
    route({ "GET /api/v1/me/sign-in-methods": refusal("internal", 500), "GET /api/v1/auth/providers": PROVIDERS });
    open();
    expect(await screen.findByText("Không tải được phương thức đăng nhập.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đặt mật khẩu" })).toBeNull();
  });
});

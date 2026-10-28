import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { toast } from "sonner";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { SecurityTab } from "./security-tab";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

initI18n();

const user = {
  id: "u1",
  email: "a@b.co",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: null,
  onboarding_questionnaire: {},
  locale: "vi",
  has_password: true,
};

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

const sessions = [
  { id: "s-cur", user_agent: MAC_CHROME, ip: "::1", created_at: "2026-09-07T01:00:00Z", last_seen_at: "2026-09-07T02:00:00Z", current: true },
  { id: "s-old", user_agent: IPHONE_SAFARI, ip: "2.2.2.2", created_at: "2026-09-06T01:00:00Z", last_seen_at: "2026-09-06T02:00:00Z", current: false },
  { id: "s-win", user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0", ip: "3.3.3.3", created_at: "", last_seen_at: "", current: false },
];

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  resetAuthStoreForTests();
});

describe("SecurityTab", () => {
  it("names sessions by browser and system, and revokes one only after confirming", async () => {
    setSessionUser(user);
    let rows = sessions;
    requestMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/v1/me/sessions") return Promise.resolve({ sessions: rows });
      if (path === "/api/v1/me/sessions/s-old" && init?.method === "DELETE") {
        rows = rows.filter((s) => s.id !== "s-old");
        return Promise.resolve({ status: "ok" });
      }
      return Promise.resolve({ status: "ok" });
    });
    render(wrapWithNav(<SecurityTab />));

    expect(await screen.findByText("Safari trên iOS")).toBeInTheDocument();
    expect(screen.getByText("Chrome trên macOS")).toBeInTheDocument();
    expect(screen.queryByText(/Mozilla/)).toBeNull();
    // Loopback reads as this machine, not a bare "::1".
    expect(screen.getByText(/^Máy cục bộ \(localhost\)/)).toBeInTheDocument();
    expect(screen.getByText("Phiên này")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thu hồi 2 phiên khác" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thu hồi Safari trên iOS" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Thu hồi phiên Safari trên iOS?");
    expect(requestMock.mock.calls.some(([, init]) => (init as { method?: string } | undefined)?.method === "DELETE")).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Thu hồi" }));
    await waitFor(() => expect(screen.queryByText("Safari trên iOS")).toBeNull());
    expect(screen.getByRole("button", { name: "Thu hồi 1 phiên khác" })).toBeInTheDocument();
  });

  it("confirms before revoking every other session", async () => {
    setSessionUser(user);
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/v1/me/sessions" ? { sessions } : { status: "ok" }),
    );
    render(wrapWithNav(<SecurityTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Thu hồi 2 phiên khác" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Thu hồi 2 phiên khác?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(requestMock.mock.calls.some(([path]) => path === "/api/v1/me/sessions/revoke-others")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Thu hồi 2 phiên khác" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Thu hồi 2 phiên khác" }));
    await waitFor(() =>
      expect(requestMock.mock.calls.some(([path]) => path === "/api/v1/me/sessions/revoke-others")).toBe(true),
    );
  });

  it("shows the error state with a retry when the list fails", async () => {
    setSessionUser(user);
    requestMock.mockRejectedValue(new ApiError("boom", "internal", 500));
    render(wrapWithNav(<SecurityTab />));
    const failed = await screen.findByText("Không tải được danh sách phiên.");
    // Each list says its own failure, with its own retry (sign-in methods fails too).
    expect(within(failed.closest<HTMLElement>("[role=status]")!).getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
    expect(screen.getByText("Không tải được phương thức đăng nhập.")).toBeInTheDocument();
  });

  it("walks the MFA enrolment: setup shows the secret, confirm shows recovery codes once", async () => {
    setSessionUser(user);
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/me/mfa/setup") return Promise.resolve({ secret: "JBSWY3DPEHPK3PXP", otpauth_url: "otpauth://totp/x" });
      if (path === "/api/v1/me/mfa/confirm") return Promise.resolve({ recovery_codes: ["aaaaa-bbbbb", "ccccc-ddddd"] });
      if (path === "/api/v1/me") return Promise.resolve({ user: { ...user, mfa_enabled_at: "2026-09-07T00:00:00Z" } });
      return Promise.resolve({ sessions: [] });
    });
    render(wrapWithNav(<SecurityTab />));
    expect(await screen.findByText("Đang tắt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bật MFA" }));

    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mã 6 số từ ứng dụng"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và bật" }));

    expect(await screen.findByText("aaaaa-bbbbb")).toBeInTheDocument();
    // Confirming turned MFA on; the badge says so before the codes are dismissed.
    expect(screen.getByText("Đang bật")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sao chép" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải về (.txt)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tôi đã lưu mã" }));
    // The refetched user has MFA on, so the card now offers "disable".
    expect(await screen.findByRole("button", { name: "Tắt MFA" })).toBeInTheDocument();
  });

  it("refuses a short or wrong enrolment code under the field and puts focus back there", async () => {
    setSessionUser(user);
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/me/mfa/setup") return Promise.resolve({ secret: "JBSWY3DPEHPK3PXP", otpauth_url: "otpauth://totp/x" });
      if (path === "/api/v1/me/mfa/confirm") return Promise.reject(new ApiError("Mã không khớp.", "invalid_code", 400));
      return Promise.resolve({ sessions: [] });
    });
    render(wrapWithNav(<SecurityTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Bật MFA" }));
    const input = await screen.findByLabelText("Mã 6 số từ ứng dụng");

    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và bật" }));
    expect(input).toHaveAttribute("aria-invalid", "true");
    // The scan hint stays with the field; the refusal follows it.
    expect(input).toHaveAccessibleDescription(/^Quét mã QR .* Nhập đủ 6 chữ số ứng dụng hiện ra\.$/);
    expect(input).toHaveFocus();
    expect(requestMock.mock.calls.some(([path]) => path === "/api/v1/me/mfa/confirm")).toBe(false);

    fireEvent.change(input, { target: { value: "123456" } });
    expect(input).not.toHaveAttribute("aria-invalid");
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và bật" }));
    await waitFor(() => expect(input).toHaveAccessibleDescription(/ Mã không khớp\.$/));
    expect(input).toHaveFocus();
  });

  it("labels the disable-MFA field visibly, keeps a text keyboard for recovery codes, and refuses inline", async () => {
    setSessionUser({ ...user, mfa_enabled_at: "2026-09-07T00:00:00Z" });
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/me/mfa/disable"
        ? Promise.reject(new ApiError("Mã không đúng.", "invalid_code", 400))
        : Promise.resolve({ sessions: [] }),
    );
    render(wrapWithNav(<SecurityTab />));
    const input = await screen.findByLabelText("Mã xác thực");
    expect(input).not.toHaveAttribute("inputmode", "numeric");
    expect(input).not.toHaveAttribute("placeholder");

    fireEvent.click(screen.getByRole("button", { name: "Tắt MFA" }));
    expect(input).toHaveAccessibleDescription(/Nhập mã từ ứng dụng hoặc một mã khôi phục\./);
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "abcde-12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Tắt MFA" }));
    await waitFor(() => expect(input).toHaveAccessibleDescription(/Mã không đúng\./));
  });

  it("keeps a refused account deletion under the proof field, not in a toast", async () => {
    setSessionUser(user);
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/me/delete"
        ? Promise.reject(new ApiError("Mật khẩu không đúng.", "invalid_password", 400))
        : Promise.resolve({ sessions: [] }),
    );
    render(wrapWithNav(<SecurityTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Xóa tài khoản" }));
    const proof = await screen.findByLabelText("Nhập mật khẩu hiện tại để xác nhận");

    fireEvent.click(screen.getByRole("button", { name: "Xóa vĩnh viễn" }));
    expect(proof).toHaveAttribute("aria-invalid", "true");
    expect(proof).toHaveAccessibleDescription(/^Nhập mật khẩu để xác nhận\./);
    expect(proof).toHaveFocus();

    fireEvent.change(proof, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Xóa vĩnh viễn" }));
    await waitFor(() => expect(proof).toHaveAccessibleDescription(/^Mật khẩu không đúng\./));
    expect(proof).toHaveFocus();
  });

  it.each([
    [{}, "Nhập mật khẩu hiện tại để xác nhận", "password_incorrect", 403, "Mật khẩu chưa đúng. Nhập lại để xóa tài khoản.", ""],
    [
      { has_password: false, mfa_enabled_at: "2026-09-07T00:00:00Z" },
      "Nhập mã xác thực hai lớp để xác nhận",
      "mfa_code_incorrect",
      403,
      "Mã xác thực chưa đúng hoặc đã hết hạn. Nhập mã mới để xóa tài khoản.",
      "",
    ],
    [
      { has_password: false },
      "Gõ lại địa chỉ email của bạn để xác nhận",
      "email_confirmation_mismatch",
      400,
      "Email chưa khớp với tài khoản đang đăng nhập. Gõ lại để xóa tài khoản.",
      "wrong@b.co",
    ],
  ])("answers a refused proof (%#) in the dialog's words, under the field", async (patch, label, code, status, message, kept) => {
    setSessionUser({ ...user, ...patch });
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/me/delete"
        ? Promise.reject(new ApiError("server words", code, status))
        : Promise.resolve({ sessions: [] }),
    );
    render(wrapWithNav(<SecurityTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Xóa tài khoản" }));
    const proof = await screen.findByLabelText(label);
    fireEvent.change(proof, { target: { value: "wrong@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Xóa vĩnh viễn" }));
    await waitFor(() => expect(proof).toHaveAccessibleDescription(new RegExp(`^${message.replace(/\./g, "\\.")}`)));
    expect(proof).toHaveAttribute("aria-invalid", "true");
    expect(proof).toHaveFocus();
    // A secret is never kept past a refusal; a typed address stays to correct.
    expect(proof).toHaveValue(kept);
    expect(requestMock.mock.calls.filter(([path]) => path === "/api/v1/me/delete")).toHaveLength(1);
  });

  it("asks for the password before deleting a password account and signs out after", async () => {
    setSessionUser(user);
    requestMock.mockImplementation((path: string) => Promise.resolve(path === "/api/v1/me/sessions" ? { sessions: [] } : { status: "ok" }));
    render(wrapWithNav(<SecurityTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Xóa tài khoản" }));
    const proof = await screen.findByLabelText("Nhập mật khẩu hiện tại để xác nhận");
    expect(proof).toHaveAttribute("type", "password");
    fireEvent.change(proof, { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Xóa vĩnh viễn" }));
    await waitFor(() =>
      expect(requestMock.mock.calls.find(([path]) => path === "/api/v1/me/delete")?.[1]).toMatchObject({
        body: { password: "hunter22" },
      }),
    );
  });
});

/**
 * Turning two-factor on is proved first (ADR 0047 §5, spec §4.5): through the
 * shared proof dialog, once for the setup and the confirmation together, and
 * never read as "could not start the setup".
 */
describe("SecurityTab › turning on two-factor", () => {
  const VERIFIED = { ...user, email_verified_at: "2026-09-01T00:00:00Z" };
  const SETUP = { secret: "JBSWY3DPEHPK3PXP", otpauth_url: "otpauth://totp/x" };
  const grant = (token: string) => ({
    step_up_token: token,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    method: "password",
  });
  type Answer = unknown | ((body: Record<string, unknown> | undefined) => unknown);
  const route = (map: Record<string, Answer>) => {
    const all: Record<string, Answer> = {
      "GET /api/v1/me/sessions": { sessions: [] },
      "GET /api/v1/me/sign-in-methods": {
        password: { set: true, changed_at: null },
        google: { linked: false, email: null, linked_at: null },
        apple: { linked: false, email: null, linked_at: null, private_relay: false },
        account_email_is_relay: false,
        proofs: ["password", "email_code"],
      },
      "GET /api/v1/auth/providers": { google: false, apple: false, apple_web: false, google_native: false },
      ...map,
    };
    requestMock.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      const key = `${opts?.method ?? "GET"} ${path}`;
      if (!(key in all)) throw new Error(`unexpected ${key}`);
      const answer = all[key];
      return typeof answer === "function" ? (answer as (body: unknown) => unknown)(opts?.body) : answer;
    });
  };
  const bodiesOf = (key: string) =>
    requestMock.mock.calls
      .filter(([path, opts]) => `${(opts as { method?: string } | undefined)?.method ?? "GET"} ${path}` === key)
      .map(([, opts]) => (opts as { body?: unknown }).body);
  const proofDialog = async () => within(await screen.findByRole("dialog", { name: "Xác nhận là bạn" }));
  const prove = async (password: string) => {
    const proof = await proofDialog();
    fireEvent.change(proof.getByLabelText("Mật khẩu hiện tại"), { target: { value: password } });
    fireEvent.click(proof.getByRole("button", { name: "Xác nhận" }));
    return proof;
  };

  it("asks who it is before the setup, and the one proof serves the setup and the confirmation", async () => {
    setSessionUser(VERIFIED);
    route({
      "POST /api/v1/me/step-up": (body: Record<string, unknown> | undefined) =>
        body?.password === "password123" ? grant("sut-1") : Promise.reject(new ApiError("x", "password_incorrect", 403)),
      "POST /api/v1/me/mfa/setup": SETUP,
      "POST /api/v1/me/mfa/confirm": { recovery_codes: ["aaaaa-bbbbb"] },
    });
    render(wrapWithNav(<SecurityTab />));

    // Closing the dialog sets nothing up and says nothing.
    fireEvent.click(await screen.findByRole("button", { name: "Bật MFA" }));
    fireEvent.click((await proofDialog()).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(bodiesOf("POST /api/v1/me/mfa/setup")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Bật MFA" }));
    const proof = await proofDialog();
    expect(proof.getByText("Để bảo vệ tài khoản, xác nhận là bạn trước khi bật xác thực hai lớp.")).toBeInTheDocument();
    // A wrong password is answered in the dialog; nothing is set up.
    await prove("nope");
    expect(await proof.findByText("Mật khẩu chưa đúng. Nhập lại.")).toBeInTheDocument();
    expect(bodiesOf("POST /api/v1/me/mfa/setup")).toHaveLength(0);

    await prove("password123");
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    // The button that started it is gone: focus is on the code it asks for.
    await waitFor(() => expect(screen.getByLabelText("Mã 6 số từ ứng dụng")).toHaveFocus());
    fireEvent.change(screen.getByLabelText("Mã 6 số từ ứng dụng"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và bật" }));
    expect(await screen.findByText("aaaaa-bbbbb")).toBeInTheDocument();

    expect(bodiesOf("POST /api/v1/me/mfa/setup")).toEqual([{ step_up_token: "sut-1" }]);
    expect(bodiesOf("POST /api/v1/me/mfa/confirm")).toEqual([{ code: "123456", step_up_token: "sut-1" }]);
    expect(screen.queryByRole("dialog", { name: "Xác nhận là bạn" })).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("lets the server speak first for an address not known to be verified, and says to verify it", async () => {
    setSessionUser(user);
    route({ "POST /api/v1/me/mfa/setup": () => Promise.reject(new ApiError("x", "email_unverified", 403)) });
    render(wrapWithNav(<SecurityTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Bật MFA" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Xác minh email của bạn trước, rồi bật xác thực hai lớp."),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bodiesOf("POST /api/v1/me/step-up")).toHaveLength(0);
  });

  it("opens the dialog on the proofs a refusal names, and sets up once they are given", async () => {
    setSessionUser(user);
    let setups = 0;
    route({
      "POST /api/v1/me/step-up": grant("sut-2"),
      "POST /api/v1/me/mfa/setup": () =>
        setups++ === 0
          ? Promise.reject(new ApiError("x", "proof_required", 403, undefined, { proofs: ["password"] }))
          : SETUP,
    });
    render(wrapWithNav(<SecurityTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Bật MFA" }));
    const proof = await proofDialog();
    // The refusal named the password alone: no other way is offered.
    expect(proof.queryByRole("button", { name: "Dùng cách khác" })).toBeNull();
    await prove("password123");
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(bodiesOf("POST /api/v1/me/mfa/setup")).toEqual([{ step_up_token: "" }, { step_up_token: "sut-2" }]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("asks again when the proof lapsed before the confirmation, and sends the same code", async () => {
    setSessionUser(VERIFIED);
    let token = 0;
    let confirms = 0;
    route({
      "POST /api/v1/me/step-up": () => grant(`sut-${++token}`),
      "POST /api/v1/me/mfa/setup": SETUP,
      "POST /api/v1/me/mfa/confirm": () =>
        confirms++ === 0
          ? Promise.reject(new ApiError("x", "proof_required", 403, undefined, { proofs: ["password", "email_code"] }))
          : { recovery_codes: ["aaaaa-bbbbb"] },
    });
    render(wrapWithNav(<SecurityTab />));
    fireEvent.click(await screen.findByRole("button", { name: "Bật MFA" }));
    await prove("password123");
    const input = await screen.findByLabelText("Mã 6 số từ ứng dụng");
    fireEvent.change(input, { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và bật" }));
    await prove("password123");
    expect(await screen.findByText("aaaaa-bbbbb")).toBeInTheDocument();
    expect(bodiesOf("POST /api/v1/me/mfa/confirm")).toEqual([
      { code: "654321", step_up_token: "sut-1" },
      { code: "654321", step_up_token: "sut-2" },
    ]);
    // Never shown as a wrong code.
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
